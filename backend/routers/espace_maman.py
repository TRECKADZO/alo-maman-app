"""
Router — Espace Maman : droits RGPD (accès / rectification / limitation),
résumé de parcours partageable (PDF + lien expirant) et notifications d'accès.

Collections MongoDB :
- privacy_restrictions : {user_id, block_all, hidden_categories[], updated_at}
- profil_sante_maman   : {user_id, groupe_sanguin, rhesus, allergies_enc, antecedents_enc, traitements_enc}
- correction_requests  : demandes de rectification adressées au pro auteur
- resume_shares        : liens publics expirants du résumé de parcours
- access_notif_throttle: anti-spam notifications d'accès (1/h par pro & maman)
"""
import io
import html
import uuid
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal

from fastapi import Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel, Field

from encryption import encrypt_str, decrypt_str, decrypt_enfant, decrypt_consultation_note

# Rubriques masquables individuellement
RESTRICTABLE_CATEGORIES = {
    "grossesse": "Grossesse & accouchement",
    "vaccins": "Vaccins des enfants",
    "croissance": "Croissance des enfants",
    "consultation_notes": "Notes des autres professionnels",
    "rdv": "Historique des rendez-vous",
    "allergies": "Allergies & antécédents",
    "documents": "Documents médicaux",
    "cycle": "Cycle & contraception",
}

_db = None  # injecté par register_espace_maman_routes


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def get_restrictions(maman_id: str) -> dict:
    r = await _db.privacy_restrictions.find_one({"user_id": maman_id}, {"_id": 0}) if _db is not None else None
    return r or {"user_id": maman_id, "block_all": False, "hidden_categories": []}


async def is_pro_blocked(maman_id: str) -> bool:
    return bool((await get_restrictions(maman_id)).get("block_all"))


async def is_category_hidden(maman_id: str, category: str) -> bool:
    r = await get_restrictions(maman_id)
    return bool(r.get("block_all")) or category in (r.get("hidden_categories") or [])


async def apply_restrictions_to_dossier(maman_id: str, dossier: dict) -> dict:
    """Retire du dossier pro les rubriques masquées par la maman."""
    hidden = set((await get_restrictions(maman_id)).get("hidden_categories") or [])
    if not hidden:
        return dossier
    out = dict(dossier)
    if "grossesse" in hidden:
        out["grossesse"] = None
    if "rdv" in hidden:
        out["rdvs"] = []
    enfants = []
    for e in out.get("enfants") or []:
        e = dict(e)
        if "vaccins" in hidden:
            e["vaccins"] = []
        if "croissance" in hidden:
            e["mesures"] = []
        if "allergies" in hidden:
            e["allergies"] = []
        enfants.append(e)
    out["enfants"] = enfants
    out["restrictions_actives"] = [RESTRICTABLE_CATEGORIES[c] for c in hidden if c in RESTRICTABLE_CATEGORIES]
    return out


async def strip_enfant_for_pro(e: dict) -> dict:
    """Applique les rubriques masquées par la maman à un enfant vu par un pro (FHIR, carnet, PDF)."""
    hidden = set((await get_restrictions(e.get("user_id"))).get("hidden_categories") or [])
    if not hidden:
        return e
    e = dict(e)
    if "vaccins" in hidden:
        e["vaccins"] = []
    if "croissance" in hidden:
        e["mesures"] = []
    if "allergies" in hidden:
        e["allergies"] = []
    return e


async def _resolve_maman_id(resource_id: str) -> Optional[str]:
    u = await _db.users.find_one({"id": resource_id, "role": "maman"}, {"_id": 0, "id": 1})
    if u:
        return u["id"]
    e = await _db.enfants.find_one({"id": resource_id}, {"_id": 0, "user_id": 1})
    return e.get("user_id") if e else None


async def notify_pro_access(pro: dict, resource_id: str, resource_label: str = "votre dossier", urgence: bool = False):
    """Notifie la maman quand un professionnel consulte ses données (max 1/h par pro, sauf urgence)."""
    if _db is None or pro.get("role") != "professionnel":
        return
    try:
        maman_id = await _resolve_maman_id(resource_id)
        if not maman_id:
            return
        key = f"{pro['id']}:{maman_id}"
        now = datetime.now(timezone.utc)
        if not urgence:
            t = await _db.access_notif_throttle.find_one({"key": key})
            if t and t.get("last") and datetime.fromisoformat(t["last"]) > now - timedelta(hours=1):
                return
        await _db.access_notif_throttle.update_one({"key": key}, {"$set": {"last": now.isoformat()}}, upsert=True)
        name = pro.get("name") or "Un professionnel"
        await _db.notifications.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": maman_id,
            "type": "acces_urgence" if urgence else "acces_dossier",
            "title": "🚨 Accès d'urgence à votre dossier" if urgence else "👁️ Votre dossier a été consulté",
            "body": f"{name} a consulté {resource_label}. Détails dans votre journal d'accès.",
            "data": {"pro_id": pro["id"], "route": "/audit-log"},
            "read": False,
            "created_at": now.isoformat(),
        })
    except Exception:
        pass


# ─────────────────────────────────────────────────────────────
# Modèles
# ─────────────────────────────────────────────────────────────
class RestrictionsIn(BaseModel):
    block_all: bool = False
    hidden_categories: List[str] = []


class ProfilSanteIn(BaseModel):
    groupe_sanguin: Optional[str] = Field(None, max_length=5)
    rhesus: Optional[Literal["+", "-"]] = None
    allergies: List[str] = []
    antecedents: List[str] = []
    traitements: List[str] = []


class CorrectionIn(BaseModel):
    target_type: Literal["consultation_note", "autre"]
    target_id: Optional[str] = None           # id de la note
    pro_id: Optional[str] = None              # requis si target_type = autre
    champ: Optional[Literal["diagnostic", "traitement", "notes"]] = None
    correction_demandee: str = Field(..., min_length=3, max_length=2000)
    motif: Optional[str] = Field(None, max_length=1000)


class CorrectionReponseIn(BaseModel):
    accepte: bool
    reponse: str = Field(..., min_length=3, max_length=2000)
    nouvelle_valeur: Optional[str] = Field(None, max_length=4000)


class ShareIn(BaseModel):
    duree_heures: Literal[24, 72, 168] = 72


def register_espace_maman_routes(app, api, db, get_current_user, require_roles, audit_log_fn):
    global _db
    _db = db

    # ── Droit à la limitation ────────────────────────────────
    @api.get("/espace-maman/restrictions")
    async def get_my_restrictions(user=Depends(require_roles("maman"))):
        r = await get_restrictions(user["id"])
        return {**r, "categories": RESTRICTABLE_CATEGORIES}

    @api.put("/espace-maman/restrictions")
    async def set_my_restrictions(payload: RestrictionsIn, user=Depends(require_roles("maman"))):
        cats = [c for c in payload.hidden_categories if c in RESTRICTABLE_CATEGORIES]
        doc = {"user_id": user["id"], "block_all": payload.block_all, "hidden_categories": cats, "updated_at": _now()}
        await db.privacy_restrictions.update_one({"user_id": user["id"]}, {"$set": doc}, upsert=True)
        await audit_log_fn(user=user, action="write", resource_type="Restriction", resource_id=user["id"],
                           details={"block_all": payload.block_all, "hidden": cats})
        return {**doc, "categories": RESTRICTABLE_CATEGORIES}

    # ── Profil santé (rectification directe par la maman) ─────
    async def _get_profil(uid: str) -> dict:
        p = await db.profil_sante_maman.find_one({"user_id": uid}, {"_id": 0}) or {}
        def dec(lst):
            out = []
            for v in lst or []:
                try:
                    out.append(decrypt_str(v))
                except Exception:
                    out.append(v)
            return out
        gross = await db.grossesses.find_one({"user_id": uid, "groupe_sanguin": {"$nin": [None, ""]}}, {"_id": 0}, sort=[("created_at", -1)])
        gs_g = str((gross or {}).get("groupe_sanguin") or "").strip().upper()
        rh_g = (gross or {}).get("rhesus")
        if gs_g and gs_g[-1] in "+-":  # "A+" stocké dans la grossesse → groupe + rhésus séparés
            gs_g, rh_g = gs_g[:-1], rh_g or gs_g[-1]
        return {
            "groupe_sanguin": p.get("groupe_sanguin") or gs_g or None,
            "rhesus": p.get("rhesus") or rh_g,
            "allergies": dec(p.get("allergies_enc")),
            "antecedents": dec(p.get("antecedents_enc")),
            "traitements": dec(p.get("traitements_enc")),
            "updated_at": p.get("updated_at"),
        }

    @api.get("/espace-maman/profil-sante")
    async def get_profil_sante(user=Depends(require_roles("maman"))):
        return await _get_profil(user["id"])

    @api.put("/espace-maman/profil-sante")
    async def put_profil_sante(payload: ProfilSanteIn, user=Depends(require_roles("maman"))):
        clean = lambda lst: [encrypt_str(s.strip()[:200]) for s in lst if s and s.strip()][:30]
        await db.profil_sante_maman.update_one({"user_id": user["id"]}, {"$set": {
            "user_id": user["id"],
            "groupe_sanguin": (payload.groupe_sanguin or "").upper() or None,
            "rhesus": payload.rhesus,
            "allergies_enc": clean(payload.allergies),
            "antecedents_enc": clean(payload.antecedents),
            "traitements_enc": clean(payload.traitements),
            "updated_at": _now(),
        }}, upsert=True)
        await audit_log_fn(user=user, action="write", resource_type="ProfilSante", resource_id=user["id"])
        return await _get_profil(user["id"])

    # ── Droit d'accès : inventaire + export ──────────────────
    @api.get("/espace-maman/mes-donnees")
    async def mes_donnees(user=Depends(require_roles("maman"))):
        uid = user["id"]
        enfants = await db.enfants.find({"user_id": uid}, {"_id": 0, "vaccins": 1, "mesures": 1}).to_list(100)
        notes_q = {"$or": [{"maman_id": uid}, {"patient_id": uid}]}
        return {
            "inventaire": [
                {"key": "profil", "label": "Profil & identité", "count": 1},
                {"key": "grossesses", "label": "Grossesses", "count": await db.grossesses.count_documents({"user_id": uid})},
                {"key": "enfants", "label": "Enfants", "count": len(enfants)},
                {"key": "vaccins", "label": "Vaccins enregistrés", "count": sum(len(e.get("vaccins") or []) for e in enfants)},
                {"key": "mesures", "label": "Mesures de croissance", "count": sum(len(e.get("mesures") or []) for e in enfants)},
                {"key": "rdv", "label": "Rendez-vous", "count": await db.rdv.count_documents({"maman_id": uid})},
                {"key": "notes", "label": "Notes médicales des pros", "count": await db.consultation_notes.count_documents(notes_q)},
                {"key": "documents", "label": "Documents", "count": await db.user_documents.count_documents({"user_id": uid})},
                {"key": "consents", "label": "Consentements", "count": await db.consents.count_documents({"maman_id": uid})},
                {"key": "messages", "label": "Messages", "count": await db.messages.count_documents({"$or": [{"from_id": uid}, {"to_id": uid}]})},
            ],
            "finalites": [
                "Suivi de votre santé, de votre grossesse et de vos enfants",
                "Partage avec les professionnels que vous autorisez",
                "Rappels de vaccins et de rendez-vous",
            ],
            "conservation": "Vos données sont conservées tant que votre compte est actif, puis supprimées sur demande.",
        }

    @api.get("/espace-maman/export")
    async def export_mes_donnees(user=Depends(require_roles("maman"))):
        uid = user["id"]
        me = await db.users.find_one({"id": uid}, {"_id": 0, "password_hash": 0, "totp_secret": 0, "push_token": 0})
        notes = [decrypt_consultation_note(n) for n in await db.consultation_notes.find(
            {"$or": [{"maman_id": uid}, {"patient_id": uid}]}, {"_id": 0, "attachment_base64": 0}).to_list(1000)]
        data = {
            "export_genere_le": _now(),
            "profil": me,
            "profil_sante": await _get_profil(uid),
            "grossesses": await db.grossesses.find({"user_id": uid}, {"_id": 0}).to_list(50),
            "enfants": [decrypt_enfant(e) for e in await db.enfants.find({"user_id": uid}, {"_id": 0, "photo": 0}).to_list(100)],
            "rdv": await db.rdv.find({"maman_id": uid}, {"_id": 0}).to_list(1000),
            "notes_medicales": notes,
            "documents": await db.user_documents.find({"user_id": uid}, {"_id": 0, "file_base64": 0}).to_list(500),
            "consentements": await db.consents.find({"maman_id": uid}, {"_id": 0}).to_list(500),
            "restrictions": await get_restrictions(uid),
        }
        await audit_log_fn(user=user, action="export", resource_type="Export.RGPD", resource_id=uid)
        return data

    # ── Droit de rectification ───────────────────────────────
    @api.get("/espace-maman/corrections/cibles")
    async def correction_targets(user=Depends(require_roles("maman"))):
        """Notes médicales et professionnels pouvant faire l'objet d'une demande."""
        uid = user["id"]
        raw = await db.consultation_notes.find({"$or": [{"maman_id": uid}, {"patient_id": uid}]},
                                               {"_id": 0, "attachment_base64": 0}).sort("date", -1).to_list(200)
        notes = []
        for n in raw:
            d = decrypt_consultation_note(n)
            notes.append({k: d.get(k) for k in ("id", "date", "pro_id", "pro_name", "diagnostic", "traitement", "notes", "patient_type")})
        pro_ids = list({r["pro_id"] for r in await db.rdv.find({"maman_id": uid}, {"_id": 0, "pro_id": 1}).to_list(500) if r.get("pro_id")})
        pros = await db.users.find({"id": {"$in": pro_ids}}, {"_id": 0, "id": 1, "name": 1, "specialite": 1}).to_list(200)
        return {"notes": notes, "pros": pros}

    @api.post("/espace-maman/corrections")
    async def create_correction(payload: CorrectionIn, user=Depends(require_roles("maman"))):
        uid = user["id"]
        valeur_actuelle = None
        pro_id = payload.pro_id
        if payload.target_type == "autre":
            payload.champ = None
            payload.target_id = None
        if payload.target_type == "consultation_note":
            if not payload.target_id or not payload.champ:
                raise HTTPException(400, "Note et champ requis")
            note = await db.consultation_notes.find_one(
                {"id": payload.target_id, "$or": [{"maman_id": uid}, {"patient_id": uid}]}, {"_id": 0})
            if not note:
                raise HTTPException(404, "Note introuvable")
            pro_id = note["pro_id"]
            valeur_actuelle = decrypt_consultation_note(note).get(payload.champ)
        else:
            if not pro_id or not await db.rdv.find_one({"maman_id": uid, "pro_id": pro_id}):
                raise HTTPException(400, "Choisissez un professionnel qui vous a suivie")
        pro = await db.users.find_one({"id": pro_id}, {"_id": 0, "name": 1})
        doc = {
            "id": str(uuid.uuid4()),
            "maman_id": uid,
            "maman_name": user.get("name"),
            "pro_id": pro_id,
            "pro_name": (pro or {}).get("name"),
            "target_type": payload.target_type,
            "target_id": payload.target_id,
            "champ": payload.champ,
            "valeur_actuelle": valeur_actuelle,
            "correction_demandee": payload.correction_demandee.strip(),
            "motif": (payload.motif or "").strip() or None,
            "status": "en_attente",
            "created_at": _now(),
        }
        await db.correction_requests.insert_one(dict(doc))
        await db.notifications.insert_one({
            "id": str(uuid.uuid4()), "user_id": pro_id, "type": "correction_demandee",
            "title": "✏️ Demande de correction",
            "body": f"{user.get('name', 'Une patiente')} demande la correction d'une information de son dossier.",
            "data": {"correction_id": doc["id"], "route": "/pro/corrections"}, "read": False, "created_at": _now(),
        })
        await audit_log_fn(user=user, action="write", resource_type="Correction", resource_id=uid, details={"correction_id": doc["id"]})
        return doc

    @api.get("/espace-maman/corrections")
    async def my_corrections(user=Depends(require_roles("maman"))):
        return await db.correction_requests.find({"maman_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)

    @api.get("/pro/corrections")
    async def pro_corrections(user=Depends(require_roles("professionnel"))):
        return await db.correction_requests.find({"pro_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(300)

    @api.post("/pro/corrections/{cid}/repondre")
    async def pro_answer_correction(cid: str, payload: CorrectionReponseIn, user=Depends(require_roles("professionnel"))):
        c = await db.correction_requests.find_one({"id": cid, "pro_id": user["id"]}, {"_id": 0})
        if not c:
            raise HTTPException(404, "Demande introuvable")
        if c["status"] != "en_attente":
            raise HTTPException(400, "Demande déjà traitée")
        applied = False
        if payload.accepte and c["target_type"] == "consultation_note" and c.get("champ"):
            new_val = (payload.nouvelle_valeur or c["correction_demandee"]).strip()
            await db.consultation_notes.update_one({"id": c["target_id"], "pro_id": user["id"]}, {
                "$set": {c["champ"]: encrypt_str(new_val), "updated_at": _now()},
                "$push": {"corrections": {"correction_id": cid, "champ": c["champ"], "date": _now()}},
            })
            applied = True
        status = "acceptee" if payload.accepte else "refusee"
        await db.correction_requests.update_one({"id": cid}, {"$set": {
            "status": status, "pro_reponse": payload.reponse.strip(), "applied": applied, "resolved_at": _now(),
        }})
        await db.notifications.insert_one({
            "id": str(uuid.uuid4()), "user_id": c["maman_id"], "type": "correction_traitee",
            "title": "✅ Correction acceptée" if payload.accepte else "❌ Correction refusée",
            "body": f"{user.get('name', 'Le professionnel')} : {payload.reponse.strip()[:120]}",
            "data": {"correction_id": cid, "route": "/espace-maman/corrections"}, "read": False, "created_at": _now(),
        })
        await audit_log_fn(user=user, action="write", resource_type="Correction", resource_id=c["maman_id"],
                           details={"correction_id": cid, "status": status})
        return {"ok": True, "status": status, "applied": applied}

    @api.get("/admin/corrections")
    async def admin_corrections(user=Depends(require_roles("admin"))):
        return await db.correction_requests.find({}, {"_id": 0, "valeur_actuelle": 0}).sort("created_at", -1).to_list(500)

    # ── Résumé de parcours ───────────────────────────────────
    async def _build_resume(uid: str) -> dict:
        me = await db.users.find_one({"id": uid}, {"_id": 0, "name": 1, "phone": 1, "ville": 1, "date_naissance": 1})
        grossesses = await db.grossesses.find({"user_id": uid}, {"_id": 0}).sort("date_debut", -1).to_list(20)
        naissances = await db.naissances.find({"user_id": uid}, {"_id": 0}).to_list(20)
        enfants_out = []
        for e in await db.enfants.find({"user_id": uid}, {"_id": 0, "photo": 0}).to_list(50):
            e = decrypt_enfant(e)
            mesures = sorted([m for m in e.get("mesures") or [] if m.get("poids_kg") or m.get("taille_cm")],
                             key=lambda m: str(m.get("date") or ""))
            enfants_out.append({
                "nom": e.get("nom"), "sexe": e.get("sexe"), "date_naissance": str(e.get("date_naissance") or "")[:10],
                "groupe_sanguin": e.get("groupe_sanguin"), "allergies": e.get("allergies") or [],
                "vaccins": sorted([{"nom": v.get("nom"), "date": str(v.get("date") or "")[:10]} for v in e.get("vaccins") or []],
                                  key=lambda v: v["date"]),
                "derniere_mesure": ({"date": str(mesures[-1].get("date"))[:10], "poids_kg": mesures[-1].get("poids_kg"),
                                     "taille_cm": mesures[-1].get("taille_cm")} if mesures else None),
                "nb_mesures": len(mesures),
            })
        now_iso = _now()
        rdvs = await db.rdv.find({"maman_id": uid, "date": {"$lte": now_iso}, "status": {"$nin": ["annule", "cancelled", "refuse"]}},
                                 {"_id": 0}).sort("date", -1).to_list(50)
        pro_ids = list({r.get("pro_id") for r in rdvs if r.get("pro_id")})
        pros = {p["id"]: p for p in await db.users.find({"id": {"$in": pro_ids}}, {"_id": 0, "id": 1, "name": 1, "specialite": 1}).to_list(200)}
        notes = [decrypt_consultation_note(n) for n in await db.consultation_notes.find(
            {"$or": [{"maman_id": uid}, {"patient_id": uid}]}, {"_id": 0, "attachment_base64": 0}).sort("date", -1).to_list(50)]
        docs = await db.user_documents.find({"user_id": uid}, {"_id": 0, "titre": 1, "categorie": 1, "date": 1}).sort("date", -1).to_list(100)
        return {
            "maman": {"nom": (me or {}).get("name"), "ville": (me or {}).get("ville"), "telephone": (me or {}).get("phone")},
            "profil_sante": await _get_profil(uid),
            "grossesses": [{"date_debut": str(g.get("date_debut") or "")[:10], "date_terme": str(g.get("date_terme") or "")[:10],
                            "active": g.get("active"), "parite": g.get("parite")} for g in grossesses],
            "accouchements": [{"enfant": n.get("enfant_nom"), "date": str(n.get("enfant_date_naissance") or "")[:10],
                               "lieu": n.get("lieu_naissance"), "poids_g": n.get("poids_naissance_g"),
                               "taille_cm": n.get("taille_naissance_cm")} for n in naissances],
            "enfants": enfants_out,
            "consultations": [{"date": str(r.get("date") or "")[:10], "motif": r.get("motif") or r.get("prestation_nom"),
                               "pro": pros.get(r.get("pro_id"), {}).get("name"), "specialite": pros.get(r.get("pro_id"), {}).get("specialite"),
                               "mode": r.get("type_consultation") or r.get("mode")} for r in rdvs],
            "notes": [{"date": str(n.get("date") or "")[:10], "pro": n.get("pro_name"), "diagnostic": n.get("diagnostic"),
                       "traitement": n.get("traitement")} for n in notes if n.get("diagnostic") or n.get("traitement")],
            "documents": [{"titre": d.get("titre"), "categorie": d.get("categorie"), "date": str(d.get("date") or "")[:10]} for d in docs],
            "genere_le": now_iso,
        }

    @api.get("/espace-maman/resume")
    async def get_resume(user=Depends(require_roles("maman"))):
        return await _build_resume(user["id"])

    def _resume_pdf(r: dict) -> bytes:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib import colors
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
        buf = io.BytesIO()
        doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=36, rightMargin=36, topMargin=36, bottomMargin=36,
                                title="Résumé de parcours — À lo Maman")
        ss = getSampleStyleSheet()
        h1 = ParagraphStyle("h1", parent=ss["Title"], textColor=colors.HexColor("#C85A40"), fontSize=18)
        h2 = ParagraphStyle("h2", parent=ss["Heading2"], textColor=colors.HexColor("#2D332F"), fontSize=12, spaceBefore=10)
        p = ParagraphStyle("p", parent=ss["BodyText"], fontSize=9, leading=12)
        esc = lambda v: html.escape(str(v)) if v not in (None, "") else "—"
        el = [Paragraph("Résumé de parcours de santé", h1),
              Paragraph(f"<b>{esc(r['maman']['nom'])}</b> · {esc(r['maman']['ville'])} · généré le {r['genere_le'][:10]}", p)]

        def table(headers, rows):
            if not rows:
                el.append(Paragraph("<i>Aucune donnée</i>", p)); return
            t = Table([headers] + [[Paragraph(esc(c), p) for c in row] for row in rows], repeatRows=1)
            t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F8EBE8")),
                                   ("FONTSIZE", (0, 0), (-1, 0), 9), ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#E6E2D8")),
                                   ("VALIGN", (0, 0), (-1, -1), "TOP")]))
            el.append(t)

        ps = r["profil_sante"]
        el.append(Paragraph("Informations essentielles", h2))
        gs = f"{ps.get('groupe_sanguin') or '—'}{ps.get('rhesus') or ''}"
        el.append(Paragraph(f"<b>Groupe sanguin :</b> {esc(gs)}<br/><b>Allergies :</b> {esc(', '.join(ps['allergies']))}"
                            f"<br/><b>Antécédents :</b> {esc(', '.join(ps['antecedents']))}"
                            f"<br/><b>Traitements en cours :</b> {esc(', '.join(ps['traitements']))}", p))
        el.append(Paragraph("Grossesses", h2))
        table(["Début", "Terme prévu", "Statut"], [[g["date_debut"], g["date_terme"], "En cours" if g["active"] else "Terminée"] for g in r["grossesses"]])
        el.append(Paragraph("Accouchements", h2))
        table(["Enfant", "Date", "Lieu", "Poids (g)", "Taille (cm)"], [[a["enfant"], a["date"], a["lieu"], a["poids_g"], a["taille_cm"]] for a in r["accouchements"]])
        el.append(Paragraph("Enfants — vaccins et croissance", h2))
        for e in r["enfants"]:
            dm = e["derniere_mesure"]
            el.append(Paragraph(f"<b>{esc(e['nom'])}</b> ({esc(e['sexe'])}, né(e) le {esc(e['date_naissance'])}) · "
                                f"Groupe : {esc(e['groupe_sanguin'])} · Allergies : {esc(', '.join(e['allergies']))}<br/>"
                                f"Dernière mesure : {esc(dm and dm['date'])} — {esc(dm and dm['poids_kg'])} kg / {esc(dm and dm['taille_cm'])} cm "
                                f"({e['nb_mesures']} mesures)", p))
            table(["Vaccin", "Date"], [[v["nom"], v["date"]] for v in e["vaccins"]])
            el.append(Spacer(1, 6))
        if not r["enfants"]:
            el.append(Paragraph("<i>Aucun enfant enregistré</i>", p))
        el.append(Paragraph("Consultations passées", h2))
        table(["Date", "Professionnel", "Spécialité", "Motif"], [[c["date"], c["pro"], c["specialite"], c["motif"]] for c in r["consultations"]])
        el.append(Paragraph("Diagnostics & traitements", h2))
        table(["Date", "Professionnel", "Diagnostic", "Traitement"], [[n["date"], n["pro"], n["diagnostic"], n["traitement"]] for n in r["notes"]])
        el.append(Paragraph("Documents médicaux", h2))
        table(["Titre", "Catégorie", "Date"], [[d["titre"], d["categorie"], d["date"]] for d in r["documents"]])
        el.append(Spacer(1, 12))
        el.append(Paragraph("<i>Document confidentiel partagé par la patiente via À lo Maman. Ne pas diffuser.</i>", p))
        doc.build(el)
        return buf.getvalue()

    @api.get("/espace-maman/resume/pdf")
    async def my_resume_pdf(user=Depends(require_roles("maman"))):
        pdf = _resume_pdf(await _build_resume(user["id"]))
        return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": 'attachment; filename="resume-parcours.pdf"'})

    @api.post("/espace-maman/resume/partages")
    async def create_share(payload: ShareIn, user=Depends(require_roles("maman"))):
        token = uuid.uuid4().hex + uuid.uuid4().hex[:8]
        exp = datetime.now(timezone.utc) + timedelta(hours=payload.duree_heures)
        doc = {"id": str(uuid.uuid4()), "token": token, "user_id": user["id"], "created_at": _now(),
               "expires_at": exp.isoformat(), "revoked": False, "views": 0, "last_view_at": None}
        await db.resume_shares.insert_one(dict(doc))
        await audit_log_fn(user=user, action="export", resource_type="Resume.partage", resource_id=user["id"],
                           details={"duree_heures": payload.duree_heures})
        return {**doc, "path": f"/api/resume-partage/{token}", "pdf_path": f"/api/resume-partage/{token}/pdf"}

    @api.get("/espace-maman/resume/partages")
    async def list_shares(user=Depends(require_roles("maman"))):
        items = await db.resume_shares.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(50)
        now = datetime.now(timezone.utc)
        for s in items:
            s["actif"] = not s.get("revoked") and datetime.fromisoformat(s["expires_at"]) > now
            s["path"] = f"/api/resume-partage/{s['token']}"
            s["pdf_path"] = f"/api/resume-partage/{s['token']}/pdf"
        return items

    @api.delete("/espace-maman/resume/partages/{sid}")
    async def revoke_share(sid: str, user=Depends(require_roles("maman"))):
        res = await db.resume_shares.update_one({"id": sid, "user_id": user["id"]}, {"$set": {"revoked": True, "revoked_at": _now()}})
        if res.matched_count == 0:
            raise HTTPException(404, "Lien introuvable")
        await audit_log_fn(user=user, action="write", resource_type="Resume.partage", resource_id=user["id"], details={"revoked": sid})
        return {"ok": True}

    async def _open_share(token: str, request: Request, fmt: str) -> dict:
        s = await db.resume_shares.find_one({"token": token}, {"_id": 0})
        if not s or s.get("revoked"):
            raise HTTPException(404, "Lien invalide ou révoqué")
        if datetime.fromisoformat(s["expires_at"]) < datetime.now(timezone.utc):
            raise HTTPException(410, "Lien expiré")
        await db.resume_shares.update_one({"token": token}, {"$inc": {"views": 1}, "$set": {"last_view_at": _now()}})
        await db.audit_log.insert_one({
            "id": str(uuid.uuid4()), "user_id": "lien-partage", "user_role": "lien_partage",
            "user_name": "Personne disposant du lien", "action": "read", "resource_type": "Resume.partage",
            "resource_id": s["user_id"], "details": {"format": fmt, "ip": request.client.host if request.client else None},
            "timestamp": _now(),
        })
        # Notification (1/h par lien)
        key = f"share:{token}"
        t = await db.access_notif_throttle.find_one({"key": key})
        now = datetime.now(timezone.utc)
        if not (t and datetime.fromisoformat(t["last"]) > now - timedelta(hours=1)):
            await db.access_notif_throttle.update_one({"key": key}, {"$set": {"last": now.isoformat()}}, upsert=True)
            await db.notifications.insert_one({
                "id": str(uuid.uuid4()), "user_id": s["user_id"], "type": "acces_partage",
                "title": "🔗 Votre résumé a été ouvert",
                "body": "Une personne disposant de votre lien de partage a consulté votre résumé de parcours.",
                "data": {"route": "/audit-log"}, "read": False, "created_at": _now(),
            })
        return s

    @api.get("/resume-partage/{token}/pdf")
    async def public_resume_pdf(token: str, request: Request):
        s = await _open_share(token, request, "pdf")
        pdf = _resume_pdf(await _build_resume(s["user_id"]))
        return Response(pdf, media_type="application/pdf",
                        headers={"Content-Disposition": 'inline; filename="resume-parcours.pdf"', "Cache-Control": "no-store"})

    @api.get("/resume-partage/{token}", response_class=HTMLResponse)
    async def public_resume_html(token: str, request: Request):
        try:
            s = await _open_share(token, request, "html")
        except HTTPException as e:
            return HTMLResponse(f"<html><meta name='viewport' content='width=device-width'><body style='font-family:sans-serif;padding:24px'>"
                                f"<h2>À lo Maman</h2><p>{html.escape(str(e.detail))}</p></body></html>", status_code=e.status_code)
        r = await _build_resume(s["user_id"])
        esc = lambda v: html.escape(str(v)) if v not in (None, "") else "—"
        def rows(items, keys):
            if not items:
                return "<p class='m'>Aucune donnée</p>"
            return "<table>" + "".join("<tr>" + "".join(f"<td>{esc(i.get(k))}</td>" for k in keys) + "</tr>" for i in items) + "</table>"
        ps = r["profil_sante"]
        enf = "".join(
            f"<div class='card'><b>{esc(e['nom'])}</b> · né(e) le {esc(e['date_naissance'])}<br>"
            f"Dernière mesure : {esc(e['derniere_mesure'] and e['derniere_mesure']['poids_kg'])} kg / "
            f"{esc(e['derniere_mesure'] and e['derniere_mesure']['taille_cm'])} cm"
            f"<br>Allergies : {esc(', '.join(e['allergies']))}{rows(e['vaccins'], ['nom', 'date'])}</div>" for e in r["enfants"]
        ) or "<p class='m'>Aucun enfant</p>"
        body = f"""<!doctype html><html lang='fr'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>
<meta name='robots' content='noindex'><title>Résumé de parcours</title><style>
body{{font-family:-apple-system,Roboto,sans-serif;background:#FDFBF7;color:#2D332F;margin:0;padding:16px;max-width:760px;margin:auto}}
h1{{color:#C85A40;font-size:22px}}h2{{font-size:16px;margin-top:22px;border-bottom:1px solid #E6E2D8;padding-bottom:4px}}
table{{width:100%;border-collapse:collapse;font-size:13px;margin-top:6px}}td{{border-bottom:1px solid #EEE;padding:6px 4px}}
.card{{background:#fff;border:1px solid #E6E2D8;border-radius:12px;padding:12px;margin:8px 0;font-size:14px}}.m{{color:#8A8178;font-style:italic}}
.btn{{display:inline-block;background:#C85A40;color:#fff;padding:10px 16px;border-radius:999px;text-decoration:none;font-weight:700}}
.warn{{font-size:12px;color:#8A8178;margin-top:24px}}</style></head><body>
<h1>Résumé de parcours de santé</h1><p><b>{esc(r['maman']['nom'])}</b> · {esc(r['maman']['ville'])}<br>
<span class='m'>Lien valable jusqu'au {s['expires_at'][:16].replace('T', ' ')} UTC</span></p>
<a class='btn' href='/api/resume-partage/{token}/pdf'>Télécharger le PDF</a>
<h2>Informations essentielles</h2><div class='card'>Groupe sanguin : <b>{esc((ps.get('groupe_sanguin') or '') + (ps.get('rhesus') or ''))}</b><br>
Allergies : {esc(', '.join(ps['allergies']))}<br>Antécédents : {esc(', '.join(ps['antecedents']))}<br>Traitements : {esc(', '.join(ps['traitements']))}</div>
<h2>Grossesses</h2>{rows(r['grossesses'], ['date_debut', 'date_terme'])}
<h2>Accouchements</h2>{rows(r['accouchements'], ['enfant', 'date', 'lieu'])}
<h2>Enfants</h2>{enf}
<h2>Consultations passées</h2>{rows(r['consultations'], ['date', 'pro', 'specialite', 'motif'])}
<h2>Diagnostics & traitements</h2>{rows(r['notes'], ['date', 'pro', 'diagnostic', 'traitement'])}
<h2>Documents médicaux</h2>{rows(r['documents'], ['titre', 'categorie', 'date'])}
<p class='warn'>Document confidentiel partagé par la patiente. Chaque consultation de ce lien est enregistrée et signalée à la patiente.</p>
</body></html>"""
        return HTMLResponse(body, headers={"Cache-Control": "no-store"})

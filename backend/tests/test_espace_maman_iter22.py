# Espace Maman (RGPD rights: access / rectification / restriction, resume share, access notifications) — iteration 22
import os
import time
import pytest
import requests
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")
BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

MAMAN = ("maman.test@alomaman.dev", "Test1234!")
PRO = ("pro.test@alomaman.dev", "Test1234!")
ADMIN = ("klenakan.eric@gmail.com", "474Treckadzo$1986")


def _login(email, pwd):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pwd}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"login failed {email}: {r.status_code} {r.text[:200]}")
    d = r.json()
    return d["token"], d["user"]


def _h(t):
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def ctx():
    mt, mu = _login(*MAMAN)
    pt, pu = _login(*PRO)
    at, _ = _login(*ADMIN)
    db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    c = {"m": mt, "mu": mu, "p": pt, "pu": pu, "a": at, "db": db, "shares": []}
    yield c
    # CLEANUP: reset restrictions + revoke shares + remove test note
    requests.put(f"{API}/espace-maman/restrictions", headers=_h(mt), json={"block_all": False, "hidden_categories": []})
    for sid in c["shares"]:
        requests.delete(f"{API}/espace-maman/resume/partages/{sid}", headers=_h(mt))
    if c.get("note_id"):
        db.consultation_notes.delete_one({"id": c["note_id"]})
    db.correction_requests.delete_many({"correction_demandee": {"$regex": "^TEST_"}})


def _notifs(token):
    r = requests.get(f"{API}/notifications", headers=_h(token))
    assert r.status_code == 200
    d = r.json()
    return d if isinstance(d, list) else d.get("items") or d.get("notifications") or []


# ── Restrictions
class TestRestrictions:
    def test_get_put_and_filter(self, ctx):
        r = requests.get(f"{API}/espace-maman/restrictions", headers=_h(ctx["m"]))
        assert r.status_code == 200 and "categories" in r.json()
        r = requests.put(f"{API}/espace-maman/restrictions", headers=_h(ctx["m"]),
                         json={"block_all": False, "hidden_categories": ["grossesse", "bogus"]})
        assert r.status_code == 200
        assert r.json()["hidden_categories"] == ["grossesse"]
        g = requests.get(f"{API}/espace-maman/restrictions", headers=_h(ctx["m"])).json()
        assert g["hidden_categories"] == ["grossesse"] and g["block_all"] is False
        requests.put(f"{API}/espace-maman/restrictions", headers=_h(ctx["m"]), json={"block_all": False, "hidden_categories": []})

    def test_pro_forbidden(self, ctx):
        r = requests.get(f"{API}/espace-maman/restrictions", headers=_h(ctx["p"]))
        assert r.status_code == 403


# ── Profil santé
class TestProfilSante:
    def test_put_get_encrypted(self, ctx):
        payload = {"groupe_sanguin": "o", "rhesus": "+", "allergies": ["TEST_Pénicilline", " "], "antecedents": ["TEST_HTA"], "traitements": []}
        r = requests.put(f"{API}/espace-maman/profil-sante", headers=_h(ctx["m"]), json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["groupe_sanguin"] == "O" and d["rhesus"] == "+" and d["allergies"] == ["TEST_Pénicilline"]
        raw = ctx["db"].profil_sante_maman.find_one({"user_id": ctx["mu"]["id"]})
        assert "TEST_Pénicilline" not in str(raw.get("allergies_enc"))
        g = requests.get(f"{API}/espace-maman/profil-sante", headers=_h(ctx["m"])).json()
        assert g["antecedents"] == ["TEST_HTA"]

    def test_invalid_rhesus(self, ctx):
        r = requests.put(f"{API}/espace-maman/profil-sante", headers=_h(ctx["m"]), json={"rhesus": "x"})
        assert r.status_code == 422


# ── Accès / export
class TestAccess:
    def test_inventaire(self, ctx):
        r = requests.get(f"{API}/espace-maman/mes-donnees", headers=_h(ctx["m"]))
        assert r.status_code == 200
        keys = {i["key"] for i in r.json()["inventaire"]}
        assert {"profil", "grossesses", "enfants", "vaccins", "rdv", "notes", "documents", "consents"} <= keys

    def test_export_no_secrets(self, ctx):
        r = requests.get(f"{API}/espace-maman/export", headers=_h(ctx["m"]))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["profil"]["id"] == ctx["mu"]["id"]
        assert "password_hash" not in d["profil"] and "totp_secret" not in d["profil"]
        assert "\"_id\"" not in r.text


# ── Corrections (maman -> pro -> applied)
class TestCorrections:
    def test_full_flow_note(self, ctx):
        mid = ctx["mu"]["id"]
        r = requests.post(f"{API}/pro/consultation-notes", headers=_h(ctx["p"]), json={"patient_id": mid, "diagnostic": "TEST_DiagOriginal"})
        assert r.status_code == 200, r.text
        ctx["note_id"] = r.json()["id"]
        t = requests.get(f"{API}/espace-maman/corrections/cibles", headers=_h(ctx["m"])).json()
        assert any(n["id"] == ctx["note_id"] and n["diagnostic"] == "TEST_DiagOriginal" for n in t["notes"])
        assert any(p["id"] == ctx["pu"]["id"] for p in t["pros"])
        r = requests.post(f"{API}/espace-maman/corrections", headers=_h(ctx["m"]), json={
            "target_type": "consultation_note", "target_id": ctx["note_id"], "champ": "diagnostic",
            "correction_demandee": "TEST_DiagCorrige", "motif": "erreur"})
        assert r.status_code == 200, r.text
        c = r.json()
        assert c["status"] == "en_attente" and c["valeur_actuelle"] == "TEST_DiagOriginal" and c["pro_id"] == ctx["pu"]["id"]
        cid = c["id"]
        assert any(x["id"] == cid for x in requests.get(f"{API}/espace-maman/corrections", headers=_h(ctx["m"])).json())
        assert any(x["id"] == cid for x in requests.get(f"{API}/pro/corrections", headers=_h(ctx["p"])).json())
        assert any(n.get("type") == "correction_demandee" for n in _notifs(ctx["p"]))
        r = requests.post(f"{API}/pro/corrections/{cid}/repondre", headers=_h(ctx["p"]),
                          json={"accepte": True, "reponse": "OK corrigé", "nouvelle_valeur": "TEST_DiagFinal"})
        assert r.status_code == 200 and r.json()["applied"] is True
        r2 = requests.post(f"{API}/pro/corrections/{cid}/repondre", headers=_h(ctx["p"]), json={"accepte": False, "reponse": "again"})
        assert r2.status_code == 400
        dos = requests.get(f"{API}/pro/dossier/{mid}", headers=_h(ctx["p"])).json()
        note = next(n for n in dos["notes"] if n["id"] == ctx["note_id"])
        assert note["diagnostic"] == "TEST_DiagFinal"
        assert any(n.get("type") == "correction_traitee" for n in _notifs(ctx["m"]))
        adm = requests.get(f"{API}/admin/corrections", headers=_h(ctx["a"]))
        assert adm.status_code == 200 and any(x["id"] == cid for x in adm.json())

    def test_autre_and_refuse(self, ctx):
        r = requests.post(f"{API}/espace-maman/corrections", headers=_h(ctx["m"]), json={
            "target_type": "autre", "pro_id": ctx["pu"]["id"], "correction_demandee": "TEST_autre correction"})
        assert r.status_code == 200, r.text
        cid = r.json()["id"]
        r = requests.post(f"{API}/pro/corrections/{cid}/repondre", headers=_h(ctx["p"]), json={"accepte": False, "reponse": "Non justifié"})
        assert r.status_code == 200 and r.json()["status"] == "refusee" and r.json()["applied"] is False

    def test_invalid_targets(self, ctx):
        r = requests.post(f"{API}/espace-maman/corrections", headers=_h(ctx["m"]), json={
            "target_type": "autre", "pro_id": "nope", "correction_demandee": "TEST_xxx"})
        assert r.status_code == 400
        r = requests.post(f"{API}/espace-maman/corrections", headers=_h(ctx["m"]), json={
            "target_type": "consultation_note", "correction_demandee": "TEST_xxx"})
        assert r.status_code == 400
        r = requests.post(f"{API}/espace-maman/corrections", headers=_h(ctx["m"]), json={
            "target_type": "consultation_note", "target_id": "nope", "champ": "notes", "correction_demandee": "TEST_xxx"})
        assert r.status_code == 404
        assert requests.get(f"{API}/admin/corrections", headers=_h(ctx["m"])).status_code == 403


# ── Résumé + partage
class TestResume:
    def test_resume_json_pdf(self, ctx):
        r = requests.get(f"{API}/espace-maman/resume", headers=_h(ctx["m"]))
        assert r.status_code == 200
        d = r.json()
        for k in ("maman", "profil_sante", "grossesses", "accouchements", "enfants", "consultations", "notes", "documents"):
            assert k in d
        p = requests.get(f"{API}/espace-maman/resume/pdf", headers=_h(ctx["m"]))
        assert p.status_code == 200 and p.headers["content-type"].startswith("application/pdf") and p.content[:4] == b"%PDF"
        assert requests.get(f"{API}/espace-maman/resume/pdf").status_code in (401, 403)

    def test_share_lifecycle(self, ctx):
        assert requests.post(f"{API}/espace-maman/resume/partages", headers=_h(ctx["m"]), json={"duree_heures": 5}).status_code == 422
        r = requests.post(f"{API}/espace-maman/resume/partages", headers=_h(ctx["m"]), json={"duree_heures": 24})
        assert r.status_code == 200, r.text
        s = r.json()
        ctx["shares"].append(s["id"])
        assert s["path"] == f"/api/resume-partage/{s['token']}"
        ctx["db"].access_notif_throttle.delete_one({"key": f"share:{s['token']}"})
        h = requests.get(f"{BASE_URL}{s['path']}")
        assert h.status_code == 200 and "Résumé de parcours" in h.text
        pdf = requests.get(f"{BASE_URL}{s['path']}/pdf")
        assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"
        lst = requests.get(f"{API}/espace-maman/resume/partages", headers=_h(ctx["m"])).json()
        me = next(x for x in lst if x["id"] == s["id"])
        assert me["actif"] is True and me["views"] >= 2
        logs = requests.get(f"{API}/audit-log/me", headers=_h(ctx["m"])).json()
        items = logs if isinstance(logs, list) else logs.get("events") or logs.get("items") or []
        assert any(l.get("resource_type") == "Resume.partage" and l.get("user_role") == "lien_partage" for l in items), str(logs)[:300]
        assert any(n.get("type") == "acces_partage" for n in _notifs(ctx["m"]))
        d = requests.delete(f"{API}/espace-maman/resume/partages/{s['id']}", headers=_h(ctx["m"]))
        assert d.status_code == 200
        assert requests.get(f"{BASE_URL}{s['path']}").status_code == 404
        assert requests.get(f"{BASE_URL}{s['path']}/pdf").status_code == 404
        lst = requests.get(f"{API}/espace-maman/resume/partages", headers=_h(ctx["m"])).json()
        assert next(x for x in lst if x["id"] == s["id"])["actif"] is False


# ── Enforcement sur /pro/dossier
class TestEnforcement:
    def test_normal_access_and_notif(self, ctx):
        mid = ctx["mu"]["id"]
        ctx["db"].access_notif_throttle.delete_one({"key": f"{ctx['pu']['id']}:{mid}"})
        r = requests.get(f"{API}/pro/dossier/{mid}", headers=_h(ctx["p"]))
        assert r.status_code == 200 and r.json()["acces_urgence"] is False
        n = [x for x in _notifs(ctx["m"]) if x.get("type") == "acces_dossier"]
        assert n and "consulté" in n[0]["title"]
        before = len(n)
        requests.get(f"{API}/pro/dossier/{mid}", headers=_h(ctx["p"]))
        after = len([x for x in _notifs(ctx["m"]) if x.get("type") == "acces_dossier"])
        assert after == before  # throttled 1/h

    def test_block_all_and_urgence(self, ctx):
        mid = ctx["mu"]["id"]
        requests.put(f"{API}/espace-maman/restrictions", headers=_h(ctx["m"]), json={"block_all": True, "hidden_categories": []})
        try:
            assert requests.get(f"{API}/pro/dossier/{mid}", headers=_h(ctx["p"])).status_code == 423
            assert requests.get(f"{API}/pro/dossier/{mid}", headers=_h(ctx["p"]), params={"urgence": "true", "motif": "court"}).status_code == 423
            r = requests.get(f"{API}/pro/dossier/{mid}", headers=_h(ctx["p"]), params={"urgence": "true", "motif": "Hémorragie aux urgences"})
            assert r.status_code == 200 and r.json()["acces_urgence"] is True
            assert any(x.get("type") == "acces_urgence" for x in _notifs(ctx["m"]))
            logs = requests.get(f"{API}/audit-log/me", headers=_h(ctx["m"])).json()
            items = logs if isinstance(logs, list) else logs.get("events") or logs.get("items") or []
            assert any((l.get("details") or {}).get("urgence") is True for l in items)
        finally:
            requests.put(f"{API}/espace-maman/restrictions", headers=_h(ctx["m"]), json={"block_all": False, "hidden_categories": []})

    def test_hidden_categories(self, ctx):
        mid = ctx["mu"]["id"]
        requests.put(f"{API}/espace-maman/restrictions", headers=_h(ctx["m"]), json={"block_all": False, "hidden_categories": ["grossesse", "vaccins"]})
        try:
            d = requests.get(f"{API}/pro/dossier/{mid}", headers=_h(ctx["p"])).json()
            assert d["grossesse"] is None
            assert len(d["restrictions_actives"]) == 2
            assert all(e.get("vaccins") == [] for e in d["enfants"])
        finally:
            requests.put(f"{API}/espace-maman/restrictions", headers=_h(ctx["m"]), json={"block_all": False, "hidden_categories": []})

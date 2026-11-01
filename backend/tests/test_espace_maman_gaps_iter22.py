# Espace Maman — gap checks: hidden categories on FHIR/carnet endpoints, expired share link (410)
import os
import requests
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")
API = os.environ.get("EXPO_PUBLIC_BACKEND_URL").rstrip("/") + "/api"


def _login(e, p):
    d = requests.post(f"{API}/auth/login", json={"email": e, "password": p}).json()
    return {"Authorization": f"Bearer {d['token']}"}, d["user"]


def test_gaps():
    mh, mu = _login("maman.test@alomaman.dev", "Test1234!")
    ph, pu = _login("pro.test@alomaman.dev", "Test1234!")
    db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    enf = db.enfants.find_one({"user_id": mu["id"]}, {"_id": 0, "id": 1, "vaccins": 1})
    print("enfant", enf and enf["id"], "nb vaccins", len((enf or {}).get("vaccins") or []))
    requests.put(f"{API}/espace-maman/restrictions", headers=mh, json={"block_all": False, "hidden_categories": ["vaccins", "croissance"]})
    try:
        if enf:
            r = requests.get(f"{API}/fhir/Immunization", headers=ph, params={"subject": enf["id"]})
            print("FHIR Immunization with vaccins hidden:", r.status_code, (r.json().get("total") if r.ok else r.text[:150]))
            r = requests.get(f"{API}/fhir/Observation", headers=ph, params={"subject": enf["id"]})
            print("FHIR Observation with croissance hidden:", r.status_code, (r.json().get("total") if r.ok else r.text[:150]))
            r = requests.get(f"{API}/enfants/{enf['id']}/carnet/export/pdf", headers=ph)
            print("carnet export pdf (pro) with vaccins hidden:", r.status_code, r.headers.get("content-type"))
    finally:
        requests.put(f"{API}/espace-maman/restrictions", headers=mh, json={"block_all": False, "hidden_categories": []})
    # expired share
    s = requests.post(f"{API}/espace-maman/resume/partages", headers=mh, json={"duree_heures": 24}).json()
    db.resume_shares.update_one({"id": s["id"]}, {"$set": {"expires_at": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()}})
    r = requests.get(f"{API}/resume-partage/{s['token']}")
    print("expired html:", r.status_code)
    r2 = requests.get(f"{API}/resume-partage/{s['token']}/pdf")
    print("expired pdf:", r2.status_code)
    requests.delete(f"{API}/espace-maman/resume/partages/{s['id']}", headers=mh)
    assert r.status_code == 410

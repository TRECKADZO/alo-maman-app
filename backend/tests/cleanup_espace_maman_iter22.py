# Cleanup script for Espace Maman tests (restrictions reset, revoke shares, remove TEST_ data)
import os
import requests
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")
API = os.environ.get("EXPO_PUBLIC_BACKEND_URL").rstrip("/") + "/api"
d = requests.post(f"{API}/auth/login", json={"email": "maman.test@alomaman.dev", "password": "Test1234!"}).json()
H = {"Authorization": f"Bearer {d['token']}"}
print(requests.put(f"{API}/espace-maman/restrictions", headers=H, json={"block_all": False, "hidden_categories": []}).json()["hidden_categories"])
for s in requests.get(f"{API}/espace-maman/resume/partages", headers=H).json():
    if s["actif"]:
        print("revoke", s["id"], requests.delete(f"{API}/espace-maman/resume/partages/{s['id']}", headers=H).status_code)
print(requests.put(f"{API}/espace-maman/profil-sante", headers=H, json={"groupe_sanguin": None, "rhesus": None, "allergies": [], "antecedents": [], "traitements": []}).json())
db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
import sys; sys.path.insert(0, "/app/backend"); from encryption import decrypt_consultation_note  # noqa: E402
ids = [n["id"] for n in db.consultation_notes.find({"maman_id": d["user"]["id"]}, {"_id": 0})
       if str(decrypt_consultation_note(dict(n)).get("diagnostic") or "").startswith("TEST_")]
print("notes deleted", db.consultation_notes.delete_many({"id": {"$in": ids}}).deleted_count)
print("corrections deleted", db.correction_requests.delete_many({"correction_demandee": {"$regex": "^TEST_"}}).deleted_count)

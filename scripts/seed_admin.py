"""
One-time helper: create/update default admin in MongoDB smart_parking.admins
Run: python database/seed_admin.py
Password is hashed with Werkzeug (same as Flask app verification).
"""
from pymongo import MongoClient
from werkzeug.security import generate_password_hash

client = MongoClient("mongodb://localhost:27017/")
db = client["smart_parking"]
admins = db["admins"]

username = "admin"
plain_password = "admin123"

admins.update_one(
    {"username": username},
    {
        "$set": {
            "username": username,
            "password_hash": generate_password_hash(plain_password),
            "role": "admin",
        }
    },
    upsert=True,
)
print(f"Seeded admin user: {username} / {plain_password} (change after first login)")

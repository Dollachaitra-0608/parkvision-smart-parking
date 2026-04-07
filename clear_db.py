from pymongo import MongoClient

# 🔁 CHANGE THIS if your DB config is different
MONGO_URI = "mongodb://localhost:27017"
DB_NAME = "smart_parking"

client = MongoClient(MONGO_URI)
db = client[DB_NAME]

sessions_collection = db["sessions"]
slots_collection = db["slots"]
gate_state_collection = db["gate_state"]

print("🔄 Clearing database...")

# 🧹 Delete all sessions
deleted_sessions = sessions_collection.delete_many({})
print(f"✅ Deleted sessions: {deleted_sessions.deleted_count}")

# 🔄 Reset all slots to available
updated_slots = slots_collection.update_many(
    {},
    {"$set": {"status": "available"}}
)
print(f"✅ Slots reset: {updated_slots.modified_count}")

# 🔄 Reset gate state
gate_state_collection.update_one(
    {"_id": "main"},
    {"$set": {"mode": "entry", "message": "Ready for demo"}},
    upsert=True
)

print("🚀 Database cleaned successfully. Ready for demo!")
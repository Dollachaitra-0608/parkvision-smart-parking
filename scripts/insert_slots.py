from pymongo import MongoClient

client = MongoClient("mongodb://localhost:27017/")
db = client["smart_parking"]
slots_collection = db["slots"]

slots = []

# G0 – Bike slots
for i in range(1, 21):
    slots.append({
        "slot_id": f"G0-{i}",
        "level": "G0",
        "vehicle_type_allowed": "bike",
        "status": "available"
    })

# G1 – Car slots
for i in range(1, 21):
    slots.append({
        "slot_id": f"G1-{i}",
        "level": "G1",
        "vehicle_type_allowed": "car",
        "status": "available"
    })

# G2 – Car slots
for i in range(1, 21):
    slots.append({
        "slot_id": f"G2-{i}",
        "level": "G2",
        "vehicle_type_allowed": "car",
        "status": "available"
    })

# G3 – Heavy vehicle slots
for i in range(1, 21):
    slots.append({
        "slot_id": f"G3-{i}",
        "level": "G3",
        "vehicle_type_allowed": "heavy",
        "status": "available"
    })

slots_collection.insert_many(slots)

print("All 80 slots inserted successfully!")
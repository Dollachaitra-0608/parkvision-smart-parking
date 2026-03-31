"""
Single MongoDB connection for the entire application.
Database: smart_parking
Collections: admins, slots, parking_sessions, vehicles
"""
import logging

from pymongo import MongoClient

logger = logging.getLogger(__name__)

client = MongoClient("mongodb://localhost:27017/", serverSelectionTimeoutMS=5000)
db = client["smart_parking"]

admins_collection = db["admins"]
slots_collection = db["slots"]
sessions_collection = db["parking_sessions"]
vehicles_collection = db["vehicles"]


def ensure_indexes():
    """Create required indexes with safe, idempotent handling."""
    try:
        slots_collection.create_index("slot_id", unique=True)
        sessions_collection.create_index("vehicle_no")
        sessions_collection.create_index("status")
        vehicles_collection.create_index("vehicle_no", unique=True)
        logger.info("MongoDB indexes ensured successfully")
    except Exception as idx_err:
        logger.warning("MongoDB index initialization warning: %s", idx_err)


def ping_db():
    """Verify connectivity; log result."""
    try:
        client.admin.command("ping")
        try:
            n_slots = slots_collection.count_documents({})
            n_sessions = sessions_collection.count_documents({})
            n_admins = admins_collection.count_documents({})
            logger.info(
                "MongoDB OK | db=smart_parking | document_counts slots=%s parking_sessions=%s admins=%s",
                n_slots,
                n_sessions,
                n_admins,
            )
        except Exception as count_err:
            logger.warning("MongoDB ping OK but count_documents failed: %s", count_err)
        return True
    except Exception as e:
        logger.error("MongoDB ping failed: %s", e)
        return False


# Run ping on import (visible when Flask loads db)
ping_db()
ensure_indexes()

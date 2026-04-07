from db import db
db['gate_state'].update_one(
    {'_id': 'main_gate'},
    {'$set': {'mode': 'idle', 'message': 'Waiting for vehicle...'}},
    upsert=True
)
print('Gate reset done!')
from pymongo import MongoClient
import pandas as pd
from datetime import datetime
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score
import joblib

# -----------------------
# CONNECT TO DB
# -----------------------
client = MongoClient("mongodb://localhost:27017/")
db = client["smart_parking"]
sessions = db["parking_sessions"]

data = list(sessions.find())

if len(data) < 10:
    print("Not enough data for ML")
    exit()

df = pd.DataFrame(data)

# -----------------------
# CLEAN DATA
# -----------------------
df = df.dropna(subset=["entry_time"])

# Convert time
df["entry_time"] = pd.to_datetime(df["entry_time"])

# -----------------------
# FEATURES
# -----------------------
df["hour"] = df["entry_time"].dt.hour
df["day_of_week"] = df["entry_time"].dt.dayofweek
df["is_weekend"] = df["day_of_week"].apply(lambda x: 1 if x >= 5 else 0)

# -----------------------
# CREATE TARGET (PEAK HOURS)
# -----------------------

# Count entries per hour
hour_counts = df["hour"].value_counts()

# Define peak hours (top 5 busiest hours)
peak_hours = hour_counts.nlargest(5).index.tolist()

df["target"] = df["hour"].apply(lambda x: 1 if x in peak_hours else 0)

# -----------------------
# ENCODE VEHICLE TYPE
# -----------------------
mapping = {"bike": 0, "car": 1, "heavy": 2}
df["vehicle_type"] = df["vehicle_type"].map(mapping)

df = df.dropna(subset=["vehicle_type"])

# -----------------------
# FINAL DATA
# -----------------------
X = df[["hour", "day_of_week", "is_weekend", "vehicle_type"]]
y = df["target"]

# -----------------------
# TRAIN MODEL
# -----------------------
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42
)

model = RandomForestClassifier(n_estimators=100)
model.fit(X_train, y_train)

# -----------------------
# EVALUATE
# -----------------------
y_pred = model.predict(X_test)
accuracy = accuracy_score(y_test, y_pred)

print("Accuracy:", accuracy)

# -----------------------
# SAVE MODEL
# -----------------------
joblib.dump(model, "model.pkl")
print("model.pkl created")
import sqlite3
import psycopg2
import sys

# ==============================================================================
# ⚠️ ACTION REQUIRED: Paste your Render "External Database URL" below
# (You can find it on the Render Dashboard under your PostgreSQL database settings)
# ==============================================================================
RENDER_DB_URL = "postgres://YOUR_EXTERNAL_URL_HERE"


if RENDER_DB_URL == "postgres://YOUR_EXTERNAL_URL_HERE":
    print("❌ Error: You must paste your Render External Database URL into this script first!")
    sys.exit(1)

# Fix URL format for psycopg2
if RENDER_DB_URL.startswith("postgres://"):
    RENDER_DB_URL = RENDER_DB_URL.replace("postgres://", "postgresql://", 1)

print("🔗 Connecting to local SQLite...")
sqlite_conn = sqlite3.connect("backend/fittrack.db")
sqlite_conn.row_factory = sqlite3.Row
sqlite_cur = sqlite_conn.cursor()

print("🔗 Connecting to remote PostgreSQL...")
pg_conn = psycopg2.connect(RENDER_DB_URL)
pg_cur = pg_conn.cursor()

def copy_table(table_name, columns):
    print(f"📦 Migrating '{table_name}'...")
    sqlite_cur.execute(f"SELECT * FROM {table_name}")
    rows = sqlite_cur.fetchall()
    
    if not rows:
        print(f"  - No data found in {table_name}.")
        return

    # Delete existing data in target to avoid duplicates
    pg_cur.execute(f"DELETE FROM {table_name}")
    
    placeholders = ", ".join(["%s"] * len(columns))
    col_names = ", ".join(columns)
    
    insert_query = f"INSERT INTO {table_name} ({col_names}) VALUES ({placeholders})"
    
    for row in rows:
        values = [row[col] for col in columns]
        pg_cur.execute(insert_query, values)
        
    print(f"  ✅ Copied {len(rows)} rows.")

try:
    # 1. Users
    user_cols = ["id", "name", "email", "age", "password_hash", "auth_provider", "provider_id", "phone", 
                 "is_active", "goal_steps", "goal_water", "goal_sleep", "goal_workout_days", "theme", 
                 "language", "date_format", "units", "medications_state", "reminder_time", "dob", 
                 "gender", "height", "weight", "bio", "n_daily_log", "n_medication", "n_hydration", 
                 "n_weekly", "n_awards", "created_at", "updated_at"]
    copy_table("users", user_cols)
    
    # 2. Logs
    log_cols = ["id", "user_id", "log_date", "workout_type", "workout_duration", "workout_intensity", 
                "workout_notes", "steps", "water_intake", "sleep_hours", "mood", "energy_level", 
                "medications_taken", "created_at"]
    copy_table("logs", log_cols)
    
    # 3. Prescriptions
    rx_cols = ["id", "user_id", "med_name", "med_type", "dosage", "dosage_unit", "start_date", "end_date",
               "workout_intake", "alarm_time", "pill_color", "pill_shape", "notes", "created_at"]
    copy_table("prescriptions", rx_cols)

    # Sync PostgreSQL sequences so auto-increment works correctly
    print("🔄 Syncing sequences...")
    pg_cur.execute("SELECT setval('users_id_seq', (SELECT MAX(id) FROM users));")
    pg_cur.execute("SELECT setval('logs_id_seq', COALESCE((SELECT MAX(id) FROM logs), 1));")
    pg_cur.execute("SELECT setval('prescriptions_id_seq', COALESCE((SELECT MAX(id) FROM prescriptions), 1));")

    pg_conn.commit()
    print("\n🎉 Migration complete successfully!")
    
except Exception as e:
    pg_conn.rollback()
    print(f"\n❌ Migration failed: {e}")
finally:
    sqlite_conn.close()
    pg_conn.close()

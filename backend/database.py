"""
database_pg.py
===========
Pure psycopg2 data-access layer for FitTent (PostgreSQL).
No ORM — just Python's psycopg2 driver.
"""

import os
import psycopg2
import psycopg2.extras
from datetime import datetime
from werkzeug.security import generate_password_hash, check_password_hash

DATABASE_URL = os.environ.get("DATABASE_URL", "")
SCHEMA_PATH  = os.path.join(os.path.dirname(__file__), "schema.sql")

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

def get_connection():
    conn = psycopg2.connect(DATABASE_URL)
    return conn

def _cursor(conn):
    return conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

def _add_column_if_missing(conn, table, column, definition):
    cur = _cursor(conn)
    cur.execute(
        """
        SELECT column_name FROM information_schema.columns
        WHERE table_name = %s AND column_name = %s
        """,
        (table, column),
    )
    if cur.fetchone() is None:
        conn.cursor().execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

def init_db() -> None:
    with get_connection() as conn:
        with open(SCHEMA_PATH, "r") as f:
            sql = f.read()

        cur = conn.cursor()
        cur.execute(sql)

        _add_column_if_missing(conn, "users", "medications_state", "TEXT DEFAULT NULL")
        _add_column_if_missing(conn, "users", "reminder_time",     "TEXT DEFAULT NULL")
        _add_column_if_missing(conn, "users", "dob",               "TEXT DEFAULT NULL")
        _add_column_if_missing(conn, "users", "gender",            "TEXT DEFAULT NULL")
        _add_column_if_missing(conn, "users", "height",            "REAL DEFAULT NULL")
        _add_column_if_missing(conn, "users", "weight",            "REAL DEFAULT NULL")
        _add_column_if_missing(conn, "users", "bio",               "TEXT DEFAULT NULL")
        _add_column_if_missing(conn, "users", "n_daily_log",       "INTEGER NOT NULL DEFAULT 1")
        _add_column_if_missing(conn, "users", "n_medication",      "INTEGER NOT NULL DEFAULT 1")
        _add_column_if_missing(conn, "users", "n_hydration",       "INTEGER NOT NULL DEFAULT 0")
        _add_column_if_missing(conn, "users", "n_weekly",          "INTEGER NOT NULL DEFAULT 0")
        _add_column_if_missing(conn, "users", "n_awards",          "INTEGER NOT NULL DEFAULT 1")
        _add_column_if_missing(conn, "users", "password_hash",     "TEXT DEFAULT NULL")
        _add_column_if_missing(conn, "users", "auth_provider",     "TEXT NOT NULL DEFAULT 'local'")
        _add_column_if_missing(conn, "users", "provider_id",       "TEXT DEFAULT NULL")
        _add_column_if_missing(conn, "users", "phone",             "TEXT DEFAULT NULL")
        _add_column_if_missing(conn, "users", "is_active",         "INTEGER NOT NULL DEFAULT 1")

        conn.cursor().execute("""
            CREATE TABLE IF NOT EXISTS prescriptions (
                id             SERIAL PRIMARY KEY,
                user_id        INTEGER NOT NULL DEFAULT 1,
                med_name       TEXT    NOT NULL,
                med_type       TEXT    NOT NULL DEFAULT 'pill',
                dosage         TEXT    NOT NULL DEFAULT '',
                dosage_unit    TEXT    NOT NULL DEFAULT 'mg',
                start_date     TEXT             DEFAULT NULL,
                end_date       TEXT             DEFAULT NULL,
                workout_intake TEXT             DEFAULT 'none',
                alarm_time     TEXT             DEFAULT NULL,
                pill_color     TEXT             DEFAULT '#0d9488',
                pill_shape     TEXT             DEFAULT 'round',
                notes          TEXT             DEFAULT NULL,
                created_at     TEXT    NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS')),
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
            CREATE INDEX IF NOT EXISTS idx_rx_user ON prescriptions (user_id);
        """)

        # ── Seed demo account on first run ────────────────────────
        from werkzeug.security import generate_password_hash
        
        # Ensure sequence is in sync (fixes id=1 duplicate error)
        conn.cursor().execute("SELECT setval(pg_get_serial_sequence('users', 'id'), COALESCE((SELECT MAX(id) FROM users) + 1, 1), false);")
        
        cur = _cursor(conn)
        cur.execute("SELECT id FROM users WHERE email = 'demo@fittent.app'")
        if cur.fetchone() is None:
            demo_hash = generate_password_hash("Demo@1234")
            conn.cursor().execute("""
                INSERT INTO users (
                    name, email, password_hash, auth_provider,
                    goal_steps, goal_water, goal_sleep, goal_workout_days,
                    age, gender, height, weight, bio, is_active
                ) VALUES (
                    'Demo User', 'demo@fittent.app', %s, 'local',
                    10000, 3.0, 8.0, 4,
                    25, 'male', 175.0, 72.0,
                    'This is the FitTent demo account. Feel free to explore!', 1
                )
            """, (demo_hash,))
            # Fetch the new demo user's id
            cur2 = _cursor(conn)
            cur2.execute("SELECT id FROM users WHERE email = 'demo@fittent.app'")
            demo_id = cur2.fetchone()["id"]
            # Seed sample workout logs for the past 7 days
            import datetime as _dt
            sample_logs = [
                ("Running",    30, "moderate", 8200, 2.5, 7.0, "good",     7),
                ("Cycling",    45, "high",      6500, 3.0, 6.5, "great",    7),
                ("Yoga",       60, "low",        3000, 2.0, 8.5, "calm",    7),
                ("Swimming",   40, "high",       5000, 3.5, 7.5, "tired",   7),
                ("Walking",    20, "low",        9000, 2.8, 8.0, "good",    7),
                ("Gym",        50, "high",       4500, 3.2, 6.0, "great",   7),
                ("Running",    35, "moderate",   7800, 2.6, 7.0, "good",    7),
            ]
            for i, (wtype, wdur, wint, steps, water, sleep, mood, _) in enumerate(sample_logs):
                log_date = (_dt.date.today() - _dt.timedelta(days=i)).isoformat()
                conn.cursor().execute("""
                    INSERT INTO logs (user_id, log_date, workout_type, workout_duration,
                        workout_intensity, steps, water_intake, sleep_hours, mood, energy_level, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (demo_id, log_date, wtype, wdur, wint, steps, water, sleep, mood, 7,
                      _dt.datetime.utcnow().isoformat()))
            print("[FitTent] Demo account seeded → demo@fittent.app / Demo@1234")

        conn.commit()
    print("[FitTent] PostgreSQL database ready.")

def get_profile(user_id: int = 1) -> dict:
    with get_connection() as conn:
        cur = _cursor(conn)
        cur.execute("SELECT * FROM users WHERE id = %s", (user_id,))
        row = cur.fetchone()
        return dict(row) if row else {}

def save_profile(data: dict, user_id: int = 1) -> dict:
    allowed = {
        "name", "email", "age",
        "goal_steps", "goal_water", "goal_sleep", "goal_workout_days",
        "theme", "language", "date_format", "units",
        "medications_state", "reminder_time",
        "dob", "gender", "height", "weight", "bio",
        "n_daily_log", "n_medication", "n_hydration", "n_weekly", "n_awards",
    }
    fields = {k: v for k, v in data.items() if k in allowed}
    if not fields: return get_profile(user_id)
    set_clause  = ", ".join(f"{k} = %s" for k in fields)
    set_clause += ", updated_at = %s"
    values      = list(fields.values()) + [datetime.utcnow().isoformat(), user_id]
    with get_connection() as conn:
        conn.cursor().execute(f"UPDATE users SET {set_clause} WHERE id = %s", values)
        conn.commit()
    return get_profile(user_id)

def insert_log(data: dict, user_id: int = 1) -> dict:
    allowed = {
        "log_date", "workout_type", "workout_duration", "workout_intensity",
        "workout_notes", "steps", "water_intake", "sleep_hours",
        "mood", "energy_level", "medications_taken",
    }
    fields = {k: v for k, v in data.items() if k in allowed and v not in (None, "", [])}
    fields["user_id"]    = user_id
    fields["created_at"] = datetime.utcnow().isoformat()
    if "log_date" not in fields: fields["log_date"] = datetime.utcnow().strftime("%Y-%m-%d")
    columns      = ", ".join(fields.keys())
    placeholders = ", ".join(["%s"] * len(fields))
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(f"INSERT INTO logs ({columns}) VALUES ({placeholders}) RETURNING id", list(fields.values()))
        new_id = cur.fetchone()[0]
        conn.commit()
    return get_log_by_id(new_id)

def get_log_by_id(log_id: int) -> dict:
    with get_connection() as conn:
        cur = _cursor(conn)
        cur.execute("SELECT * FROM logs WHERE id = %s", (log_id,))
        row = cur.fetchone()
        return dict(row) if row else {}

def get_logs(user_id: int = 1, date_from: str = None, date_to: str = None, workout: str = None, limit: int = 200, offset: int = 0) -> list:
    query  = "SELECT * FROM logs WHERE user_id = %s"
    params = [user_id]
    if date_from:
        query  += " AND log_date >= %s"
        params.append(date_from)
    if date_to:
        query  += " AND log_date <= %s"
        params.append(date_to)
    if workout:
        query  += " AND LOWER(workout_type) = LOWER(%s)"
        params.append(workout)
    query += " ORDER BY log_date DESC, id DESC LIMIT %s OFFSET %s"
    params += [limit, offset]
    with get_connection() as conn:
        cur = _cursor(conn)
        cur.execute(query, params)
        return [dict(r) for r in cur.fetchall()]

def delete_log(log_id: int, user_id: int = 1) -> bool:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM logs WHERE id = %s AND user_id = %s", (log_id, user_id))
        conn.commit()
        return cur.rowcount > 0

def update_log(log_id: int, data: dict, user_id: int = 1) -> dict:
    allowed = {
        "log_date", "workout_type", "workout_duration", "workout_intensity",
        "workout_notes", "steps", "water_intake", "sleep_hours",
        "mood", "energy_level", "medications_taken",
    }
    fields = {k: v for k, v in data.items() if k in allowed}
    if not fields: return get_log_by_id(log_id)
    set_clause = ", ".join(f"{k} = %s" for k in fields)
    values     = list(fields.values()) + [log_id, user_id]
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(f"UPDATE logs SET {set_clause} WHERE id = %s AND user_id = %s", values)
        conn.commit()
        if cur.rowcount == 0: return {}
    return get_log_by_id(log_id)

def get_stats(user_id: int = 1) -> dict:
    with get_connection() as conn:
        cur = _cursor(conn)
        cur.execute("""
            SELECT
                COUNT(*)                            AS total_logs,
                ROUND(AVG(steps)::numeric,  0)      AS avg_steps,
                ROUND(AVG(water_intake)::numeric, 2) AS avg_water,
                ROUND(AVG(sleep_hours)::numeric, 1) AS avg_sleep
            FROM logs
            WHERE user_id = %s
        """, (user_id,))
        row = cur.fetchone()
        cur.execute("""
            SELECT workout_type, COUNT(*) AS cnt
            FROM logs
            WHERE user_id = %s AND workout_type IS NOT NULL
            GROUP BY workout_type
            ORDER BY cnt DESC
            LIMIT 1
        """, (user_id,))
        top = cur.fetchone()
        cur.execute("""
            SELECT steps, water_intake, sleep_hours, workout_type
            FROM logs
            WHERE user_id = %s AND log_date = CURRENT_DATE::TEXT
            ORDER BY id DESC LIMIT 1
        """, (user_id,))
        today_row = cur.fetchone()
    stats = dict(row) if row else {}
    stats["top_workout"] = top["workout_type"] if top else None
    stats["today"]       = dict(today_row) if today_row else {}
    return stats

_RX_ALLOWED = {
    "med_name", "med_type", "dosage", "dosage_unit",
    "start_date", "end_date", "workout_intake",
    "alarm_time", "pill_color", "pill_shape", "notes",
}

def insert_prescription(data: dict, user_id: int = 1) -> dict:
    fields = {k: v for k, v in data.items() if k in _RX_ALLOWED and v not in (None, "")}
    if "med_name" not in fields: raise ValueError("med_name is required")
    fields["user_id"]    = user_id
    fields["created_at"] = datetime.utcnow().isoformat()
    columns      = ", ".join(fields.keys())
    placeholders = ", ".join(["%s"] * len(fields))
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(f"INSERT INTO prescriptions ({columns}) VALUES ({placeholders}) RETURNING id", list(fields.values()))
        new_id = cur.fetchone()[0]
        conn.commit()
    return get_prescription_by_id(new_id)

def get_prescription_by_id(rx_id: int, user_id: int = 1) -> dict:
    with get_connection() as conn:
        cur = _cursor(conn)
        cur.execute("SELECT * FROM prescriptions WHERE id = %s AND user_id = %s", (rx_id, user_id))
        row = cur.fetchone()
        return dict(row) if row else {}

def get_prescriptions(user_id: int = 1) -> list:
    with get_connection() as conn:
        cur = _cursor(conn)
        cur.execute("SELECT * FROM prescriptions WHERE user_id = %s ORDER BY created_at DESC", (user_id,))
        return [dict(r) for r in cur.fetchall()]

def update_prescription(rx_id: int, data: dict, user_id: int = 1) -> dict:
    fields = {k: v for k, v in data.items() if k in _RX_ALLOWED}
    if not fields: return get_prescription_by_id(rx_id, user_id)
    set_clause = ", ".join(f"{k} = %s" for k in fields)
    values     = list(fields.values()) + [rx_id, user_id]
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(f"UPDATE prescriptions SET {set_clause} WHERE id = %s AND user_id = %s", values)
        conn.commit()
        if cur.rowcount == 0: return {}
    return get_prescription_by_id(rx_id, user_id)

def delete_prescription(rx_id: int, user_id: int = 1) -> bool:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM prescriptions WHERE id = %s AND user_id = %s", (rx_id, user_id))
        conn.commit()
        return cur.rowcount > 0

def create_account(email: str, password: str, name: str = "") -> dict:
    hashed = generate_password_hash(password)
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                """INSERT INTO users (email, password_hash, name, auth_provider)
                   VALUES (%s, %s, %s, 'local') RETURNING id""",
                (email.lower().strip(), hashed, name),
            )
            new_id = cur.fetchone()[0]
            conn.commit()
    except Exception as e:
        if "unique" in str(e).lower(): raise ValueError("An account with this email already exists.")
        raise
    return get_user_by_id(new_id)

def get_user_by_email(email: str) -> dict | None:
    with get_connection() as conn:
        cur = _cursor(conn)
        cur.execute("SELECT * FROM users WHERE LOWER(email) = LOWER(%s)", (email.strip(),))
        row = cur.fetchone()
        return dict(row) if row else None

def get_user_by_id(user_id: int) -> dict | None:
    with get_connection() as conn:
        cur = _cursor(conn)
        cur.execute("SELECT * FROM users WHERE id = %s", (user_id,))
        row = cur.fetchone()
        return dict(row) if row else None

def verify_password(user: dict, password: str) -> bool:
    stored = user.get("password_hash")
    if not stored: return False
    return check_password_hash(stored, password)

def update_user_password(user_id: int, new_password: str) -> bool:
    hashed = generate_password_hash(new_password)
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "UPDATE users SET password_hash = %s, updated_at = %s WHERE id = %s",
            (hashed, datetime.utcnow().isoformat(), user_id),
        )
        conn.commit()
        return cur.rowcount > 0

def get_or_create_oauth_user(email: str, provider: str, provider_id: str, name: str = "") -> dict:
    existing = get_user_by_email(email)
    if existing:
        if not existing.get("provider_id"):
            with get_connection() as conn:
                conn.cursor().execute(
                    "UPDATE users SET auth_provider=%s, provider_id=%s, updated_at=%s WHERE id=%s",
                    (provider, provider_id, datetime.utcnow().isoformat(), existing["id"]),
                )
                conn.commit()
        return get_user_by_id(existing["id"])

    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO users (email, name, auth_provider, provider_id)
               VALUES (%s, %s, %s, %s) RETURNING id""",
            (email.lower().strip(), name, provider, provider_id),
        )
        new_id = cur.fetchone()[0]
        conn.commit()
        return get_user_by_id(new_id)

def safe_user_dict(user: dict) -> dict:
    if not user: return {}
    return {k: v for k, v in user.items() if k != "password_hash"}

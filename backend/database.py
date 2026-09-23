"""
database.py
===========
Pure sqlite3 data-access layer for FitTent.
No ORM — just Python's built-in sqlite3.
"""

import sqlite3
import os
import secrets
from datetime import datetime
from werkzeug.security import generate_password_hash, check_password_hash

# Support both old (fittrack.db) and new (fittent.db) database filenames
_DB_DIR  = os.path.dirname(__file__)
_OLD_DB  = os.path.join(_DB_DIR, "fittrack.db")
_NEW_DB  = os.path.join(_DB_DIR, "fittent.db")
# Use old file if it exists (zero data-loss migration), otherwise new name
DB_PATH     = _OLD_DB if os.path.exists(_OLD_DB) else _NEW_DB
SCHEMA_PATH = os.path.join(_DB_DIR, "schema.sql")


# ─────────────────────────────────────────────────────────────
#  CONNECTION HELPER
# ─────────────────────────────────────────────────────────────

def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


# ─────────────────────────────────────────────────────────────
#  INITIALISATION
# ─────────────────────────────────────────────────────────────

def _add_column_if_missing(conn, table, column, definition):
    """Add a column to a table if it doesn't exist yet (SQLite workaround)."""
    existing = [row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()]
    if column not in existing:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def init_db() -> None:
    with get_connection() as conn:
        with open(SCHEMA_PATH, "r") as f:
            conn.executescript(f.read())

        # Migrate: add new columns if upgrading from older schema
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
        # Auth columns
        _add_column_if_missing(conn, "users", "password_hash", "TEXT DEFAULT NULL")
        _add_column_if_missing(conn, "users", "auth_provider",  "TEXT NOT NULL DEFAULT 'local'")
        _add_column_if_missing(conn, "users", "provider_id",    "TEXT DEFAULT NULL")
        _add_column_if_missing(conn, "users", "phone",          "TEXT DEFAULT NULL")
        _add_column_if_missing(conn, "users", "is_active",      "INTEGER NOT NULL DEFAULT 1")

        # Ensure prescriptions table exists (safe for existing databases)
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS prescriptions (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
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
                created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
            CREATE INDEX IF NOT EXISTS idx_rx_user ON prescriptions (user_id);
        """)

        # Ensure user row id=1 exists
        row = conn.execute("SELECT id FROM users WHERE id = 1").fetchone()
        if row is None:
            conn.execute("INSERT INTO users (id, name) VALUES (1, '')")
        conn.commit()
    print(f"[FitTent] Database ready → {DB_PATH}")



# ─────────────────────────────────────────────────────────────
#  USER PROFILE
# ─────────────────────────────────────────────────────────────

def get_profile(user_id: int = 1) -> dict:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
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

    if not fields:
        return get_profile(user_id)

    set_clause  = ", ".join(f"{k} = ?" for k in fields)
    set_clause += ", updated_at = ?"
    values      = list(fields.values()) + [datetime.utcnow().isoformat(), user_id]

    with get_connection() as conn:
        conn.execute(
            f"UPDATE users SET {set_clause} WHERE id = ?",
            values,
        )
        conn.commit()

    return get_profile(user_id)


# ─────────────────────────────────────────────────────────────
#  LOG ENTRIES
# ─────────────────────────────────────────────────────────────

def insert_log(data: dict, user_id: int = 1) -> dict:
    allowed = {
        "log_date", "workout_type", "workout_duration", "workout_intensity",
        "workout_notes", "steps", "water_intake", "sleep_hours",
        "mood", "energy_level", "medications_taken",
    }
    fields = {k: v for k, v in data.items() if k in allowed and v not in (None, "", [])}
    fields["user_id"]    = user_id
    fields["created_at"] = datetime.utcnow().isoformat()

    if "log_date" not in fields:
        fields["log_date"] = datetime.utcnow().strftime("%Y-%m-%d")

    columns      = ", ".join(fields.keys())
    placeholders = ", ".join("?" * len(fields))

    with get_connection() as conn:
        cursor = conn.execute(
            f"INSERT INTO logs ({columns}) VALUES ({placeholders})",
            list(fields.values()),
        )
        conn.commit()
        new_id = cursor.lastrowid

    return get_log_by_id(new_id)


def get_log_by_id(log_id: int) -> dict:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM logs WHERE id = ?", (log_id,)).fetchone()
        return dict(row) if row else {}


def get_logs(
    user_id:   int = 1,
    date_from: str = None,
    date_to:   str = None,
    workout:   str = None,
    limit:     int = 200,
    offset:    int = 0,
) -> list:
    query  = "SELECT * FROM logs WHERE user_id = ?"
    params = [user_id]

    if date_from:
        query  += " AND log_date >= ?"
        params.append(date_from)

    if date_to:
        query  += " AND log_date <= ?"
        params.append(date_to)

    if workout:
        query  += " AND LOWER(workout_type) = LOWER(?)"
        params.append(workout)

    query += " ORDER BY log_date DESC, id DESC LIMIT ? OFFSET ?"
    params += [limit, offset]

    with get_connection() as conn:
        rows = conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]


def delete_log(log_id: int, user_id: int = 1) -> bool:
    with get_connection() as conn:
        cursor = conn.execute("DELETE FROM logs WHERE id = ? AND user_id = ?", (log_id, user_id))
        conn.commit()
        return cursor.rowcount > 0


def update_log(log_id: int, data: dict, user_id: int = 1) -> dict:
    """Update an existing log row with the supplied fields. Returns the updated row, or {}."""
    allowed = {
        "log_date", "workout_type", "workout_duration", "workout_intensity",
        "workout_notes", "steps", "water_intake", "sleep_hours",
        "mood", "energy_level", "medications_taken",
    }
    fields = {k: v for k, v in data.items() if k in allowed}

    if not fields:
        return get_log_by_id(log_id)

    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values     = list(fields.values()) + [log_id, user_id]

    with get_connection() as conn:
        cursor = conn.execute(
            f"UPDATE logs SET {set_clause} WHERE id = ? AND user_id = ?",
            values,
        )
        conn.commit()
        if cursor.rowcount == 0:
            return {}

    return get_log_by_id(log_id)


def get_stats(user_id: int = 1) -> dict:
    with get_connection() as conn:
        row = conn.execute("""
            SELECT
                COUNT(*)                            AS total_logs,
                ROUND(AVG(steps),  0)               AS avg_steps,
                ROUND(AVG(water_intake), 2)         AS avg_water,
                ROUND(AVG(sleep_hours), 1)          AS avg_sleep
            FROM logs
            WHERE user_id = ?
        """, (user_id,)).fetchone()

        top = conn.execute("""
            SELECT workout_type, COUNT(*) AS cnt
            FROM logs
            WHERE user_id = ? AND workout_type IS NOT NULL
            GROUP BY workout_type
            ORDER BY cnt DESC
            LIMIT 1
        """, (user_id,)).fetchone()

        today_row = conn.execute("""
            SELECT steps, water_intake, sleep_hours, workout_type
            FROM logs
            WHERE user_id = ? AND log_date = date('now')
            ORDER BY id DESC LIMIT 1
        """, (user_id,)).fetchone()

    stats = dict(row) if row else {}
    stats["top_workout"]   = top["workout_type"] if top else None
    stats["today"]         = dict(today_row) if today_row else {}
    return stats


# ─────────────────────────────────────────────────────────────
#  PRESCRIPTIONS
# ─────────────────────────────────────────────────────────────

_RX_ALLOWED = {
    "med_name", "med_type", "dosage", "dosage_unit",
    "start_date", "end_date", "workout_intake",
    "alarm_time", "pill_color", "pill_shape", "notes",
}


def insert_prescription(data: dict, user_id: int = 1) -> dict:
    """Insert a new prescription row and return it."""
    fields = {k: v for k, v in data.items() if k in _RX_ALLOWED and v not in (None, "")}

    if "med_name" not in fields:
        raise ValueError("med_name is required")

    fields["user_id"]    = user_id
    fields["created_at"] = datetime.utcnow().isoformat()

    columns      = ", ".join(fields.keys())
    placeholders = ", ".join("?" * len(fields))

    with get_connection() as conn:
        cursor = conn.execute(
            f"INSERT INTO prescriptions ({columns}) VALUES ({placeholders})",
            list(fields.values()),
        )
        conn.commit()
        new_id = cursor.lastrowid

    return get_prescription_by_id(new_id)


def get_prescription_by_id(rx_id: int, user_id: int = 1) -> dict:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM prescriptions WHERE id = ? AND user_id = ?", (rx_id, user_id)
        ).fetchone()
        return dict(row) if row else {}


def get_prescriptions(user_id: int = 1) -> list:
    """Return all prescriptions for a user, newest first."""
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM prescriptions WHERE user_id = ? ORDER BY created_at DESC", (user_id,)
        ).fetchall()
        return [dict(r) for r in rows]


def update_prescription(rx_id: int, data: dict, user_id: int = 1) -> dict:
    """Update allowed fields on a prescription. Returns updated row or {}."""
    fields = {k: v for k, v in data.items() if k in _RX_ALLOWED}

    if not fields:
        return get_prescription_by_id(rx_id, user_id)

    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values     = list(fields.values()) + [rx_id, user_id]

    with get_connection() as conn:
        cursor = conn.execute(
            f"UPDATE prescriptions SET {set_clause} WHERE id = ? AND user_id = ?",
            values,
        )
        conn.commit()
        if cursor.rowcount == 0:
            return {}

    return get_prescription_by_id(rx_id, user_id)


def delete_prescription(rx_id: int, user_id: int = 1) -> bool:
    """Delete a prescription. Returns True if a row was actually deleted."""
    with get_connection() as conn:
        cursor = conn.execute(
            "DELETE FROM prescriptions WHERE id = ? AND user_id = ?", (rx_id, user_id)
        )
        conn.commit()
        return cursor.rowcount > 0



# ─────────────────────────────────────────────────────────────
#  AUTHENTICATION
# ─────────────────────────────────────────────────────────────

def create_account(email: str, password: str, name: str = "") -> dict:
    """
    Create a new local-auth user account.
    Returns the new user dict, or raises ValueError on duplicate email.
    """
    hashed = generate_password_hash(password)
    try:
        with get_connection() as conn:
            cursor = conn.execute(
                """INSERT INTO users (email, password_hash, name, auth_provider)
                   VALUES (?, ?, ?, 'local')""",
                (email.lower().strip(), hashed, name),
            )
            conn.commit()
            new_id = cursor.lastrowid
    except Exception as e:
        if "UNIQUE" in str(e):
            raise ValueError("An account with this email already exists.")
        raise
    return get_user_by_id(new_id)


def get_user_by_email(email: str) -> dict | None:
    """Fetch a user row by email (case-insensitive). Returns None if not found."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE LOWER(email) = LOWER(?)", (email.strip(),)
        ).fetchone()
        return dict(row) if row else None


def get_user_by_id(user_id: int) -> dict | None:
    """Fetch a user row by primary key. Returns None if not found."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE id = ?", (user_id,)
        ).fetchone()
        return dict(row) if row else None


def verify_password(user: dict, password: str) -> bool:
    """Returns True if the given plaintext password matches the stored hash."""
    stored = user.get("password_hash")
    if not stored:
        return False
    return check_password_hash(stored, password)


def update_user_password(user_id: int, new_password: str) -> bool:
    """Hash and persist a new password for the given user. Returns True on success."""
    hashed = generate_password_hash(new_password)
    with get_connection() as conn:
        cursor = conn.execute(
            "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
            (hashed, datetime.utcnow().isoformat(), user_id),
        )
        conn.commit()
        return cursor.rowcount > 0


def get_or_create_oauth_user(email: str, provider: str, provider_id: str, name: str = "") -> dict:
    """
    Upsert a user for OAuth logins (Google, Apple, etc.).
    - If an account with this email exists: link the provider and return it.
    - Otherwise: create a new account without a password.
    """
    existing = get_user_by_email(email)
    if existing:
        # Link OAuth provider if not already done
        if not existing.get("provider_id"):
            with get_connection() as conn:
                conn.execute(
                    "UPDATE users SET auth_provider=?, provider_id=?, updated_at=? WHERE id=?",
                    (provider, provider_id, datetime.utcnow().isoformat(), existing["id"]),
                )
                conn.commit()
        return get_user_by_id(existing["id"])

    with get_connection() as conn:
        cursor = conn.execute(
            """INSERT INTO users (email, name, auth_provider, provider_id)
               VALUES (?, ?, ?, ?)""",
            (email.lower().strip(), name, provider, provider_id),
        )
        conn.commit()
        return get_user_by_id(cursor.lastrowid)


def safe_user_dict(user: dict) -> dict:
    """Return a user dict safe for JSON responses — strips password_hash."""
    if not user:
        return {}
    return {k: v for k, v in user.items() if k != "password_hash"}

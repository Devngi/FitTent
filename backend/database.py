"""
database.py
===========
Pure sqlite3 data-access layer for FitTrack.
No ORM — just Python's built-in sqlite3.
"""

import sqlite3
import os
from datetime import datetime

DB_PATH     = os.path.join(os.path.dirname(__file__), "fittrack.db")
SCHEMA_PATH = os.path.join(os.path.dirname(__file__), "schema.sql")


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

        # Ensure user row id=1 exists
        row = conn.execute("SELECT id FROM users WHERE id = 1").fetchone()
        if row is None:
            conn.execute("INSERT INTO users (id, name) VALUES (1, '')")
        conn.commit()
    print(f"[FitTrack] Database ready → {DB_PATH}")


# ─────────────────────────────────────────────────────────────
#  USER PROFILE
# ─────────────────────────────────────────────────────────────

def get_profile() -> dict:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = 1").fetchone()
        return dict(row) if row else {}


def save_profile(data: dict) -> dict:
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
        return get_profile()

    set_clause  = ", ".join(f"{k} = ?" for k in fields)
    set_clause += ", updated_at = ?"
    values      = list(fields.values()) + [datetime.utcnow().isoformat()]

    with get_connection() as conn:
        conn.execute(
            f"UPDATE users SET {set_clause} WHERE id = 1",
            values,
        )
        conn.commit()

    return get_profile()


# ─────────────────────────────────────────────────────────────
#  LOG ENTRIES
# ─────────────────────────────────────────────────────────────

def insert_log(data: dict) -> dict:
    allowed = {
        "log_date", "workout_type", "workout_duration", "workout_intensity",
        "workout_notes", "steps", "water_intake", "sleep_hours",
        "mood", "energy_level", "medications_taken",
    }
    fields = {k: v for k, v in data.items() if k in allowed and v not in (None, "", [])}
    fields["user_id"]    = 1
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
    date_from: str = None,
    date_to:   str = None,
    workout:   str = None,
    limit:     int = 200,
    offset:    int = 0,
) -> list:
    query  = "SELECT * FROM logs WHERE user_id = 1"
    params = []

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


def delete_log(log_id: int) -> bool:
    with get_connection() as conn:
        cursor = conn.execute("DELETE FROM logs WHERE id = ? AND user_id = 1", (log_id,))
        conn.commit()
        return cursor.rowcount > 0


def update_log(log_id: int, data: dict) -> dict:
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
    values     = list(fields.values()) + [log_id]

    with get_connection() as conn:
        cursor = conn.execute(
            f"UPDATE logs SET {set_clause} WHERE id = ? AND user_id = 1",
            values,
        )
        conn.commit()
        if cursor.rowcount == 0:
            return {}

    return get_log_by_id(log_id)


def get_stats() -> dict:
    with get_connection() as conn:
        row = conn.execute("""
            SELECT
                COUNT(*)                            AS total_logs,
                ROUND(AVG(steps),  0)               AS avg_steps,
                ROUND(AVG(water_intake), 2)         AS avg_water,
                ROUND(AVG(sleep_hours), 1)          AS avg_sleep
            FROM logs
            WHERE user_id = 1
        """).fetchone()

        top = conn.execute("""
            SELECT workout_type, COUNT(*) AS cnt
            FROM logs
            WHERE user_id = 1 AND workout_type IS NOT NULL
            GROUP BY workout_type
            ORDER BY cnt DESC
            LIMIT 1
        """).fetchone()

        today_row = conn.execute("""
            SELECT steps, water_intake, sleep_hours, workout_type
            FROM logs
            WHERE user_id = 1 AND log_date = date('now')
            ORDER BY id DESC LIMIT 1
        """).fetchone()

    stats = dict(row) if row else {}
    stats["top_workout"]   = top["workout_type"] if top else None
    stats["today"]         = dict(today_row) if today_row else {}
    return stats

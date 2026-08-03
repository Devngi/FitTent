"""
export_data.py
==============
Standalone Python export script for FitTrack.
Uses ONLY built-in libraries: sqlite3 and json.

Usage:
    python backend/export_data.py
        → writes  frontend/data.json

What it exports:
    Last 30 days of health logs from fittrack.db including:
    log_date, steps, water_intake, sleep_hours,
    workout_type, workout_duration, mood, energy_level, workout_intensity
"""

import sqlite3
import json
import os
from datetime import datetime, timedelta, timezone

# ── Paths ──────────────────────────────────────────────────────
SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
DB_PATH      = os.path.join(SCRIPT_DIR, "fittrack.db")
OUTPUT_PATH  = os.path.join(SCRIPT_DIR, "..", "frontend", "data.json")
OUTPUT_PATH  = os.path.normpath(OUTPUT_PATH)

# ── Date window ────────────────────────────────────────────────
today   = datetime.now(timezone.utc).date()
cutoff  = today - timedelta(days=29)          # inclusive 30-day window
date_from = cutoff.isoformat()                # e.g. "2026-07-04"
date_to   = today.isoformat()                 # e.g. "2026-08-03"


def export_logs(db_path: str) -> list:
    """
    Query fittrack.db for the last 30 days of logs.
    Returns a list of dicts with safe JSON-serialisable values.
    """
    if not os.path.exists(db_path):
        raise FileNotFoundError(
            f"Database not found at: {db_path}\n"
            "Make sure you have started the FitTrack server at least once."
        )

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row          # access columns by name

    cursor = conn.execute(
        """
        SELECT
            log_date,
            CAST(steps           AS INTEGER) AS steps,
            CAST(water_intake    AS REAL)    AS water_intake,
            CAST(sleep_hours     AS REAL)    AS sleep_hours,
            workout_type,
            CAST(workout_duration AS INTEGER) AS workout_duration,
            workout_intensity,
            mood,
            CAST(energy_level    AS INTEGER) AS energy_level
        FROM logs
        WHERE user_id = 1
          AND log_date >= ?
          AND log_date <= ?
        ORDER BY log_date ASC
        """,
        (date_from, date_to),
    )

    rows = []
    for row in cursor.fetchall():
        entry = {
            "log_date":          row["log_date"],
            "steps":             row["steps"],
            "water_intake":      row["water_intake"],
            "sleep_hours":       row["sleep_hours"],
            "workout_type":      row["workout_type"],
            "workout_duration":  row["workout_duration"],
            "workout_intensity": row["workout_intensity"],
            "mood":              row["mood"],
            "energy_level":      row["energy_level"],
        }
        rows.append(entry)

    conn.close()
    return rows


def main():
    print(f"[FitTrack Exporter] Reading: {DB_PATH}")
    print(f"[FitTrack Exporter] Date range: {date_from} → {date_to}")

    logs = export_logs(DB_PATH)

    payload = {
        "exported_at":  datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        "date_from":    date_from,
        "date_to":      date_to,
        "total_entries": len(logs),
        "logs":          logs,
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

    print(f"[FitTrack Exporter] ✅ Exported {len(logs)} entries → {OUTPUT_PATH}")


if __name__ == "__main__":
    main()

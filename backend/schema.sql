-- ============================================================
--  FitTrack – SQLite Schema
--  File: schema.sql
--  Run automatically by server.py on first launch.
-- ============================================================

-- ── Users / Profile table ────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL DEFAULT '',
    email         TEXT             DEFAULT '',
    age           INTEGER          DEFAULT NULL,
    -- Daily goals
    goal_steps    INTEGER NOT NULL DEFAULT 10000,
    goal_water    REAL    NOT NULL DEFAULT 3.0,
    goal_sleep    REAL    NOT NULL DEFAULT 8.0,
    goal_workout_days INTEGER NOT NULL DEFAULT 4,
    -- Appearance / preferences
    theme         TEXT    NOT NULL DEFAULT 'light',
    language      TEXT    NOT NULL DEFAULT 'en',
    date_format   TEXT    NOT NULL DEFAULT 'DD Mon YYYY',
    units         TEXT    NOT NULL DEFAULT 'metric',
    -- Medication state (JSON blob) and reminder
    medications_state TEXT DEFAULT NULL,
    reminder_time TEXT    DEFAULT NULL,
    -- Extra profile fields
    dob           TEXT             DEFAULT NULL,
    gender        TEXT             DEFAULT NULL,
    height        REAL             DEFAULT NULL,
    weight        REAL             DEFAULT NULL,
    bio           TEXT             DEFAULT NULL,
    -- Notification prefs (stored as 0/1)
    n_daily_log   INTEGER NOT NULL DEFAULT 1,
    n_medication  INTEGER NOT NULL DEFAULT 1,
    n_hydration   INTEGER NOT NULL DEFAULT 0,
    n_weekly      INTEGER NOT NULL DEFAULT 0,
    n_awards      INTEGER NOT NULL DEFAULT 1,
    -- Timestamps
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── Health / Workout Logs table ───────────────────────────────
CREATE TABLE IF NOT EXISTS logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL DEFAULT 1,
    log_date        TEXT    NOT NULL DEFAULT (date('now')),
    workout_type    TEXT             DEFAULT NULL,
    workout_duration INTEGER         DEFAULT NULL,
    workout_intensity TEXT           DEFAULT NULL,
    workout_notes   TEXT             DEFAULT NULL,
    steps           INTEGER          DEFAULT NULL,
    water_intake    REAL             DEFAULT NULL,
    sleep_hours     REAL             DEFAULT NULL,
    mood            TEXT             DEFAULT NULL,
    energy_level    INTEGER          DEFAULT NULL,
    medications_taken TEXT           DEFAULT NULL,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- ── Indexes ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_logs_date    ON logs (log_date);
CREATE INDEX IF NOT EXISTS idx_logs_workout ON logs (workout_type);
CREATE INDEX IF NOT EXISTS idx_logs_user    ON logs (user_id);

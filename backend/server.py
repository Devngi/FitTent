"""
server.py
=========
Lightweight Flask micro-server for FitTrack.
Serves HTML pages as static files AND exposes a JSON REST API
backed by SQLite (no localStorage).

Usage:
    pip install flask flask-cors
    python server.py

Open: http://127.0.0.1:5000
"""

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import os

import database as db

BACKEND_DIR  = os.path.dirname(os.path.abspath(__file__))          # .../project/backend
FRONTEND_DIR = os.path.join(BACKEND_DIR, '..', 'frontend')         # .../project/frontend

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")
CORS(app)


# ── Static pages ─────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")

@app.route("/<path:filename>")
def static_files(filename):
    return send_from_directory(FRONTEND_DIR, filename)


# ── Profile ──────────────────────────────────────────────────

@app.route("/api/profile", methods=["GET"])
def api_get_profile():
    return jsonify(db.get_profile())

@app.route("/api/profile", methods=["POST"])
def api_save_profile():
    data = request.get_json(silent=True) or {}
    updated = db.save_profile(data)
    return jsonify(updated), 200


# ── Logs ─────────────────────────────────────────────────────

@app.route("/api/logs", methods=["GET"])
def api_get_logs():
    date_from = request.args.get("date_from")
    date_to   = request.args.get("date_to")
    workout   = request.args.get("workout")
    limit     = int(request.args.get("limit",  200))
    offset    = int(request.args.get("offset", 0))

    rows = db.get_logs(
        date_from=date_from,
        date_to=date_to,
        workout=workout,
        limit=limit,
        offset=offset,
    )
    return jsonify(rows)

@app.route("/api/logs", methods=["POST"])
def api_insert_log():
    data = request.get_json(silent=True) or {}

    errors = []
    if "steps" in data and data["steps"] is not None:
        if float(data["steps"]) < 0:
            errors.append("steps cannot be negative")
    if "water_intake" in data and data["water_intake"] is not None:
        if float(data["water_intake"]) < 0:
            errors.append("water_intake cannot be negative")
    if "sleep_hours" in data and data["sleep_hours"] is not None:
        if float(data["sleep_hours"]) < 0:
            errors.append("sleep_hours cannot be negative")

    if errors:
        return jsonify({"error": "Validation failed", "details": errors}), 400

    new_row = db.insert_log(data)
    return jsonify(new_row), 201

@app.route("/api/logs/<int:log_id>", methods=["DELETE"])
def api_delete_log(log_id):
    deleted = db.delete_log(log_id)
    if deleted:
        return jsonify({"message": f"Log {log_id} deleted"}), 200
    return jsonify({"error": "Log not found"}), 404


# ── Stats ────────────────────────────────────────────────────

@app.route("/api/stats", methods=["GET"])
def api_get_stats():
    return jsonify(db.get_stats())


# ── Startup ──────────────────────────────────────────────────

if __name__ == "__main__":
    db.init_db()
    print("[FitTrack] Server running → http://127.0.0.1:5001")
    app.run(debug=True, port=5001)

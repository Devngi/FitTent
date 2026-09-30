"""
server.py
=========
Flask micro-server for FitTent.
Serves HTML pages as static files AND exposes a JSON REST API
backed by SQLite (no localStorage).

Authentication:
  - Email/Password with werkzeug bcrypt hashing
  - Flask server-side sessions (HttpOnly, SameSite=Lax)
  - login_required decorator enforces auth on all data routes
  - Google OAuth: add GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET to backend/.env

Usage:
    pip install flask flask-cors authlib python-dotenv
    python server.py

Open: http://127.0.0.1:5002
"""

import os
import secrets
import functools
from datetime import timedelta

from flask import Flask, request, jsonify, send_from_directory, session, redirect, url_for
from flask_cors import CORS

import database as db

# ── Load .env if present ──────────────────────────────────────
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
except ImportError:
    pass

BACKEND_DIR  = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(BACKEND_DIR, '..', 'frontend')

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")

# ── Session & Security Config ─────────────────────────────────
# In production: set SECRET_KEY in .env to a long random string.
app.secret_key = os.environ.get("SECRET_KEY") or secrets.token_hex(32)

# Detect production: when running on Render, PORT env var is set.
_IS_PRODUCTION = bool(os.environ.get("RENDER") or os.environ.get("PORT"))

app.config.update(
    SESSION_COOKIE_HTTPONLY  = True,
    SESSION_COOKIE_SAMESITE  = "Lax",
    SESSION_COOKIE_SECURE    = _IS_PRODUCTION,   # True on HTTPS (Render), False locally
    PERMANENT_SESSION_LIFETIME = timedelta(days=30),
)

# Allow the Render production URL + localhost for CORS
_RENDER_URL = os.environ.get("RENDER_EXTERNAL_URL", "")
_allowed_origins = ["http://127.0.0.1:5002", "http://localhost:5002"]
if _RENDER_URL:
    _allowed_origins.append(_RENDER_URL)

CORS(app, supports_credentials=True, origins=_allowed_origins)

# ── Google OAuth config ───────────────────────────────────────
GOOGLE_CLIENT_ID     = os.environ.get("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET")
# In production Render sets RENDER_EXTERNAL_URL automatically
_base_url = os.environ.get("RENDER_EXTERNAL_URL", "http://127.0.0.1:5002")
GOOGLE_REDIRECT_URI  = f"{_base_url.rstrip('/')}/api/auth/google/callback"

# Build a single persistent OAuth client (avoids re-registration errors)
_google_oauth = None
if GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET:
    try:
        from authlib.integrations.flask_client import OAuth
        _google_oauth = OAuth(app)
        _google_oauth.register(
            name='google',
            client_id=GOOGLE_CLIENT_ID,
            client_secret=GOOGLE_CLIENT_SECRET,
            server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
            client_kwargs={'scope': 'openid email profile'},
        )
        print("[FitTent] Google OAuth configured ✓")
    except Exception as _e:
        print(f"[FitTent] Google OAuth init failed: {_e}")
        _google_oauth = None


# ═══════════════════════════════════════════════════════════════
#  AUTH HELPER — login_required decorator
# ═══════════════════════════════════════════════════════════════

def login_required(f):
    """Decorator: returns 401 JSON if no valid session exists."""
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        if not session.get("user_id"):
            return jsonify({"error": "Authentication required", "login_url": "/login.html"}), 401
        return f(*args, **kwargs)
    return decorated


def current_user_id() -> int:
    """Return the logged-in user's ID from session."""
    return session["user_id"]


# ═══════════════════════════════════════════════════════════════
#  STATIC PAGES
# ═══════════════════════════════════════════════════════════════

@app.route("/")
def index():
    # If not logged in, redirect to login
    if not session.get("user_id"):
        return redirect("/login.html")
    return send_from_directory(FRONTEND_DIR, "index.html")

@app.route("/<path:filename>")
def static_files(filename):
    # Protect all app pages — login.html is always public
    if filename != "login.html" and not session.get("user_id"):
        # Let static assets through (js, css, images)
        static_exts = ('.js', '.css', '.jpg', '.jpeg', '.png', '.svg', '.ico', '.woff', '.woff2')
        if not any(filename.endswith(e) for e in static_exts):
            return redirect("/login.html")
    return send_from_directory(FRONTEND_DIR, filename)


# ═══════════════════════════════════════════════════════════════
#  AUTH ROUTES
# ═══════════════════════════════════════════════════════════════

@app.route("/api/auth/register", methods=["POST"])
def api_register():
    """Create a new account with email + password."""
    data     = request.get_json(silent=True) or {}
    email    = (data.get("email") or "").strip()
    password = (data.get("password") or "").strip()
    name     = (data.get("name") or "").strip()

    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400
    if len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters"}), 400

    try:
        user = db.create_account(email, password, name)
    except ValueError as e:
        return jsonify({"error": str(e)}), 409

    session.permanent = True
    session["user_id"] = user["id"]
    return jsonify({"message": "Account created", "user": db.safe_user_dict(user)}), 201


@app.route("/api/auth/login", methods=["POST"])
def api_login():
    """Authenticate with email + password."""
    data     = request.get_json(silent=True) or {}
    email    = (data.get("email") or "").strip()
    password = (data.get("password") or "").strip()

    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400

    user = db.get_user_by_email(email)
    if not user or not db.verify_password(user, password):
        return jsonify({"error": "Invalid email or password"}), 401

    if not user.get("is_active", 1):
        return jsonify({"error": "Account is deactivated"}), 403

    session.permanent = True
    session["user_id"] = user["id"]
    return jsonify({"message": "Login successful", "user": db.safe_user_dict(user)}), 200


@app.route("/api/auth/logout", methods=["POST"])
def api_logout():
    session.clear()
    return jsonify({"message": "Logged out"}), 200


@app.route("/api/auth/me", methods=["GET"])
@login_required
def api_me():
    """Return the currently logged-in user (without password_hash)."""
    user = db.get_user_by_id(current_user_id())
    if not user:
        session.clear()
        return jsonify({"error": "User not found"}), 401
    return jsonify(db.safe_user_dict(user))


@app.route("/api/auth/password", methods=["PATCH"])
@login_required
def api_change_password():
    """Verify current password and set a new one."""
    data         = request.get_json(silent=True) or {}
    current_pw   = (data.get("current_password") or "").strip()
    new_pw       = (data.get("new_password") or "").strip()
    confirm_pw   = (data.get("confirm_password") or "").strip()

    if not current_pw or not new_pw:
        return jsonify({"error": "All password fields are required"}), 400
    if new_pw != confirm_pw:
        return jsonify({"error": "New passwords do not match"}), 400
    if len(new_pw) < 8:
        return jsonify({"error": "New password must be at least 8 characters"}), 400

    user = db.get_user_by_id(current_user_id())
    if not db.verify_password(user, current_pw):
        return jsonify({"error": "Current password is incorrect"}), 401

    db.update_user_password(current_user_id(), new_pw)
    return jsonify({"message": "Password updated successfully"}), 200


# ── Google OAuth ──────────────────────────────────────────────

@app.route("/api/auth/google")
def api_google_login():
    """Redirect to Google OAuth consent screen."""
    if not _google_oauth:
        return jsonify({
            "error": "Google OAuth is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to backend/.env"
        }), 503
    try:
        return _google_oauth.google.authorize_redirect(GOOGLE_REDIRECT_URI)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/auth/google/callback")
def api_google_callback():
    """Handle Google OAuth callback — upserts user and creates session."""
    if not _google_oauth:
        return redirect("/login.html?error=google_not_configured")
    try:
        token    = _google_oauth.google.authorize_access_token()
        userinfo = token.get('userinfo') or _google_oauth.google.userinfo()
        email    = userinfo.get("email")
        name     = userinfo.get("name", "")
        sub      = userinfo.get("sub", "")  # Google's unique user ID

        if not email:
            return redirect("/login.html?error=no_email")

        user = db.get_or_create_oauth_user(email, "google", sub, name)
        session.permanent = True
        session["user_id"] = user["id"]
        return redirect("/")
    except Exception as e:
        return redirect(f"/login.html?error={str(e)[:60]}")


# ═══════════════════════════════════════════════════════════════
#  PROFILE (scoped to logged-in user)
# ═══════════════════════════════════════════════════════════════

@app.route("/api/profile", methods=["GET"])
@login_required
def api_get_profile():
    user = db.get_user_by_id(current_user_id())
    return jsonify(db.safe_user_dict(user))

@app.route("/api/profile", methods=["POST"])
@login_required
def api_save_profile():
    data = request.get_json(silent=True) or {}
    updated = db.save_profile(data, user_id=current_user_id())
    return jsonify(db.safe_user_dict(updated)), 200


# ═══════════════════════════════════════════════════════════════
#  LOGS (scoped to logged-in user)
# ═══════════════════════════════════════════════════════════════

@app.route("/api/logs", methods=["GET"])
@login_required
def api_get_logs():
    uid       = current_user_id()
    date_from = request.args.get("date_from")
    date_to   = request.args.get("date_to")
    workout   = request.args.get("workout")
    limit     = int(request.args.get("limit",  200))
    offset    = int(request.args.get("offset", 0))
    rows = db.get_logs(user_id=uid, date_from=date_from, date_to=date_to,
                       workout=workout, limit=limit, offset=offset)
    return jsonify(rows)

@app.route("/api/logs", methods=["POST"])
@login_required
def api_insert_log():
    data = request.get_json(silent=True) or {}
    errors = []
    for field in ("steps", "water_intake", "sleep_hours"):
        if field in data and data[field] is not None:
            if float(data[field]) < 0:
                errors.append(f"{field} cannot be negative")
    if errors:
        return jsonify({"error": "Validation failed", "details": errors}), 400
    new_row = db.insert_log(data, user_id=current_user_id())
    return jsonify(new_row), 201

@app.route("/api/logs/<int:log_id>", methods=["PUT"])
@login_required
def api_update_log(log_id):
    data = request.get_json(silent=True) or {}
    errors = []
    for field in ("steps", "water_intake", "sleep_hours"):
        if field in data and data[field] is not None:
            if float(data[field]) < 0:
                errors.append(f"{field} cannot be negative")
    if errors:
        return jsonify({"error": "Validation failed", "details": errors}), 400
    updated = db.update_log(log_id, data, user_id=current_user_id())
    if updated:
        return jsonify(updated), 200
    return jsonify({"error": "Log not found"}), 404

@app.route("/api/logs/<int:log_id>", methods=["DELETE"])
@login_required
def api_delete_log(log_id):
    deleted = db.delete_log(log_id, user_id=current_user_id())
    if deleted:
        return jsonify({"message": f"Log {log_id} deleted"}), 200
    return jsonify({"error": "Log not found"}), 404


# ═══════════════════════════════════════════════════════════════
#  STATS
# ═══════════════════════════════════════════════════════════════

@app.route("/api/stats", methods=["GET"])
@login_required
def api_get_stats():
    return jsonify(db.get_stats(user_id=current_user_id()))


# ═══════════════════════════════════════════════════════════════
#  PRESCRIPTIONS (scoped to logged-in user)
# ═══════════════════════════════════════════════════════════════

@app.route("/api/prescriptions", methods=["GET"])
@login_required
def api_get_prescriptions():
    return jsonify(db.get_prescriptions(user_id=current_user_id()))

@app.route("/api/prescriptions", methods=["POST"])
@login_required
def api_insert_prescription():
    data = request.get_json(silent=True) or {}
    if not data.get("med_name", "").strip():
        return jsonify({"error": "med_name is required"}), 400
    try:
        new_rx = db.insert_prescription(data, user_id=current_user_id())
        return jsonify(new_rx), 201
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

@app.route("/api/prescriptions/<int:rx_id>", methods=["PUT"])
@login_required
def api_update_prescription(rx_id):
    data = request.get_json(silent=True) or {}
    updated = db.update_prescription(rx_id, data, user_id=current_user_id())
    if updated:
        return jsonify(updated), 200
    return jsonify({"error": "Prescription not found"}), 404

@app.route("/api/prescriptions/<int:rx_id>", methods=["DELETE"])
@login_required
def api_delete_prescription(rx_id):
    deleted = db.delete_prescription(rx_id, user_id=current_user_id())
    if deleted:
        return jsonify({"message": f"Prescription {rx_id} deleted"}), 200
    return jsonify({"error": "Prescription not found"}), 404


# ═══════════════════════════════════════════════════════════════
#  STARTUP
# ═══════════════════════════════════════════════════════════════

# Initialise database on every startup (works for both gunicorn and direct run)
with app.app_context():
    db.init_db()

if __name__ == "__main__":
    print("[FitTent] Server running → http://127.0.0.1:5002")
    app.run(debug=True, port=5002)

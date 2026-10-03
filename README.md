<div align="center">
  <img src="frontend/assets/favicon.png" alt="FitTent Logo" width="120" />

  <h1>FitTent</h1>
  
  <p>
    <strong>A modern, comprehensive health and fitness tracking web application.</strong>
  </p>

  <p>
    <a href="https://fittent.onrender.com"><strong>🚀 View Live Website</strong></a>
    ·
    <a href="#-features">Features</a>
    ·
    <a href="#%EF%B8%8F-architecture--tech-stack">Tech Stack</a>
  </p>
</div>

---

## 🌟 Overview

FitTent is designed to be your all-in-one personal health dashboard. It allows you to effortlessly log workouts, monitor your daily water intake, manage medications and prescriptions, track your sleep patterns, and visualize your progress over time.

👉 **[Launch FitTent Now](https://fittent.onrender.com)**

### 🔑 Demo Account
If you'd like to test the app without creating your own account, a pre-filled demo account is available:
- **Email:** `demo@fittent.app`
- **Password:** `Demo@1234`

*(Alternatively, you can sign up for your own account or use Google One-Tap Sign In!)*

---

## ✨ Features

- **📊 Daily Dashboard:** At-a-glance view of your steps, water, sleep, and workouts.
- **🏋️ Workout Logging:** Track workout types, intensity, and duration with ease.
- **💊 Medication Manager:** Save your prescriptions, set custom pill colors/shapes, and receive daily browser alarms for when it's time to take them.
- **📈 Progress History:** Interactive charts (via Chart.js) to view your historical trends.
- **🏆 Awards & Streaks:** Unlock achievements for hitting daily goals and maintaining healthy streaks.
- **🔐 Secure Authentication:** Full local authentication system with HttpOnly sessions, plus Google OAuth integration.
- **📱 Responsive UI:** Beautiful, glassmorphism-inspired dark mode interface that works perfectly on desktop and mobile.

---

## 🏗️ Architecture & Tech Stack

FitTent uses a lightweight, robust, and highly scalable architecture designed for speed and simplicity.

### Frontend
- **HTML5 & CSS3:** Custom, modern styling with CSS variables (no heavy CSS frameworks).
- **Vanilla JavaScript:** Fast and dependency-free frontend logic communicating with the backend REST API.
- **Chart.js:** Used for rendering beautiful data visualizations in the History tab.

### Backend
- **Python 3 & Flask:** A lightweight micro-framework acting as both the REST API server and static file server.
- **PostgreSQL:** Primary database using raw SQL (`psycopg2`) for maximum performance without the overhead of an ORM.
- **Gunicorn:** Production WSGI HTTP server used for deploying the app on Render.

---

## 🚀 Deployment Pipeline (Render)

This application is configured for seamless deployment on [Render](https://render.com).

1. Code pushed to the `main` branch automatically triggers a deployment.
2. Render installs dependencies from `requirements.txt`.
3. The app is launched via Gunicorn (`gunicorn server:app`).
4. The backend connects to the managed PostgreSQL database on Render.
5. A GitHub Action periodically pings the server to ensure the free tier instance stays awake, eliminating cold-boot loading screens.

---

## 💻 Local Development Setup

Because FitTent uses PostgreSQL, you must have a local PostgreSQL server running or provide a remote database URL.

### 1. Prerequisites
- Python 3.10+
- PostgreSQL Server (or a cloud DB URL)
- Git

### 2. Installation
Clone the repository and install dependencies:
```bash
git clone https://github.com/Devngi/FitTent.git
cd FitTent
pip install -r requirements.txt
```

### 3. Environment Variables
Create a `.env` file inside the `backend` directory. **Do not use production keys here.**
```bash
SECRET_KEY=your_local_secret_key_here
DATABASE_URL=postgresql://user:password@localhost:5432/fittent
# Optional for Google Login:
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
```

### 4. Run the Server
Use the included startup script, or run Python directly:
```bash
# Easy startup
./start.sh

# Or manual startup
cd backend
python3 server.py
```
The server will start at `http://127.0.0.1:5002`.

---

## 📂 Directory Structure

```text
FitTent/
├── backend/
│   ├── database.py       # Core PostgreSQL data-access layer
│   ├── schema.sql        # Database table schemas
│   ├── server.py         # Flask app, REST endpoints, auth logic
│   └── .env.example      # Example environment variables
├── frontend/
│   ├── index.html        # Main dashboard
│   ├── login.html        # Authentication page
│   ├── history.html      # Chart visualizations
│   ├── medication.html   # Prescription and alarm tracker
│   ├── js/               # Vanilla JS controllers
│   └── assets/           # Images, favicons, styles
├── requirements.txt      # Python dependencies
├── start.sh              # Bash script for local startup
└── migrate_db.py         # Utility for data migrations
```

---
<div align="center">
  <i>Built with ❤️ for health & fitness.</i>
</div>

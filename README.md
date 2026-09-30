# FitTent

FitTent is a comprehensive health and fitness tracking web application. It allows users to log workouts, track water intake, manage medications, monitor sleep, and track overall daily goals.

## 🔑 Demo Account
A demo account with pre-filled data is automatically created on first server startup. You can log in at [https://fittent.onrender.com](https://fittent.onrender.com) using:

| Field | Value |
|---|---|
| **Email** | `demo@fittent.app` |
| **Password** | `Demo@1234` |


## 🏗️ Architecture & Tech Stack

FitTent uses a lightweight, robust, and highly scalable architecture:

- **Frontend**: Vanilla HTML5, CSS3, and JavaScript. The frontend is fully statically served by the backend, ensuring fast load times and straightforward asset management.
- **Backend**: Python 3 with the **Flask** micro-framework. It acts as both a REST API server for the frontend and a static file server.
- **Database**: **PostgreSQL** (via `psycopg2`). The data-access layer uses raw SQL queries without a heavy ORM for maximum performance and simplicity.
- **Authentication**: 
  - Local email/password authentication (using `werkzeug` bcrypt hashing).
  - Server-side HttpOnly sessions for security.
  - Google OAuth integration for one-click logins.

## 🚀 Deployment Pipeline (Render)

The application is configured to be seamlessly deployed on [Render.com](https://render.com). 

**Production Flow:**
1. Code pushed to the `main` branch on GitHub automatically triggers a new deployment on Render.
2. Render installs dependencies from `requirements.txt`.
3. The app is launched via Gunicorn (`gunicorn server:app`).
4. The backend connects to a managed PostgreSQL database on Render using the automatically injected `DATABASE_URL` environment variable.
5. On startup, `database.py` automatically runs `schema.sql` to ensure all necessary tables (users, logs, prescriptions) are present.

## 💻 Local Development Setup

Because FitTent uses PostgreSQL, you must have a local PostgreSQL server running or provide a remote `DATABASE_URL` in your environment.

### 1. Prerequisites
- Python 3.10+
- PostgreSQL Server installed locally
- Git

### 2. Installation
Clone the repository and install dependencies:
```bash
git clone https://github.com/your-username/FitTent.git
cd FitTent
pip install -r requirements.txt
```

### 3. Environment Variables
Create a `.env` file inside the `backend` directory:
```bash
SECRET_KEY=your_super_secret_local_key
DATABASE_URL=postgresql://postgres:password@localhost:5432/fittent
# Optional for Google Login:
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
```

### 4. Run the Server
You can use the startup script or run it directly:
```bash
./start.sh
# OR
cd backend
python3 server.py
```
The server will be available at `http://127.0.0.1:5002`.

## 📂 Directory Structure

```
FitTent/
├── backend/
│   ├── database.py       # Core PostgreSQL data-access layer
│   ├── schema.sql        # Database table schemas
│   ├── server.py         # Flask app, REST endpoints, auth logic
│   └── .env.example      # Example environment variables
├── frontend/
│   ├── index.html        # Main dashboard
│   ├── login.html        # Authentication page
│   ├── js/               # Frontend logic
│   └── assets/           # Images, styles, etc.
├── requirements.txt      # Python dependencies (Flask, psycopg2, Gunicorn, etc.)
├── start.sh              # Bash script for easy local startup
└── README.md             # Project documentation
```

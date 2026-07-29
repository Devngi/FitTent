#!/bin/bash
# FitTrack Startup Script
# This script starts the Flask backend server which automatically serves the frontend files.

cd "$(dirname "$0")/backend"

# Ensure dependencies are installed
if [ -f "../requirements.txt" ]; then
    pip3 install -r ../requirements.txt -q
fi

# Run the server
echo "Starting FitTrack..."
python3 server.py

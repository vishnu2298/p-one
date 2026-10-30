#!/usr/bin/env bash
# Starts the Python insights service and the Node API for local development.
set -euo pipefail
cd "$(dirname "$0")"
(cd services/insights && python3 -m pip install -q -r requirements.txt && python3 -m uvicorn app:app --port 5000) &
(cd backend && npm install --silent && npm start) &
trap 'kill 0' EXIT
wait

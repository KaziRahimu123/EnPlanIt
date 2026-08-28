"""Vercel Serverless Entrypoint for EnPlanIt FastAPI Backend."""

import sys
import os

current_dir = os.path.dirname(os.path.abspath(__file__))
candidate_dirs = [
    os.path.join(current_dir, "backend"),
    os.path.join(current_dir, "..", "backend"),
    os.path.join(current_dir, "..", "frontend", "backend"),
]

backend_dir = None
for c_dir in candidate_dirs:
    if os.path.isdir(c_dir) and os.path.isfile(os.path.join(c_dir, "main.py")):
        backend_dir = os.path.abspath(c_dir)
        break

if backend_dir and backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from main import app

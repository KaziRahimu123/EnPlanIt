# Claude Development Guide — EnPlanIt

Commands:
- Frontend dev: `cd frontend && npm run dev`
- Frontend type check: `cd frontend && npx tsc --noEmit`
- Backend dev: `cd backend && source venv/bin/activate && uvicorn main:app --reload --port 8000`
- Backend verify: `cd backend && python3 -m py_compile main.py auth0.py granite.py`

# Flight Log Manager

Web app for managing PX4 .ulg flight logs with metadata and visualization.

## Quick Start

```bash
# Backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload

# Frontend (new terminal)
cd frontend && npm install && npm run dev
```

Open http://localhost:5173

## Production

```bash
cd frontend && npm run build && cd ..
source .venv/bin/activate
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

## API Docs

http://localhost:8000/docs

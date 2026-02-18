# Flight Log Manager

Web app for managing PX4 .ulg flight logs with metadata and visualization.

## Development

```bash
# Backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

# Frontend (new terminal)
cd frontend && npm install && npm run dev
```

The Vite dev server proxies `/api` and `/img` to the backend automatically.

If you have SSL certs in `certs/` (cert.pem + key.pem), Vite serves over HTTPS. Otherwise it falls back to HTTP.

Open https://localhost:5173 (or http:// if no certs).

## Production (Docker)

Requires Docker. Self-signed SSL certs are generated automatically on first run.

```bash
# Start (builds frontend and backend automatically)
docker compose up --build -d

# View logs
docker compose logs

# Stop
docker compose down
```

Open https://\<SERVER_IP\> (port 80 redirects to 443).

## API Docs

Available at https://\<SERVER_IP\>/api/docs in production, or http://localhost:8000/docs in development.

# Local Network Setup (HTTPS + Web Serial)

## Why HTTPS?

Web Serial API requires a **secure context** (HTTPS or localhost). Without HTTPS, the "Connect Drone" button won't appear for users accessing over the network.

## Browser Support

Web Serial API only works in **Chrome/Edge**. Firefox and Safari don't implement it at all.

## Generate Certificate

```bash
cd frontend
mkdir -p certs
openssl req -x509 -newkey rsa:2048 \
  -keyout certs/key.pem \
  -out certs/cert.pem \
  -days 365 -nodes \
  -subj "/CN=airologV2" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:YOUR_SERVER_IP"
```

## Start Servers

```bash
# Backend
source .venv/bin/activate
uvicorn backend.main:app --host 0.0.0.0 --port 8000 \
  --ssl-keyfile frontend/certs/key.pem \
  --ssl-certfile frontend/certs/cert.pem

# Frontend
cd frontend && npm run dev
```

## User Instructions

1. Open `https://<SERVER_IP>:8000` - accept certificate warning
2. Open `https://<SERVER_IP>:5173` - accept certificate warning
3. Use Chrome or Edge (not Firefox/Safari)

---

## Production Deployment (Local Network)

HTTPS is **required** for Web Serial to work over the network. This setup runs a single server that serves both the API and frontend.

### 1. Install Dependencies

```bash
source .venv/bin/activate
pip install gunicorn
```

### 2. Generate Certificate

Replace `YOUR_SERVER_IP` with the actual IP address of your server:

```bash
cd frontend
mkdir -p certs
openssl req -x509 -newkey rsa:2048 \
  -keyout certs/key.pem \
  -out certs/cert.pem \
  -days 365 -nodes \
  -subj "/CN=airologV2" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:YOUR_SERVER_IP"
```

### 3. Build Frontend

```bash
cd frontend
npm install
npm run build
```

This creates `frontend/dist/` which the backend serves automatically.

### 4. Run Server

```bash
source .venv/bin/activate
FLIGHT_LOG_DEBUG=false gunicorn backend.main:app \
  --workers 4 \
  --worker-class uvicorn.workers.UvicornWorker \
  --bind 0.0.0.0:8000 \
  --keyfile frontend/certs/key.pem \
  --certfile frontend/certs/cert.pem
```

Access at `https://<SERVER_IP>:8000` - users will need to accept the certificate warning on first visit.

### Environment Variables

All settings use the `FLIGHT_LOG_` prefix:

| Variable | Default | Description |
|----------|---------|-------------|
| `FLIGHT_LOG_DEBUG` | `true` | Disable for production |
| `FLIGHT_LOG_HOST` | `0.0.0.0` | Server bind address |
| `FLIGHT_LOG_PORT` | `8000` | Server port |
| `FLIGHT_LOG_DATABASE_PATH` | `data/flight_logs.db` | SQLite database location |
| `FLIGHT_LOG_UPLOAD_DIR` | `data/logs` | Flight log storage directory |

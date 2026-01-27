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

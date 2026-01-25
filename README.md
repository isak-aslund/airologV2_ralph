# Flight Log Manager

A modern web application for managing PX4 .ulg flight test logs with rich metadata, integrating with flight_review for visualization.

## Project Structure

```
.
├── backend/          # FastAPI backend
├── frontend/         # React + TypeScript frontend
├── data/             # Database and uploaded logs (auto-created)
├── img/              # Drone thumbnail images
└── scripts/          # Utility scripts
```

## Development Setup

### Backend

```bash
# Create and activate virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r backend/requirements.txt

# Run development server
uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

### Frontend

```bash
cd frontend

# Install dependencies
npm install

# Run development server (http://localhost:5173)
npm run dev
```

## Production Build

### Build Frontend

```bash
cd frontend
npm run build
```

This creates an optimized build in `frontend/dist/`.

### Run Production Server

Once the frontend is built, FastAPI will serve both the API and the frontend from a single server:

```bash
source .venv/bin/activate
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

The production server:
- Serves the React frontend at `/`
- Serves API endpoints at `/api/*`
- Supports client-side routing (SPA fallback to `index.html`)

## API Documentation

When the server is running, API documentation is available at:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## Typecheck

### Backend

```bash
source .venv/bin/activate
mypy backend/ --ignore-missing-imports
```

### Frontend

```bash
cd frontend
npx tsc --noEmit
```

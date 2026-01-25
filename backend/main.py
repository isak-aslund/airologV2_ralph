"""Flight Log Manager - FastAPI Backend"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.config import settings
from backend.database import init_db
from backend.routers import logs, stats, tags


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler for startup/shutdown."""
    # Startup: Create required directories
    settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    # Initialize database tables
    init_db()
    yield
    # Shutdown: cleanup if needed


app = FastAPI(
    title="Flight Log Manager",
    description="API for managing PX4 .ulg flight test logs",
    version="1.0.0",
    lifespan=lifespan,
)

# Configure CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # Vite dev server
        "http://localhost:8000",  # FastAPI server
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files for drone images
app.mount("/img", StaticFiles(directory=str(settings.IMG_DIR)), name="img")

# Include routers
app.include_router(logs.router)
app.include_router(stats.router)
app.include_router(tags.router)


@app.get("/health")
async def health_check() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "backend.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
    )

"""Flight Log Manager - FastAPI Backend"""

from fastapi import FastAPI

from backend.config import settings

app = FastAPI(
    title="Flight Log Manager",
    description="API for managing PX4 .ulg flight test logs",
    version="1.0.0",
)


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

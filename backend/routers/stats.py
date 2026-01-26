"""API router for statistics and utility endpoints."""

import os
import tempfile

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import FlightLog
from backend.schemas import ExtractedMetadataResponse, StatsResponse
from backend.services.ulog_parser import extract_metadata

router = APIRouter(prefix="/api", tags=["stats"])


@router.get("/stats", response_model=StatsResponse)
async def get_stats(
    db: Session = Depends(get_db),
) -> dict:
    """
    Get flight statistics.

    Returns:
    - total_flights: Total number of flight logs
    - total_hours: Sum of all duration_seconds / 3600
    - hours_by_model: Dict with XLT, S1, CX10 keys and hours as values
    """
    # Get total flight count
    total_flights = db.query(func.count(FlightLog.id)).scalar() or 0

    # Get total flight hours (sum of duration_seconds / 3600)
    total_seconds = (
        db.query(func.sum(FlightLog.duration_seconds)).scalar() or 0.0
    )
    total_hours = total_seconds / 3600.0

    # Get hours by drone model (query all distinct models from database)
    hours_by_model: dict[str, float] = {}
    model_stats = (
        db.query(FlightLog.drone_model, func.sum(FlightLog.duration_seconds))
        .group_by(FlightLog.drone_model)
        .all()
    )
    for model, seconds in model_stats:
        hours_by_model[model] = (seconds or 0.0) / 3600.0

    return {
        "total_flights": total_flights,
        "total_hours": total_hours,
        "hours_by_model": hours_by_model,
    }


@router.get("/pilots")
async def get_pilots(
    db: Session = Depends(get_db),
) -> list[str]:
    """
    Get list of unique pilot names for autocomplete.

    Returns list of pilot names sorted alphabetically.
    """
    pilots = (
        db.query(FlightLog.pilot)
        .distinct()
        .order_by(FlightLog.pilot)
        .all()
    )
    return [p[0] for p in pilots if p[0]]


@router.get("/drone-models")
async def get_drone_models(
    db: Session = Depends(get_db),
) -> list[str]:
    """
    Get list of unique drone models from the database.

    Returns list of drone model values sorted alphabetically.
    """
    models = (
        db.query(FlightLog.drone_model)
        .distinct()
        .order_by(FlightLog.drone_model)
        .all()
    )
    return [m[0] for m in models if m[0]]


@router.post("/extract-metadata", response_model=ExtractedMetadataResponse)
async def extract_file_metadata(
    file: UploadFile = File(...),
) -> dict:
    """
    Extract metadata from a .ulg file without storing it.

    Accepts a .ulg file and returns extracted metadata:
    - duration_seconds: Flight duration in seconds
    - flight_date: Date/time of the flight
    - serial_number: Drone serial number (from AIROLIT_SERIAL param)
    - takeoff_lat: GPS latitude at takeoff
    - takeoff_lon: GPS longitude at takeoff
    """
    # Validate file type
    if not file.filename or not file.filename.lower().endswith(".ulg"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File must be a .ulg file",
        )

    # Save to temporary file for parsing
    temp_file = None
    try:
        # Read file content
        content = await file.read()

        # Write to temporary file
        temp_file = tempfile.NamedTemporaryFile(suffix=".ulg", delete=False)
        temp_file.write(content)
        temp_file.close()

        # Extract metadata (pass original filename for date parsing fallback)
        metadata = extract_metadata(temp_file.name, original_filename=file.filename)

        return metadata
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to extract metadata: {str(e)}",
        )
    finally:
        # Clean up temporary file
        if temp_file:
            try:
                os.unlink(temp_file.name)
            except Exception:
                pass

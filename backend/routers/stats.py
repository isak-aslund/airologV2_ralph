"""API router for statistics and utility endpoints."""

import os
import tempfile
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import FlightLog
from backend.schemas import (
    ExtractedMetadataResponse,
    PilotStatsResponse,
    RecordsResponse,
    StatsResponse,
)
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


@router.get("/stats/pilots", response_model=PilotStatsResponse)
async def get_pilot_stats(
    db: Session = Depends(get_db),
) -> dict:
    """Get per-pilot statistics including flights, hours, and model breakdown."""
    # Base stats per pilot: count, total seconds, longest flight, most recent
    pilot_rows = (
        db.query(
            FlightLog.pilot,
            func.count(FlightLog.id).label("total_flights"),
            func.coalesce(func.sum(FlightLog.duration_seconds), 0.0).label("total_seconds"),
            func.coalesce(func.max(FlightLog.duration_seconds), 0.0).label("longest"),
            func.max(FlightLog.flight_date).label("most_recent"),
        )
        .group_by(FlightLog.pilot)
        .all()
    )

    # Hours by model per pilot
    model_rows = (
        db.query(
            FlightLog.pilot,
            FlightLog.drone_model,
            func.coalesce(func.sum(FlightLog.duration_seconds), 0.0).label("seconds"),
        )
        .group_by(FlightLog.pilot, FlightLog.drone_model)
        .all()
    )

    # Build model breakdown lookup
    model_map: dict[str, dict[str, float]] = {}
    for pilot, model, seconds in model_rows:
        model_map.setdefault(pilot, {})[model] = seconds / 3600.0

    pilots = []
    for pilot, total_flights, total_seconds, longest, most_recent in pilot_rows:
        pilots.append(
            {
                "pilot": pilot,
                "total_flights": total_flights,
                "total_hours": total_seconds / 3600.0,
                "hours_by_model": model_map.get(pilot, {}),
                "longest_flight_seconds": longest,
                "most_recent_flight": most_recent,
            }
        )

    # Sort by total hours descending
    pilots.sort(key=lambda p: p["total_hours"], reverse=True)

    return {"pilots": pilots}


@router.get("/stats/records", response_model=RecordsResponse)
async def get_records(
    db: Session = Depends(get_db),
) -> dict:
    """Get fun records and streaks."""
    # Longest flight ever
    longest = (
        db.query(FlightLog)
        .filter(FlightLog.duration_seconds.isnot(None))
        .order_by(FlightLog.duration_seconds.desc())
        .first()
    )
    longest_flight = None
    if longest:
        longest_flight = {
            "pilot": longest.pilot,
            "duration_seconds": longest.duration_seconds,
            "flight_date": longest.flight_date,
            "drone_model": longest.drone_model,
        }

    # Most flights in a day
    date_expr = func.date(FlightLog.flight_date)
    day_rows = (
        db.query(
            date_expr.label("day"),
            func.count(FlightLog.id).label("cnt"),
        )
        .filter(FlightLog.flight_date.isnot(None))
        .group_by(date_expr)
        .order_by(func.count(FlightLog.id).desc())
        .first()
    )
    most_flights_in_a_day = None
    if day_rows:
        day_str = day_rows[0]
        # Get pilots who flew that day
        day_pilots = (
            db.query(FlightLog.pilot)
            .filter(date_expr == day_str)
            .distinct()
            .all()
        )
        most_flights_in_a_day = {
            "date": day_str,
            "flight_count": day_rows[1],
            "pilots": [p[0] for p in day_pilots],
        }

    # Busiest week (ISO week: Monday-based)
    week_expr = func.strftime("%Y-%W", FlightLog.flight_date)
    week_row = (
        db.query(
            week_expr.label("week"),
            func.count(FlightLog.id).label("cnt"),
        )
        .filter(FlightLog.flight_date.isnot(None))
        .group_by(week_expr)
        .order_by(func.count(FlightLog.id).desc())
        .first()
    )
    busiest_week = None
    if week_row:
        # Convert %Y-%W to a Monday date
        year_week = week_row[0]  # e.g. "2024-05"
        try:
            parts = year_week.split("-")
            yr, wk = int(parts[0]), int(parts[1])
            # ISO week calculation: Jan 1 + week offset, adjust to Monday
            jan1 = date(yr, 1, 1)
            # strftime %W is Monday-based, week 00 starts on first Monday
            week_start = jan1 + timedelta(days=(wk * 7) - jan1.weekday())
            busiest_week = {
                "week_start": week_start.isoformat(),
                "flight_count": week_row[1],
            }
        except (ValueError, IndexError):
            busiest_week = {
                "week_start": year_week,
                "flight_count": week_row[1],
            }

    # Current streak: consecutive days with at least 1 flight (up to today)
    distinct_dates = (
        db.query(date_expr.label("day"))
        .filter(FlightLog.flight_date.isnot(None))
        .distinct()
        .order_by(date_expr.desc())
        .all()
    )
    today = date.today()
    streak = 0
    if distinct_dates:
        flight_dates = []
        for row in distinct_dates:
            try:
                if isinstance(row[0], str):
                    flight_dates.append(date.fromisoformat(row[0]))
                else:
                    flight_dates.append(row[0])
            except (ValueError, TypeError):
                continue

        if flight_dates and flight_dates[0] >= today - timedelta(days=1):
            streak = 1
            for i in range(1, len(flight_dates)):
                if flight_dates[i] == flight_dates[i - 1] - timedelta(days=1):
                    streak += 1
                else:
                    break

    # Total unique flight days
    total_flight_days = (
        db.query(func.count(func.distinct(date_expr)))
        .filter(FlightLog.flight_date.isnot(None))
        .scalar()
        or 0
    )

    return {
        "longest_flight": longest_flight,
        "most_flights_in_a_day": most_flights_in_a_day,
        "busiest_week": busiest_week,
        "current_streak_days": streak,
        "total_flight_days": total_flight_days,
    }


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

"""API router for statistics and utility endpoints."""

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import DroneModel, FlightLog
from backend.schemas import StatsResponse

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

    # Get hours by drone model
    hours_by_model: dict[str, float] = {}
    for model in DroneModel:
        model_seconds = (
            db.query(func.sum(FlightLog.duration_seconds))
            .filter(FlightLog.drone_model == model)
            .scalar()
            or 0.0
        )
        hours_by_model[model.value] = model_seconds / 3600.0

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

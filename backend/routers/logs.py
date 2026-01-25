"""API router for flight log management."""

import math
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import or_
from sqlalchemy.orm import Session

from backend.config import settings
from backend.database import get_db
from backend.models import DroneModel, FlightLog, Tag
from backend.schemas import FlightLogResponse, FlightLogUpdate, PaginatedResponse
from backend.services.ulog_parser import extract_metadata

router = APIRouter(prefix="/api/logs", tags=["logs"])


@router.get("", response_model=PaginatedResponse[FlightLogResponse])
async def list_logs(
    page: int = Query(default=1, ge=1, description="Page number (1-indexed)"),
    per_page: Literal[25, 50, 100] = Query(default=25, description="Items per page"),
    search: Optional[str] = Query(
        default=None, description="Search in title, pilot, comment, serial_number"
    ),
    drone_model: Optional[str] = Query(
        default=None, description="Comma-separated drone models (XLT, S1, CX10)"
    ),
    pilot: Optional[str] = Query(default=None, description="Exact pilot name match"),
    tags: Optional[str] = Query(
        default=None, description="Comma-separated tag names"
    ),
    date_from: Optional[datetime] = Query(
        default=None, description="Filter logs from this date (ISO format)"
    ),
    date_to: Optional[datetime] = Query(
        default=None, description="Filter logs up to this date (ISO format)"
    ),
    db: Session = Depends(get_db),
) -> dict:
    """
    List flight logs with pagination, search, and filtering.

    - page: Page number starting from 1
    - per_page: 25, 50, or 100 items per page
    - search: Case-insensitive search in title, pilot, comment, serial_number
    - drone_model: Comma-separated list of models to filter (e.g., "XLT,S1")
    - pilot: Exact match for pilot name
    - tags: Comma-separated tag names to filter by
    - date_from: ISO date to filter logs from
    - date_to: ISO date to filter logs up to
    """
    query = db.query(FlightLog)

    # Apply search filter (case-insensitive)
    if search:
        search_term = f"%{search.lower()}%"
        query = query.filter(
            or_(
                FlightLog.title.ilike(search_term),
                FlightLog.pilot.ilike(search_term),
                FlightLog.comment.ilike(search_term),
                FlightLog.serial_number.ilike(search_term),
            )
        )

    # Apply drone_model filter
    if drone_model:
        model_names = [m.strip().upper() for m in drone_model.split(",") if m.strip()]
        valid_models = []
        for name in model_names:
            try:
                valid_models.append(DroneModel(name))
            except ValueError:
                pass  # Skip invalid model names
        if valid_models:
            query = query.filter(FlightLog.drone_model.in_(valid_models))

    # Apply pilot exact match filter
    if pilot:
        query = query.filter(FlightLog.pilot == pilot)

    # Apply tags filter
    if tags:
        tag_names = [t.strip().lower() for t in tags.split(",") if t.strip()]
        if tag_names:
            # Filter logs that have ALL specified tags
            for tag_name in tag_names:
                query = query.filter(
                    FlightLog.tags.any(Tag.name == tag_name)
                )

    # Apply date range filters
    if date_from:
        query = query.filter(FlightLog.flight_date >= date_from)
    if date_to:
        query = query.filter(FlightLog.flight_date <= date_to)

    # Order by flight_date descending
    query = query.order_by(FlightLog.flight_date.desc())

    # Get total count
    total = query.count()

    # Calculate pagination
    total_pages = max(1, math.ceil(total / per_page))
    offset = (page - 1) * per_page

    # Get paginated results
    items = query.offset(offset).limit(per_page).all()

    return {
        "items": items,
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": total_pages,
    }


def get_or_create_tags(db: Session, tag_names: list[str]) -> list[Tag]:
    """Get existing tags or create new ones."""
    tags: list[Tag] = []
    for name in tag_names:
        name_lower = name.lower().strip()
        if not name_lower:
            continue
        tag = db.query(Tag).filter(Tag.name == name_lower).first()
        if tag is None:
            tag = Tag(name=name_lower)
            db.add(tag)
            db.flush()
        tags.append(tag)
    return tags


@router.post("", response_model=FlightLogResponse, status_code=status.HTTP_201_CREATED)
async def create_log(
    file: UploadFile = File(...),
    title: str = Form(...),
    pilot: str = Form(...),
    drone_model: DroneModel = Form(...),
    serial_number: str | None = Form(None),
    comment: str | None = Form(None),
    tags: str | None = Form(None),
    db: Session = Depends(get_db),
) -> FlightLog:
    """
    Upload a new flight log.

    Accepts multipart form data with the .ulg file and metadata.
    Saves file to data/logs/{uuid}.ulg, extracts metadata, creates DB record.
    """
    # Validate file type
    if not file.filename or not file.filename.endswith(".ulg"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File must be a .ulg file",
        )

    # Generate unique ID for the log
    log_id = str(uuid.uuid4())

    # Ensure upload directory exists
    settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    # Save file to data/logs/{uuid}.ulg
    file_path = settings.UPLOAD_DIR / f"{log_id}.ulg"
    try:
        content = await file.read()
        with open(file_path, "wb") as f:
            f.write(content)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save file: {str(e)}",
        )

    # Extract metadata from the file
    metadata = extract_metadata(file_path)

    # Parse tags from comma-separated string
    tag_names: list[str] = []
    if tags:
        tag_names = [t.strip() for t in tags.split(",") if t.strip()]

    # Get or create tags
    tag_objects = get_or_create_tags(db, tag_names)

    # Create flight log record
    flight_log = FlightLog(
        id=log_id,
        title=title,
        pilot=pilot,
        drone_model=drone_model,
        serial_number=serial_number or metadata.get("serial_number"),
        file_path=str(file_path),
        comment=comment,
        duration_seconds=metadata.get("duration_seconds"),
        flight_date=metadata.get("flight_date"),
        takeoff_lat=metadata.get("takeoff_lat"),
        takeoff_lon=metadata.get("takeoff_lon"),
        tags=tag_objects,
    )

    db.add(flight_log)
    db.commit()
    db.refresh(flight_log)

    return flight_log


@router.get("/{log_id}", response_model=FlightLogResponse)
async def get_log(
    log_id: str,
    db: Session = Depends(get_db),
) -> FlightLog:
    """Get a single flight log by ID."""
    flight_log = db.query(FlightLog).filter(FlightLog.id == log_id).first()
    if flight_log is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Flight log with id '{log_id}' not found",
        )
    return flight_log


@router.put("/{log_id}", response_model=FlightLogResponse)
async def update_log(
    log_id: str,
    update_data: FlightLogUpdate,
    db: Session = Depends(get_db),
) -> FlightLog:
    """
    Update a flight log.

    Editable fields: title, pilot, drone_model, comment, tags.
    """
    flight_log = db.query(FlightLog).filter(FlightLog.id == log_id).first()
    if flight_log is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Flight log with id '{log_id}' not found",
        )

    # Update fields that are provided
    if update_data.title is not None:
        flight_log.title = update_data.title
    if update_data.pilot is not None:
        flight_log.pilot = update_data.pilot
    if update_data.drone_model is not None:
        flight_log.drone_model = update_data.drone_model
    if update_data.comment is not None:
        flight_log.comment = update_data.comment

    # Update tags if provided
    if update_data.tags is not None:
        tag_objects = get_or_create_tags(db, update_data.tags)
        flight_log.tags = tag_objects

    db.commit()
    db.refresh(flight_log)

    return flight_log


@router.delete("/{log_id}", status_code=status.HTTP_200_OK)
async def delete_log(
    log_id: str,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """Delete a flight log and its associated .ulg file."""
    flight_log = db.query(FlightLog).filter(FlightLog.id == log_id).first()
    if flight_log is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Flight log with id '{log_id}' not found",
        )

    # Delete the .ulg file
    file_path = Path(flight_log.file_path)
    if file_path.exists():
        try:
            os.remove(file_path)
        except Exception:
            pass  # Continue even if file deletion fails

    # Delete the database record
    db.delete(flight_log)
    db.commit()

    return {"message": f"Flight log '{log_id}' deleted successfully"}


@router.get("/{log_id}/download")
async def download_log(
    log_id: str,
    db: Session = Depends(get_db),
) -> FileResponse:
    """Download the .ulg file for a flight log."""
    flight_log = db.query(FlightLog).filter(FlightLog.id == log_id).first()
    if flight_log is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Flight log with id '{log_id}' not found",
        )

    file_path = Path(flight_log.file_path)
    if not file_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found on disk",
        )

    # Use a descriptive filename for download
    filename = f"{flight_log.title.replace(' ', '_')}_{log_id}.ulg"

    return FileResponse(
        path=file_path,
        filename=filename,
        media_type="application/octet-stream",
    )

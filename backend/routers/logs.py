"""API router for flight log management."""

import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from backend.config import settings
from backend.database import get_db
from backend.models import DroneModel, FlightLog, Tag
from backend.schemas import FlightLogResponse, FlightLogUpdate
from backend.services.ulog_parser import extract_metadata

router = APIRouter(prefix="/api/logs", tags=["logs"])


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

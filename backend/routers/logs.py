"""API router for flight log management."""

import math
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from backend.config import settings
from backend.database import get_db
from backend.models import FlightLog, Tag
from backend.schemas import ExtractedMetadataResponse, FlightLogResponse, FlightLogUpdate, PaginatedResponse, StatsResponse
from backend.services.ulog_parser import extract_metadata, get_parameters

router = APIRouter(prefix="/api/logs", tags=["logs"])


@router.get("", response_model=PaginatedResponse[FlightLogResponse])
async def list_logs(
    page: int = Query(default=1, ge=1, description="Page number (1-indexed)"),
    per_page: int = Query(default=25, description="Items per page (25, 50, or 100)"),
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
    flight_modes: Optional[str] = Query(
        default=None, description="Comma-separated flight mode names"
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
    # Validate per_page
    if per_page not in (25, 50, 100):
        per_page = 25

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
        model_names = [m.strip() for m in drone_model.split(",") if m.strip()]
        if model_names:
            query = query.filter(FlightLog.drone_model.in_(model_names))

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

    # Apply flight_modes filter (logs must contain ALL specified modes)
    if flight_modes:
        mode_names = [m.strip() for m in flight_modes.split(",") if m.strip()]
        if mode_names:
            # For SQLite JSON, use JSON_EACH to check if mode exists in the array
            from sqlalchemy import text
            for mode_name in mode_names:
                # Check if the JSON array contains the mode using SQLite json_each
                query = query.filter(
                    text(
                        "EXISTS (SELECT 1 FROM json_each(flight_logs.flight_modes) WHERE json_each.value = :mode)"
                    ).bindparams(mode=mode_name)
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


import re

# Serial number must be exactly 10 digits
SERIAL_NUMBER_REGEX = re.compile(r"^\d{10}$")


def is_valid_serial_format(serial: str | None) -> bool:
    """Check if serial number has valid format (exactly 10 digits)."""
    if not serial:
        return False
    return bool(SERIAL_NUMBER_REGEX.match(serial.strip()))


def is_default_serial_number(serial: str | None) -> bool:
    """Check if serial number is a default value that should be rejected."""
    if not serial:
        return False
    trimmed = serial.strip()
    if trimmed == "0":
        return True
    # Pattern: 16925X0000 where X is a digit (0-9)
    # Matches: 1692500000 (XLT), 1692510000 (CX10), 1692520000 (S1), etc.
    return bool(re.match(r"^16925\d0000$", trimmed))


def validate_serial_number(serial: str | None) -> str | None:
    """Validate serial number and return error message if invalid, None if valid."""
    if not serial or not serial.strip():
        return "Serial number is required"
    trimmed = serial.strip()
    if not trimmed.isdigit():
        return "Serial number must contain only digits (0-9)"
    if len(trimmed) != 10:
        return f"Serial number must be exactly 10 digits (got {len(trimmed)})"
    if is_default_serial_number(trimmed):
        return "This is a model default serial number and cannot be used"
    return None


@router.post("", response_model=FlightLogResponse, status_code=status.HTTP_201_CREATED)
async def create_log(
    file: UploadFile = File(...),
    title: str = Form(...),
    pilot: str = Form(...),
    drone_model: str = Form(...),
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
    metadata = extract_metadata(file_path, original_filename=file.filename)

    # Determine final serial number (form value or metadata fallback)
    final_serial_number = serial_number or metadata.get("serial_number")

    # Validate serial number format and value
    serial_error = validate_serial_number(final_serial_number)
    if serial_error:
        # Clean up the file we just saved
        try:
            file_path.unlink()
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid serial number: {serial_error}. Serial numbers must be exactly 10 digits.",
        )

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
        serial_number=final_serial_number,
        file_path=str(file_path),
        comment=comment,
        duration_seconds=metadata.get("duration_seconds"),
        flight_date=metadata.get("flight_date"),
        takeoff_lat=metadata.get("takeoff_lat"),
        takeoff_lon=metadata.get("takeoff_lon"),
        flight_modes=metadata.get("flight_modes", []),
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


@router.get("/{log_id}/parameters")
async def get_log_parameters(
    log_id: str,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    """Get all parameters from a flight log's .ulg file."""
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

    return get_parameters(file_path)


FLIGHT_REVIEW_URL = "http://10.0.0.100:5006"


@router.post("/{log_id}/upload-to-flight-review")
async def upload_to_flight_review(
    log_id: str,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """
    Upload a flight log to the Flight Review server.

    If already uploaded, returns the existing URL.
    Otherwise uploads the file and stores the flight_review_id.
    """
    flight_log = db.query(FlightLog).filter(FlightLog.id == log_id).first()
    if flight_log is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Flight log with id '{log_id}' not found",
        )

    # If already uploaded, return existing URL
    if flight_log.flight_review_id:
        return {
            "flight_review_id": flight_log.flight_review_id,
            "url": f"{FLIGHT_REVIEW_URL}/plot_app?log={flight_log.flight_review_id}",
        }

    # Check file exists
    file_path = Path(flight_log.file_path)
    if not file_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found on disk",
        )

    # Upload to Flight Review
    try:
        import re

        # Don't follow redirects - Flight Review returns 302 with Location header
        async with httpx.AsyncClient(timeout=120.0, follow_redirects=False) as client:
            with open(file_path, "rb") as f:
                files = {"filearg": (file_path.name, f, "application/octet-stream")}
                data = {
                    "description": flight_log.title or "",
                    "feedback": "",
                    "email": "noreply@airolog.local",
                    "type": "flightreport",  # "flightreport" = public, "personal" = private
                    "public": "true",
                }
                response = await client.post(
                    f"{FLIGHT_REVIEW_URL}/upload",
                    files=files,
                    data=data,
                )

        # Flight Review returns 302 redirect with Location header containing the log URL
        flight_review_id = None

        if response.status_code == 302:
            # Extract log ID from Location header like "/plot_app?log=XXXXXXXX"
            location = response.headers.get("location", "")
            match = re.search(r"log=([a-zA-Z0-9_-]+)", location)
            if match:
                flight_review_id = match.group(1)
        elif response.status_code == 200:
            # Some versions might return 200 with JSON body
            response_text = response.text
            match = re.search(r"log=([a-zA-Z0-9_-]+)", response_text)
            if match:
                flight_review_id = match.group(1)
        else:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Flight Review upload failed (HTTP {response.status_code}): {response.text[:500]}",
            )

        if not flight_review_id:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Could not parse Flight Review response. Status: {response.status_code}, Headers: {dict(response.headers)}",
            )

        # Store the flight_review_id
        flight_log.flight_review_id = flight_review_id
        db.commit()

        return {
            "flight_review_id": flight_review_id,
            "url": f"{FLIGHT_REVIEW_URL}/plot_app?log={flight_review_id}",
        }

    except httpx.RequestError as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to connect to Flight Review server: {str(e)}",
        )

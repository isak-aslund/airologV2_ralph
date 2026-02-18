"""API router for flight log attachments."""

import mimetypes
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from backend.config import settings
from backend.database import get_db
from backend.models import Attachment, FlightLog
from backend.routers.logs import get_unique_filepath, sanitize_filename
from backend.schemas import AttachmentResponse

router = APIRouter(prefix="/api/logs/{log_id}/attachments", tags=["attachments"])


def _get_log_or_404(log_id: str, db: Session) -> FlightLog:
    """Get a flight log by ID or raise 404."""
    flight_log = db.query(FlightLog).filter(FlightLog.id == log_id).first()
    if flight_log is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Flight log with id '{log_id}' not found",
        )
    return flight_log


@router.post("", response_model=list[AttachmentResponse], status_code=status.HTTP_201_CREATED)
async def upload_attachments(
    log_id: str,
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
) -> list[Attachment]:
    """Upload one or more attachments to a flight log."""
    flight_log = _get_log_or_404(log_id, db)

    # Build attachment directory: data/logs/{serial_number}/attachments/{log_id}/
    serial = flight_log.serial_number or "unknown"
    att_dir = settings.UPLOAD_DIR / serial / "attachments" / log_id
    att_dir.mkdir(parents=True, exist_ok=True)

    created: list[Attachment] = []
    for upload in files:
        if not upload.filename:
            continue

        safe_name = sanitize_filename(upload.filename)
        file_path = get_unique_filepath(att_dir, safe_name)

        content = await upload.read()
        with open(file_path, "wb") as f:
            f.write(content)

        # Determine MIME type
        content_type = upload.content_type
        if not content_type or content_type == "application/octet-stream":
            guessed, _ = mimetypes.guess_type(safe_name)
            content_type = guessed or "application/octet-stream"

        attachment = Attachment(
            id=str(uuid.uuid4()),
            flight_log_id=log_id,
            filename=safe_name,
            file_path=str(file_path),
            file_size=len(content),
            content_type=content_type,
        )
        db.add(attachment)
        created.append(attachment)

    db.commit()
    for att in created:
        db.refresh(att)

    return created


@router.get("", response_model=list[AttachmentResponse])
async def list_attachments(
    log_id: str,
    db: Session = Depends(get_db),
) -> list[Attachment]:
    """List all attachments for a flight log."""
    _get_log_or_404(log_id, db)
    return db.query(Attachment).filter(Attachment.flight_log_id == log_id).order_by(Attachment.created_at).all()


@router.get("/{attachment_id}")
async def get_attachment(
    log_id: str,
    attachment_id: str,
    db: Session = Depends(get_db),
) -> FileResponse:
    """Serve/download a single attachment file."""
    _get_log_or_404(log_id, db)
    attachment = db.query(Attachment).filter(
        Attachment.id == attachment_id,
        Attachment.flight_log_id == log_id,
    ).first()
    if attachment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attachment not found",
        )

    file_path = Path(attachment.file_path)
    if not file_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attachment file not found on disk",
        )

    return FileResponse(
        path=file_path,
        filename=attachment.filename,
        media_type=attachment.content_type,
    )


@router.delete("/{attachment_id}", status_code=status.HTTP_200_OK)
async def delete_attachment(
    log_id: str,
    attachment_id: str,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """Delete an attachment (DB row + file on disk)."""
    _get_log_or_404(log_id, db)
    attachment = db.query(Attachment).filter(
        Attachment.id == attachment_id,
        Attachment.flight_log_id == log_id,
    ).first()
    if attachment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attachment not found",
        )

    # Delete file from disk
    file_path = Path(attachment.file_path)
    if file_path.exists():
        try:
            os.remove(file_path)
        except Exception:
            pass

    db.delete(attachment)
    db.commit()

    return {"message": "Attachment deleted successfully"}

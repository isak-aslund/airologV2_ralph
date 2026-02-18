"""Pydantic schemas for API request/response validation."""

from datetime import datetime
from typing import Generic, Optional, TypeVar

from pydantic import BaseModel, ConfigDict, Field


# Generic type for paginated responses
T = TypeVar("T")


# Tag Schemas
class TagCreate(BaseModel):
    """Schema for creating a new tag."""

    name: str = Field(..., min_length=1, max_length=100)


class TagResponse(BaseModel):
    """Schema for tag response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


# Attachment Schemas
class AttachmentResponse(BaseModel):
    """Schema for attachment response."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    filename: str
    file_size: int
    content_type: str
    created_at: datetime


# FlightLog Schemas
class FlightLogCreate(BaseModel):
    """Schema for creating a new flight log."""

    title: str = Field(..., min_length=1, max_length=255)
    pilot: str = Field(..., min_length=1, max_length=100)
    drone_model: str = Field(..., min_length=1, max_length=50)
    serial_number: Optional[str] = Field(None, max_length=100)
    duration_seconds: Optional[float] = None
    comment: Optional[str] = None
    takeoff_lat: Optional[float] = None
    takeoff_lon: Optional[float] = None
    flight_date: Optional[datetime] = None
    tags: Optional[list[str]] = Field(default_factory=list)
    tow: Optional[float] = None


class FlightLogUpdate(BaseModel):
    """Schema for updating a flight log."""

    title: Optional[str] = Field(None, min_length=1, max_length=255)
    pilot: Optional[str] = Field(None, min_length=1, max_length=100)
    drone_model: Optional[str] = Field(None, min_length=1, max_length=50)
    comment: Optional[str] = None
    tags: Optional[list[str]] = None


class FlightLogResponse(BaseModel):
    """Schema for flight log response."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    pilot: str
    serial_number: Optional[str]
    log_identifier: Optional[str]
    drone_model: str
    duration_seconds: Optional[float]
    file_path: str
    comment: Optional[str]
    takeoff_lat: Optional[float]
    takeoff_lon: Optional[float]
    flight_date: Optional[datetime]
    flight_review_id: Optional[str]
    flight_modes: list[str]
    tow: Optional[float]
    created_at: datetime
    updated_at: datetime
    tags: list[TagResponse]
    attachments: list[AttachmentResponse] = []


# Pagination Schema
class PaginatedResponse(BaseModel, Generic[T]):
    """Schema for paginated response."""

    items: list[T]
    total: int
    page: int
    per_page: int
    total_pages: int


# Stats Schema
class StatsResponse(BaseModel):
    """Schema for flight statistics response."""

    total_flights: int
    total_hours: float
    hours_by_model: dict[str, float]


# Extracted Metadata Schema
class ExtractedMetadataResponse(BaseModel):
    """Schema for extracted metadata from a .ulg file."""

    duration_seconds: Optional[float]
    flight_date: Optional[datetime]
    serial_number: Optional[str]
    drone_model: Optional[str]
    takeoff_lat: Optional[float]
    takeoff_lon: Optional[float]
    flight_modes: list[str]
    log_identifier: Optional[str]  # Derived from filename for duplicate checking


# Duplicate Check Schemas
class DuplicateCheckItem(BaseModel):
    """Single item to check for duplicates."""

    serial_number: str
    log_identifier: str


class DuplicateCheckRequest(BaseModel):
    """Request to check multiple logs for duplicates."""

    items: list[DuplicateCheckItem]


class DuplicateCheckResult(BaseModel):
    """Result for a single duplicate check."""

    serial_number: str
    log_identifier: str
    exists: bool
    existing_log_id: Optional[str] = None


class DuplicateCheckResponse(BaseModel):
    """Response for duplicate check."""

    results: list[DuplicateCheckResult]

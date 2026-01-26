"""Pydantic schemas for API request/response validation."""

from datetime import datetime
from typing import Generic, Optional, TypeVar

from pydantic import BaseModel, ConfigDict, Field

from backend.models import DroneModel


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


# FlightLog Schemas
class FlightLogCreate(BaseModel):
    """Schema for creating a new flight log."""

    title: str = Field(..., min_length=1, max_length=255)
    pilot: str = Field(..., min_length=1, max_length=100)
    drone_model: DroneModel
    serial_number: Optional[str] = Field(None, max_length=100)
    duration_seconds: Optional[float] = None
    comment: Optional[str] = None
    takeoff_lat: Optional[float] = None
    takeoff_lon: Optional[float] = None
    flight_date: Optional[datetime] = None
    tags: Optional[list[str]] = Field(default_factory=list)


class FlightLogUpdate(BaseModel):
    """Schema for updating a flight log."""

    title: Optional[str] = Field(None, min_length=1, max_length=255)
    pilot: Optional[str] = Field(None, min_length=1, max_length=100)
    drone_model: Optional[DroneModel] = None
    comment: Optional[str] = None
    tags: Optional[list[str]] = None


class FlightLogResponse(BaseModel):
    """Schema for flight log response."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    pilot: str
    serial_number: Optional[str]
    drone_model: DroneModel
    duration_seconds: Optional[float]
    file_path: str
    comment: Optional[str]
    takeoff_lat: Optional[float]
    takeoff_lon: Optional[float]
    flight_date: Optional[datetime]
    flight_review_id: Optional[str]
    flight_modes: list[str]
    created_at: datetime
    updated_at: datetime
    tags: list[TagResponse]


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

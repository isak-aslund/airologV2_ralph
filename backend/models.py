"""SQLAlchemy models for flight logs and tags."""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Column, DateTime, Enum, Float, ForeignKey, Integer, JSON, String, Table, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.database import Base


# Common drone models (for reference, but drone_model field accepts any string)
KNOWN_DRONE_MODELS = ["XLT", "S1", "CX10"]


# Association table for many-to-many relationship between FlightLog and Tag
flight_log_tags = Table(
    "flight_log_tags",
    Base.metadata,
    Column("flight_log_id", String(36), ForeignKey("flight_logs.id"), primary_key=True),
    Column("tag_id", Integer, ForeignKey("tags.id"), primary_key=True),
)


class Tag(Base):
    """Tag model for categorizing flight logs."""

    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)

    # Relationship to flight logs
    flight_logs: Mapped[list["FlightLog"]] = relationship(
        "FlightLog",
        secondary=flight_log_tags,
        back_populates="tags",
    )

    def __repr__(self) -> str:
        return f"<Tag(id={self.id}, name='{self.name}')>"


class FlightLog(Base):
    """Flight log model for storing ULog file metadata."""

    __tablename__ = "flight_logs"
    __table_args__ = (
        # Unique constraint: same drone (serial_number) cannot have duplicate logs (log_identifier)
        UniqueConstraint("serial_number", "log_identifier", name="uq_serial_log_identifier"),
    )

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    pilot: Mapped[str] = mapped_column(String(100), nullable=False)
    serial_number: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    # Log identifier - unique per drone, derived from original filename
    log_identifier: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    drone_model: Mapped[str] = mapped_column(String(50), nullable=False)
    duration_seconds: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    takeoff_lat: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    takeoff_lon: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    flight_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    flight_review_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    flight_modes: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    tow: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    # Relationship to tags
    tags: Mapped[list[Tag]] = relationship(
        "Tag",
        secondary=flight_log_tags,
        back_populates="flight_logs",
    )

    def __repr__(self) -> str:
        return f"<FlightLog(id='{self.id}', title='{self.title}', pilot='{self.pilot}')>"

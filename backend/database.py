"""Database engine and session configuration."""

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from backend.config import settings


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy models."""

    pass


# Create engine with SQLite database
engine = create_engine(
    f"sqlite:///{settings.DATABASE_PATH}",
    connect_args={"check_same_thread": False},
    echo=settings.DEBUG,
)

# Create session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    """Dependency for getting database sessions."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Create all database tables if they don't exist."""
    # Import models to ensure they're registered with Base
    from backend import models  # noqa: F401

    # Ensure parent directory exists
    settings.DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)

    # Create all tables
    Base.metadata.create_all(bind=engine)

    # Run migrations for new columns
    _run_migrations()


def _run_migrations() -> None:
    """Run simple migrations to add missing columns to existing tables."""
    from sqlalchemy import text

    with engine.connect() as conn:
        # Check if flight_review_id column exists in flight_logs table
        result = conn.execute(text("PRAGMA table_info(flight_logs)"))
        columns = [row[1] for row in result.fetchall()]

        if "flight_review_id" not in columns:
            conn.execute(
                text("ALTER TABLE flight_logs ADD COLUMN flight_review_id VARCHAR(100)")
            )
            conn.commit()

        if "flight_modes" not in columns:
            conn.execute(
                text("ALTER TABLE flight_logs ADD COLUMN flight_modes TEXT DEFAULT '[]'")
            )
            conn.commit()

        if "log_identifier" not in columns:
            # Add log_identifier column - for existing records, we'll populate from title
            conn.execute(
                text("ALTER TABLE flight_logs ADD COLUMN log_identifier VARCHAR(255)")
            )
            # Populate log_identifier from title for existing records
            conn.execute(
                text("UPDATE flight_logs SET log_identifier = title WHERE log_identifier IS NULL")
            )
            conn.commit()

        if "tow" not in columns:
            conn.execute(text("ALTER TABLE flight_logs ADD COLUMN tow REAL"))
            conn.commit()

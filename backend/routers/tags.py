"""API router for tag management."""

from typing import Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Tag
from backend.schemas import TagCreate, TagResponse

router = APIRouter(prefix="/api/tags", tags=["tags"])


@router.get("", response_model=list[TagResponse])
async def list_tags(
    search: Optional[str] = Query(
        default=None, description="Filter tags by name (case-insensitive)"
    ),
    db: Session = Depends(get_db),
) -> list[Tag]:
    """
    List all tags.

    - search: Optional case-insensitive filter for tag names
    """
    query = db.query(Tag)

    if search:
        search_term = f"%{search.lower()}%"
        query = query.filter(Tag.name.ilike(search_term))

    return query.order_by(Tag.name).all()


@router.post("", response_model=TagResponse, status_code=status.HTTP_201_CREATED)
async def create_tag(
    tag_data: TagCreate,
    db: Session = Depends(get_db),
) -> Tag:
    """
    Create a new tag.

    Tags are stored in lowercase. If a tag with the same name already exists,
    the existing tag is returned instead of creating a duplicate.
    """
    name_lower = tag_data.name.lower().strip()

    # Check if tag already exists
    existing_tag = db.query(Tag).filter(Tag.name == name_lower).first()
    if existing_tag:
        return existing_tag

    # Create new tag
    tag = Tag(name=name_lower)
    db.add(tag)
    db.commit()
    db.refresh(tag)

    return tag

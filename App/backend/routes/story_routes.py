"""Story objects routes (BasicInfo, Characters, Organizations, Locations, Lorebook)"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
import uuid

from ..database import get_db
from ..models.db_models import (
    User, Project, BasicInfo, Character, Organization, Location, LorebookEntry,
    StoryObjectVersion, Outline, Act, Chapter, ChapterContent, ChapterContentVersion
)
from ..schemas.story_objects import (
    BasicInfoCreate, BasicInfoUpdate, BasicInfoResponse,
    NameDescriptionCreate, NameDescriptionUpdate, NameDescriptionResponse,
    VersionCreate, VersionResponse, VersionListResponse,
    OutlineCreate, OutlineResponse, ActCreate, ActUpdate, ActResponse,
    ChapterCreate, ChapterUpdate, ChapterResponse
)
from ..schemas.chapters import (
    ChapterContentCreate, ChapterContentUpdate, ChapterContentResponse,
    ChapterContentVersionResponse, ChapterContentDataResponse
)
from ..auth import get_current_user

router = APIRouter(prefix="/api/v1/projects/{project_id}", tags=["Story Objects"])


# Helper function to verify project ownership
async def verify_project_access(
    project_id: uuid.UUID,
    current_user: User,
    db: Session
) -> Project:
    """Verify that the current user owns the project"""
    project = db.query(Project).filter(
        Project.id == project_id,
        Project.user_id == current_user.id
    ).first()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found"
        )

    return project


# ============================================================================
# BASIC INFO
# ============================================================================

@router.post("/basic-info", response_model=BasicInfoResponse, status_code=status.HTTP_201_CREATED)
async def create_basic_info(
    project_id: uuid.UUID,
    data: BasicInfoCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create basic info for a project"""
    project = await verify_project_access(project_id, current_user, db)

    # Check if basic info already exists
    existing = db.query(BasicInfo).filter(BasicInfo.project_id == project_id).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Basic info already exists for this project"
        )

    version_id = uuid.uuid4()
    basic_info = BasicInfo(
        id=uuid.uuid4(),
        project_id=project_id,
        title=data.title,
        logline=data.logline,
        genre=data.genre,
        active_version_id=version_id
    )

    db.add(basic_info)
    db.flush()

    # Create initial version
    version = StoryObjectVersion(
        id=version_id,
        object_id=basic_info.id,
        object_type='basic_info',
        user_request='Initial creation',
        is_active=True,
        data={
            data.language: {
                'title': data.title,
                'logline': data.logline,
                'genre': data.genre
            }
        }
    )

    db.add(version)
    db.commit()
    db.refresh(basic_info)

    return basic_info


@router.get("/basic-info", response_model=BasicInfoResponse)
async def get_basic_info(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get basic info for a project"""
    project = await verify_project_access(project_id, current_user, db)

    basic_info = db.query(BasicInfo).filter(BasicInfo.project_id == project_id).first()
    if not basic_info:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Basic info not found"
        )

    return basic_info


@router.put("/basic-info", response_model=BasicInfoResponse)
async def update_basic_info(
    project_id: uuid.UUID,
    data: BasicInfoUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update basic info"""
    project = await verify_project_access(project_id, current_user, db)

    basic_info = db.query(BasicInfo).filter(BasicInfo.project_id == project_id).first()
    if not basic_info:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Basic info not found"
        )

    # Update flat fields
    if data.title is not None:
        basic_info.title = data.title
    if data.logline is not None:
        basic_info.logline = data.logline
    if data.genre is not None:
        basic_info.genre = data.genre

    # Create new version
    language = data.language or 'English'
    version_id = uuid.uuid4()

    # Deactivate old versions
    db.query(StoryObjectVersion).filter(
        StoryObjectVersion.object_id == basic_info.id
    ).update({'is_active': False})

    version = StoryObjectVersion(
        id=version_id,
        object_id=basic_info.id,
        object_type='basic_info',
        user_request='User Edit',
        is_active=True,
        data={
            language: {
                'title': basic_info.title,
                'logline': basic_info.logline,
                'genre': basic_info.genre
            }
        }
    )

    basic_info.active_version_id = version_id
    db.add(version)
    db.commit()
    db.refresh(basic_info)

    return basic_info


# ============================================================================
# CHARACTERS
# ============================================================================

@router.post("/characters", response_model=NameDescriptionResponse, status_code=status.HTTP_201_CREATED)
async def create_character(
    project_id: uuid.UUID,
    data: NameDescriptionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a character"""
    project = await verify_project_access(project_id, current_user, db)

    version_id = uuid.uuid4()
    character = Character(
        id=uuid.uuid4(),
        project_id=project_id,
        name=data.name,
        description=data.description,
        active_version_id=version_id
    )

    db.add(character)
    db.flush()

    # Create initial version
    version = StoryObjectVersion(
        id=version_id,
        object_id=character.id,
        object_type='character',
        user_request='Initial creation',
        is_active=True,
        data={
            data.language: {
                'name': data.name,
                'description': data.description
            }
        }
    )

    db.add(version)
    db.commit()
    db.refresh(character)

    return character


@router.get("/characters", response_model=List[NameDescriptionResponse])
async def list_characters(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all characters for a project"""
    project = await verify_project_access(project_id, current_user, db)

    characters = db.query(Character).filter(Character.project_id == project_id).all()
    return characters


@router.get("/characters/{character_id}", response_model=NameDescriptionResponse)
async def get_character(
    project_id: uuid.UUID,
    character_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get a specific character"""
    project = await verify_project_access(project_id, current_user, db)

    character = db.query(Character).filter(
        Character.id == character_id,
        Character.project_id == project_id
    ).first()

    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Character not found"
        )

    return character


@router.put("/characters/{character_id}", response_model=NameDescriptionResponse)
async def update_character(
    project_id: uuid.UUID,
    character_id: uuid.UUID,
    data: NameDescriptionUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update a character"""
    project = await verify_project_access(project_id, current_user, db)

    character = db.query(Character).filter(
        Character.id == character_id,
        Character.project_id == project_id
    ).first()

    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Character not found"
        )

    # Update fields
    if data.name is not None:
        character.name = data.name
    if data.description is not None:
        character.description = data.description

    # Create new version
    language = data.language or 'English'
    version_id = uuid.uuid4()

    db.query(StoryObjectVersion).filter(
        StoryObjectVersion.object_id == character.id
    ).update({'is_active': False})

    version = StoryObjectVersion(
        id=version_id,
        object_id=character.id,
        object_type='character',
        user_request='User Edit',
        is_active=True,
        data={
            language: {
                'name': character.name,
                'description': character.description
            }
        }
    )

    character.active_version_id = version_id
    db.add(version)
    db.commit()
    db.refresh(character)

    return character


@router.delete("/characters/{character_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_character(
    project_id: uuid.UUID,
    character_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a character"""
    project = await verify_project_access(project_id, current_user, db)

    character = db.query(Character).filter(
        Character.id == character_id,
        Character.project_id == project_id
    ).first()

    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Character not found"
        )

    db.delete(character)
    db.commit()

    return None


# ============================================================================
# ORGANIZATIONS (Similar pattern to Characters)
# ============================================================================

@router.post("/organizations", response_model=NameDescriptionResponse, status_code=status.HTTP_201_CREATED)
async def create_organization(
    project_id: uuid.UUID,
    data: NameDescriptionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create an organization"""
    project = await verify_project_access(project_id, current_user, db)

    version_id = uuid.uuid4()
    org = Organization(
        id=uuid.uuid4(),
        project_id=project_id,
        name=data.name,
        description=data.description,
        active_version_id=version_id
    )

    db.add(org)
    db.flush()

    version = StoryObjectVersion(
        id=version_id,
        object_id=org.id,
        object_type='organization',
        user_request='Initial creation',
        is_active=True,
        data={data.language: {'name': data.name, 'description': data.description}}
    )

    db.add(version)
    db.commit()
    db.refresh(org)

    return org


@router.get("/organizations", response_model=List[NameDescriptionResponse])
async def list_organizations(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all organizations"""
    project = await verify_project_access(project_id, current_user, db)
    orgs = db.query(Organization).filter(Organization.project_id == project_id).all()
    return orgs


# ============================================================================
# LOCATIONS
# ============================================================================

@router.post("/locations", response_model=NameDescriptionResponse, status_code=status.HTTP_201_CREATED)
async def create_location(
    project_id: uuid.UUID,
    data: NameDescriptionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a location"""
    project = await verify_project_access(project_id, current_user, db)

    version_id = uuid.uuid4()
    location = Location(
        id=uuid.uuid4(),
        project_id=project_id,
        name=data.name,
        description=data.description,
        active_version_id=version_id
    )

    db.add(location)
    db.flush()

    version = StoryObjectVersion(
        id=version_id,
        object_id=location.id,
        object_type='location',
        user_request='Initial creation',
        is_active=True,
        data={data.language: {'name': data.name, 'description': data.description}}
    )

    db.add(version)
    db.commit()
    db.refresh(location)

    return location


@router.get("/locations", response_model=List[NameDescriptionResponse])
async def list_locations(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all locations"""
    project = await verify_project_access(project_id, current_user, db)
    locations = db.query(Location).filter(Location.project_id == project_id).all()
    return locations


# ============================================================================
# LOREBOOK
# ============================================================================

@router.post("/lorebook", response_model=NameDescriptionResponse, status_code=status.HTTP_201_CREATED)
async def create_lorebook_entry(
    project_id: uuid.UUID,
    data: NameDescriptionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a lorebook entry"""
    project = await verify_project_access(project_id, current_user, db)

    version_id = uuid.uuid4()
    entry = LorebookEntry(
        id=uuid.uuid4(),
        project_id=project_id,
        name=data.name,
        description=data.description,
        active_version_id=version_id
    )

    db.add(entry)
    db.flush()

    version = StoryObjectVersion(
        id=version_id,
        object_id=entry.id,
        object_type='lorebook',
        user_request='Initial creation',
        is_active=True,
        data={data.language: {'name': data.name, 'description': data.description}}
    )

    db.add(version)
    db.commit()
    db.refresh(entry)

    return entry


@router.get("/lorebook", response_model=List[NameDescriptionResponse])
async def list_lorebook(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all lorebook entries"""
    project = await verify_project_access(project_id, current_user, db)
    entries = db.query(LorebookEntry).filter(LorebookEntry.project_id == project_id).all()
    return entries


# ============================================================================
# OUTLINE
# ============================================================================

@router.post("/outline", response_model=OutlineResponse, status_code=status.HTTP_201_CREATED)
async def create_outline(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create outline for a project"""
    project = await verify_project_access(project_id, current_user, db)

    # Check if outline already exists
    existing = db.query(Outline).filter(Outline.project_id == project_id).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Outline already exists for this project"
        )

    outline = Outline(
        id=uuid.uuid4(),
        project_id=project_id
    )

    db.add(outline)
    db.commit()
    db.refresh(outline)

    return outline


@router.get("/outline", response_model=OutlineResponse)
async def get_outline(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get outline for a project with all acts and chapters"""
    project = await verify_project_access(project_id, current_user, db)

    outline = db.query(Outline).filter(Outline.project_id == project_id).first()
    if not outline:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Outline not found"
        )

    return outline


# ============================================================================
# ACTS
# ============================================================================

@router.post("/outline/acts", response_model=ActResponse, status_code=status.HTTP_201_CREATED)
async def create_act(
    project_id: uuid.UUID,
    data: ActCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create an act"""
    project = await verify_project_access(project_id, current_user, db)

    # Get or create outline
    outline = db.query(Outline).filter(Outline.project_id == project_id).first()
    if not outline:
        outline = Outline(id=uuid.uuid4(), project_id=project_id)
        db.add(outline)
        db.flush()

    version_id = uuid.uuid4()
    act = Act(
        id=uuid.uuid4(),
        outline_id=outline.id,
        name=data.name,
        description=data.description,
        order=data.order,
        active_version_id=version_id
    )

    db.add(act)
    db.flush()

    # Create initial version
    version = StoryObjectVersion(
        id=version_id,
        object_id=act.id,
        object_type='act',
        user_request='Initial creation',
        is_active=True,
        data={
            data.language: {
                'name': data.name,
                'description': data.description
            }
        }
    )

    db.add(version)
    db.commit()
    db.refresh(act)

    return act


@router.get("/outline/acts", response_model=List[ActResponse])
async def list_acts(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all acts for a project"""
    project = await verify_project_access(project_id, current_user, db)

    outline = db.query(Outline).filter(Outline.project_id == project_id).first()
    if not outline:
        return []

    acts = db.query(Act).filter(Act.outline_id == outline.id).order_by(Act.order).all()
    return acts


@router.put("/outline/acts/{act_id}", response_model=ActResponse)
async def update_act(
    project_id: uuid.UUID,
    act_id: uuid.UUID,
    data: ActUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update an act"""
    project = await verify_project_access(project_id, current_user, db)

    outline = db.query(Outline).filter(Outline.project_id == project_id).first()
    if not outline:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Outline not found"
        )

    act = db.query(Act).filter(
        Act.id == act_id,
        Act.outline_id == outline.id
    ).first()

    if not act:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Act not found"
        )

    # Update fields
    if data.name is not None:
        act.name = data.name
    if data.description is not None:
        act.description = data.description
    if data.order is not None:
        act.order = data.order

    # Create new version
    language = data.language or 'English'
    version_id = uuid.uuid4()

    db.query(StoryObjectVersion).filter(
        StoryObjectVersion.object_id == act.id
    ).update({'is_active': False})

    version = StoryObjectVersion(
        id=version_id,
        object_id=act.id,
        object_type='act',
        user_request='User Edit',
        is_active=True,
        data={
            language: {
                'name': act.name,
                'description': act.description
            }
        }
    )

    act.active_version_id = version_id
    db.add(version)
    db.commit()
    db.refresh(act)

    return act


@router.delete("/outline/acts/{act_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_act(
    project_id: uuid.UUID,
    act_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete an act"""
    project = await verify_project_access(project_id, current_user, db)

    outline = db.query(Outline).filter(Outline.project_id == project_id).first()
    if not outline:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Outline not found"
        )

    act = db.query(Act).filter(
        Act.id == act_id,
        Act.outline_id == outline.id
    ).first()

    if not act:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Act not found"
        )

    db.delete(act)
    db.commit()

    return None


# ============================================================================
# CHAPTERS
# ============================================================================

@router.post("/outline/acts/{act_id}/chapters", response_model=ChapterResponse, status_code=status.HTTP_201_CREATED)
async def create_chapter(
    project_id: uuid.UUID,
    act_id: uuid.UUID,
    data: ChapterCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a chapter"""
    project = await verify_project_access(project_id, current_user, db)

    outline = db.query(Outline).filter(Outline.project_id == project_id).first()
    if not outline:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Outline not found"
        )

    act = db.query(Act).filter(
        Act.id == act_id,
        Act.outline_id == outline.id
    ).first()

    if not act:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Act not found"
        )

    version_id = uuid.uuid4()
    chapter = Chapter(
        id=uuid.uuid4(),
        act_id=act_id,
        name=data.name,
        description=data.description,
        order=data.order,
        active_version_id=version_id
    )

    db.add(chapter)
    db.flush()

    # Create initial version
    version = StoryObjectVersion(
        id=version_id,
        object_id=chapter.id,
        object_type='chapter',
        user_request='Initial creation',
        is_active=True,
        data={
            data.language: {
                'name': data.name,
                'description': data.description
            }
        }
    )

    db.add(version)
    db.commit()
    db.refresh(chapter)

    return chapter


@router.get("/outline/acts/{act_id}/chapters", response_model=List[ChapterResponse])
async def list_chapters(
    project_id: uuid.UUID,
    act_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all chapters for an act"""
    project = await verify_project_access(project_id, current_user, db)

    outline = db.query(Outline).filter(Outline.project_id == project_id).first()
    if not outline:
        return []

    act = db.query(Act).filter(
        Act.id == act_id,
        Act.outline_id == outline.id
    ).first()

    if not act:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Act not found"
        )

    chapters = db.query(Chapter).filter(Chapter.act_id == act_id).order_by(Chapter.order).all()
    return chapters


@router.put("/outline/chapters/{chapter_id}", response_model=ChapterResponse)
async def update_chapter(
    project_id: uuid.UUID,
    chapter_id: uuid.UUID,
    data: ChapterUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update a chapter"""
    project = await verify_project_access(project_id, current_user, db)

    chapter = db.query(Chapter).join(Act).join(Outline).filter(
        Chapter.id == chapter_id,
        Outline.project_id == project_id
    ).first()

    if not chapter:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chapter not found"
        )

    # Update fields
    if data.name is not None:
        chapter.name = data.name
    if data.description is not None:
        chapter.description = data.description
    if data.order is not None:
        chapter.order = data.order

    # Create new version
    language = data.language or 'English'
    version_id = uuid.uuid4()

    db.query(StoryObjectVersion).filter(
        StoryObjectVersion.object_id == chapter.id
    ).update({'is_active': False})

    version = StoryObjectVersion(
        id=version_id,
        object_id=chapter.id,
        object_type='chapter',
        user_request='User Edit',
        is_active=True,
        data={
            language: {
                'name': chapter.name,
                'description': chapter.description
            }
        }
    )

    chapter.active_version_id = version_id
    db.add(version)
    db.commit()
    db.refresh(chapter)

    return chapter


@router.delete("/outline/chapters/{chapter_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_chapter(
    project_id: uuid.UUID,
    chapter_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a chapter"""
    project = await verify_project_access(project_id, current_user, db)

    chapter = db.query(Chapter).join(Act).join(Outline).filter(
        Chapter.id == chapter_id,
        Outline.project_id == project_id
    ).first()

    if not chapter:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chapter not found"
        )

    db.delete(chapter)
    db.commit()

    return None


# ============================================================================
# CHAPTER CONTENT
# ============================================================================

@router.post("/chapters/{chapter_id}/content", response_model=ChapterContentResponse, status_code=status.HTTP_201_CREATED)
async def create_chapter_content(
    project_id: uuid.UUID,
    chapter_id: uuid.UUID,
    data: ChapterContentCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create chapter content"""
    project = await verify_project_access(project_id, current_user, db)

    chapter = db.query(Chapter).join(Act).join(Outline).filter(
        Chapter.id == chapter_id,
        Outline.project_id == project_id
    ).first()

    if not chapter:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chapter not found"
        )

    # Check if content already exists
    existing = db.query(ChapterContent).filter(ChapterContent.chapter_id == chapter_id).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Chapter content already exists"
        )

    version_id = uuid.uuid4()
    chapter_content = ChapterContent(
        id=uuid.uuid4(),
        chapter_id=chapter_id,
        active_version_id=version_id
    )

    db.add(chapter_content)
    db.flush()

    # Create initial version
    word_count = len(data.content.split())
    version = ChapterContentVersion(
        id=version_id,
        chapter_content_id=chapter_content.id,
        user_request=data.userRequest,
        is_active=True,
        data={
            data.language: {
                'content': data.content,
                'wordCount': word_count
            }
        }
    )

    db.add(version)
    db.commit()
    db.refresh(chapter_content)
    db.refresh(version)

    # Force load versions relationship
    chapter_content.versions  # type: ignore

    return chapter_content


@router.get("/chapters/{chapter_id}/content", response_model=ChapterContentResponse)
async def get_chapter_content(
    project_id: uuid.UUID,
    chapter_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get chapter content with all versions"""
    print(f"[Backend] get_chapter_content called: project_id={project_id}, chapter_id={chapter_id}")

    project = await verify_project_access(project_id, current_user, db)

    chapter = db.query(Chapter).join(Act).join(Outline).filter(
        Chapter.id == chapter_id,
        Outline.project_id == project_id
    ).first()

    if not chapter:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chapter not found"
        )

    content = db.query(ChapterContent).filter(ChapterContent.chapter_id == chapter_id).first()
    if not content:
        print(f"[Backend] No chapter content found for chapter_id={chapter_id}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chapter content not found"
        )

    # Explicitly load the versions relationship to ensure it's in the response
    _ = content.versions  # Trigger lazy load

    print(f"[Backend] Returning content: id={content.id}, versions_count={len(content.versions)}, active_version_id={content.active_version_id}")
    for v in content.versions:
        print(f"[Backend]   Version: id={v.id}, isActive={v.is_active}, languages={list(v.data.keys())}")

    return content


@router.put("/chapters/{chapter_id}/content", response_model=ChapterContentResponse)
async def update_chapter_content(
    project_id: uuid.UUID,
    chapter_id: uuid.UUID,
    data: ChapterContentUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update chapter content (creates if doesn't exist)"""
    print(f"[Backend] update_chapter_content called: project_id={project_id}, chapter_id={chapter_id}, language={data.language}, content_length={len(data.content)}")

    project = await verify_project_access(project_id, current_user, db)

    chapter = db.query(Chapter).join(Act).join(Outline).filter(
        Chapter.id == chapter_id,
        Outline.project_id == project_id
    ).first()

    if not chapter:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chapter not found"
        )

    content = db.query(ChapterContent).filter(ChapterContent.chapter_id == chapter_id).first()
    print(f"[Backend] Chapter content found: {content is not None}")

    # If content doesn't exist, create it (PUT should be idempotent)
    if not content:
        print("[Backend] Creating new chapter content...")
        version_id = uuid.uuid4()
        word_count = len(data.content.split())

        content = ChapterContent(
            id=uuid.uuid4(),
            chapter_id=chapter_id,
            active_version_id=version_id
        )

        db.add(content)
        db.flush()

        # Create initial version
        version = ChapterContentVersion(
            id=version_id,
            chapter_content_id=content.id,
            user_request=data.userRequest,
            is_active=True,
            data={
                data.language: {
                    'content': data.content,
                    'wordCount': word_count
                }
            }
        )

        db.add(version)
        db.commit()
        db.refresh(content)
        db.refresh(version)

        # Force load versions relationship
        content.versions  # type: ignore

        print(f"[Backend] New chapter content created successfully: content_id={content.id}, version_id={version_id}")
        return content

    # Get the current active version to preserve existing language data
    print(f"[Backend] Updating existing chapter content... create_new_version={data.create_new_version}")
    current_version = db.query(ChapterContentVersion).filter(
        ChapterContentVersion.chapter_content_id == content.id,
        ChapterContentVersion.is_active == True  # type: ignore
    ).first()

    # Start with existing language data or empty dict
    version_data: dict = {}
    if current_version:
        # JSONB field returns dict at runtime
        existing_data = current_version.data  # type: ignore
        if existing_data:  # type: ignore
            version_data = dict(existing_data)  # type: ignore

    print(f"[Backend] Current version data languages: {list(version_data.keys())}")

    word_count = len(data.content.split())

    # Update the specific language while preserving others
    version_data[data.language] = {
        'content': data.content,
        'wordCount': word_count
    }

    if data.create_new_version:
        # Create new version
        print("[Backend] Creating new version...")
        version_id = uuid.uuid4()

        # Deactivate old versions using bulk update
        db.query(ChapterContentVersion).filter(
            ChapterContentVersion.chapter_content_id == content.id
        ).update({'is_active': False}, synchronize_session=False)

        # Flush to execute the bulk update before creating new version
        db.flush()

        # Expire the content object to ensure versions are reloaded
        db.expire(content, ['versions'])

        # Create new version
        version = ChapterContentVersion(
            id=version_id,
            chapter_content_id=content.id,
            user_request=data.userRequest,
            is_active=True,
            data=version_data
        )

        # Update active_version_id
        content.active_version_id = version_id  # type: ignore

        db.add(version)
        db.flush()

        # Commit the transaction
        db.commit()

        # Refresh to get the latest state and explicitly load versions
        db.refresh(content)
        db.refresh(version)

        # Force reload versions to ensure we get the updated list
        content.versions  # type: ignore

        print(f"[Backend] New version created: content_id={content.id}, version_id={version_id}, languages={list(version_data.keys())}")
    else:
        # Update existing active version in place
        print("[Backend] Updating existing active version in place...")
        if not current_version:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No active version found to update"
            )

        # Update the version data and user request
        current_version.data = version_data  # type: ignore
        current_version.user_request = data.userRequest  # type: ignore

        db.commit()
        db.refresh(content)

        # Force reload versions
        content.versions  # type: ignore

        print(f"[Backend] Active version updated in place: version_id={current_version.id}, languages={list(version_data.keys())}")

    return content


@router.patch("/chapters/{chapter_id}/content/versions/{version_id}/activate", response_model=ChapterContentResponse)
async def set_active_chapter_version(
    project_id: uuid.UUID,
    chapter_id: uuid.UUID,
    version_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Set a specific version as the active version for chapter content"""
    print(f"[Backend] set_active_chapter_version called: project_id={project_id}, chapter_id={chapter_id}, version_id={version_id}")

    project = await verify_project_access(project_id, current_user, db)

    # Verify chapter exists and belongs to project
    chapter = db.query(Chapter).join(Act).join(Outline).filter(
        Chapter.id == chapter_id,
        Outline.project_id == project_id
    ).first()

    if not chapter:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chapter not found"
        )

    # Get chapter content
    content = db.query(ChapterContent).filter(ChapterContent.chapter_id == chapter_id).first()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chapter content not found"
        )

    # Verify version exists and belongs to this content
    version = db.query(ChapterContentVersion).filter(
        ChapterContentVersion.id == version_id,
        ChapterContentVersion.chapter_content_id == content.id
    ).first()

    if not version:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Version not found"
        )

    # Deactivate all versions for this content
    db.query(ChapterContentVersion).filter(
        ChapterContentVersion.chapter_content_id == content.id
    ).update({'is_active': False}, synchronize_session=False)

    # Activate the selected version
    version.is_active = True  # type: ignore
    content.active_version_id = version_id  # type: ignore

    db.commit()
    db.refresh(content)

    # Force reload versions
    _ = content.versions

    print(f"[Backend] Version activated successfully: version_id={version_id}")
    return content


# ============================================================================
# VERSION MANAGEMENT FOR STORY OBJECTS
# ============================================================================

@router.get("/story-objects/{object_type}/{object_id}/versions", response_model=VersionListResponse)
async def get_story_object_versions(
    project_id: uuid.UUID,
    object_type: str,
    object_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all versions for a story object"""
    project = await verify_project_access(project_id, current_user, db)

    # Validate object_type
    valid_types = ['basic_info', 'character', 'organization', 'location', 'lorebook', 'outline', 'act', 'chapter']
    if object_type not in valid_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid object type. Must be one of: {', '.join(valid_types)}"
        )

    # Verify object exists and belongs to project
    type_to_model = {
        'basic_info': BasicInfo,
        'character': Character,
        'organization': Organization,
        'location': Location,
        'lorebook': LorebookEntry,
        'outline': Outline,
        'act': Act,
        'chapter': Chapter
    }

    model_class = type_to_model[object_type]

    # Query object based on type
    if object_type == 'basic_info':
        obj = db.query(model_class).filter(
            model_class.id == object_id,
            model_class.project_id == project_id
        ).first()
    elif object_type == 'outline':
        obj = db.query(model_class).filter(
            model_class.id == object_id,
            model_class.project_id == project_id
        ).first()
    elif object_type in ['character', 'organization', 'location', 'lorebook']:
        obj = db.query(model_class).filter(
            model_class.id == object_id,
            model_class.project_id == project_id
        ).first()
    elif object_type == 'act':
        obj = db.query(model_class).join(Outline).filter(
            model_class.id == object_id,
            Outline.project_id == project_id
        ).first()
    elif object_type == 'chapter':
        obj = db.query(model_class).join(Act).join(Outline).filter(
            model_class.id == object_id,
            Outline.project_id == project_id
        ).first()

    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"{object_type.replace('_', ' ').title()} not found"
        )

    # Get all versions for this object
    versions = db.query(StoryObjectVersion).filter(
        StoryObjectVersion.object_id == object_id,
        StoryObjectVersion.object_type == object_type
    ).order_by(StoryObjectVersion.timestamp.desc()).all()

    return VersionListResponse(
        versions=versions,
        total=len(versions)
    )


@router.patch("/story-objects/{object_type}/{object_id}/versions/{version_id}/activate", response_model=VersionResponse)
async def activate_story_object_version(
    project_id: uuid.UUID,
    object_type: str,
    object_id: uuid.UUID,
    version_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Set a specific version as the active version for a story object"""
    project = await verify_project_access(project_id, current_user, db)

    # Validate object_type
    valid_types = ['basic_info', 'character', 'organization', 'location', 'lorebook', 'outline', 'act', 'chapter']
    if object_type not in valid_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid object type. Must be one of: {', '.join(valid_types)}"
        )

    # Verify version exists and belongs to this object
    version = db.query(StoryObjectVersion).filter(
        StoryObjectVersion.id == version_id,
        StoryObjectVersion.object_id == object_id,
        StoryObjectVersion.object_type == object_type
    ).first()

    if not version:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Version not found"
        )

    # Deactivate all versions for this object
    db.query(StoryObjectVersion).filter(
        StoryObjectVersion.object_id == object_id,
        StoryObjectVersion.object_type == object_type
    ).update({'is_active': False}, synchronize_session=False)

    # Activate the selected version
    version.is_active = True

    # Update the active_version_id on the parent object
    type_to_model = {
        'basic_info': BasicInfo,
        'character': Character,
        'organization': Organization,
        'location': Location,
        'lorebook': LorebookEntry,
        'outline': Outline,
        'act': Act,
        'chapter': Chapter
    }

    model_class = type_to_model[object_type]
    obj = db.query(model_class).filter(model_class.id == object_id).first()
    if obj:
        obj.active_version_id = version_id

        # Also update the flat fields with the version data
        # Get the first available language data from the version
        version_data = version.data  # type: ignore
        if version_data:
            # Get first language's data
            first_lang_data = next(iter(version_data.values()), {})

            if object_type == 'basic_info':
                obj.title = first_lang_data.get('title')
                obj.logline = first_lang_data.get('logline')
                obj.genre = first_lang_data.get('genre')
            elif object_type in ['character', 'organization', 'location', 'lorebook', 'act', 'chapter']:
                obj.name = first_lang_data.get('name')
                obj.description = first_lang_data.get('description')

    db.commit()
    db.refresh(version)

    return version


@router.delete("/story-objects/{object_type}/{object_id}/versions/{version_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_story_object_version(
    project_id: uuid.UUID,
    object_type: str,
    object_id: uuid.UUID,
    version_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a specific version of a story object"""
    project = await verify_project_access(project_id, current_user, db)

    # Validate object_type
    valid_types = ['basic_info', 'character', 'organization', 'location', 'lorebook', 'outline', 'act', 'chapter']
    if object_type not in valid_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid object type. Must be one of: {', '.join(valid_types)}"
        )

    # Verify version exists and belongs to this object
    version = db.query(StoryObjectVersion).filter(
        StoryObjectVersion.id == version_id,
        StoryObjectVersion.object_id == object_id,
        StoryObjectVersion.object_type == object_type
    ).first()

    if not version:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Version not found"
        )

    # Prevent deletion of active version
    if version.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete the active version. Please activate another version first."
        )

    # Check if this is the last version
    version_count = db.query(StoryObjectVersion).filter(
        StoryObjectVersion.object_id == object_id,
        StoryObjectVersion.object_type == object_type
    ).count()

    if version_count <= 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete the last remaining version"
        )

    db.delete(version)
    db.commit()

    return None

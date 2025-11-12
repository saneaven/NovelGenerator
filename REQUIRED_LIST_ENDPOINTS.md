# Required List Endpoints for Unified System

## Overview
The NameDescriptionManager component requires list/collection endpoints that are not yet implemented in the unified translation system. These endpoints are needed to manage multiple objects (characters, organizations, locations, lorebook entries).

---

## Missing Endpoints

### 1. List Objects by Type
**Endpoint**: `GET /api/v1/projects/{project_id}/objects/{object_type}`

**Purpose**: Get all objects of a specific type for a project

**Parameters**:
- `project_id` (path) - UUID of the project
- `object_type` (path) - One of: character, organization, location, lorebook, act, chapter, etc.
- `language` (query, optional) - Language to return data in (defaults to project's primary language)

**Response**:
```json
{
  "objects": [
    {
      "id": "uuid",
      "type": "character",
      "metadata": {
        "project_id": "uuid",
        "created_at": "timestamp",
        "updated_at": "timestamp"
      },
      "data": {
        "name": "John Doe",
        "description": "Hero of the story"
      },
      "languages": {
        "available": ["English", "Korean"],
        "active": "English",
        "default": "English"
      },
      "version": {
        "id": "uuid",
        "number": 5,
        "created_at": "timestamp"
      }
    }
  ],
  "total": 10,
  "page": 1,
  "page_size": 50
}
```

### 2. Create Object
**Endpoint**: `POST /api/v1/projects/{project_id}/objects/{object_type}`

**Purpose**: Create a new object of a specific type

**Request Body**:
```json
{
  "data": {
    "name": "New Character",
    "description": "Character description"
  },
  "language": "English",
  "user_request": "Initial Creation"
}
```

**Response**:
```json
{
  "id": "uuid",
  "type": "character",
  "metadata": {
    "project_id": "uuid",
    "created_at": "timestamp",
    "updated_at": "timestamp"
  },
  "data": {
    "name": "New Character",
    "description": "Character description"
  },
  "languages": {
    "available": ["English"],
    "active": "English",
    "default": "English"
  },
  "version": {
    "id": "uuid",
    "number": 1,
    "created_at": "timestamp"
  }
}
```

### 3. Delete Object
**Endpoint**: `DELETE /api/v1/objects/{object_type}/{object_id}`

**Purpose**: Delete an object and all its translations/versions

**Response**:
```json
{
  "success": true,
  "message": "Object deleted successfully"
}
```

**Database Actions**:
- Delete from core object table (Character, Organization, etc.)
- Cascade delete all ObjectTranslations
- Cascade delete all ObjectVersions
- Delete ActiveVersion pointer

---

## Implementation in Backend

### File: `App/backend/routes/unified_object_routes.py`

Add these new endpoints:

```python
@router.get("/projects/{project_id}/objects/{object_type}")
async def list_objects(
    project_id: UUID,
    object_type: str,
    language: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    List all objects of a specific type for a project.
    Returns objects with data in the specified language (or project default).
    """
    # Validate object type
    if object_type not in VALID_OBJECT_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid object type: {object_type}")

    # Verify user has access to project
    project = db.query(Project).filter(
        Project.id == project_id,
        Project.user_id == current_user.id
    ).first()

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Get project default language if not specified
    if not language:
        language = project.primary_language or 'English'

    # Get core objects
    model_class = get_model_class(object_type)
    core_objects = db.query(model_class).filter(
        model_class.project_id == project_id
    ).all()

    # Build response objects
    result_objects = []
    for core_obj in core_objects:
        # Get active translation
        translation = db.query(ObjectTranslation).filter(
            ObjectTranslation.object_id == core_obj.id,
            ObjectTranslation.language == language,
            ObjectTranslation.is_active == True
        ).first()

        # Fallback to any available language if requested language not found
        if not translation:
            translation = db.query(ObjectTranslation).filter(
                ObjectTranslation.object_id == core_obj.id,
                ObjectTranslation.is_active == True
            ).first()

        if not translation:
            continue  # Skip objects with no translations

        # Get available languages
        available_langs = db.query(ObjectTranslation.language).filter(
            ObjectTranslation.object_id == core_obj.id
        ).distinct().all()
        available_languages = [lang[0] for lang in available_langs]

        # Get active version info
        active_version = db.query(ActiveVersion).filter(
            ActiveVersion.object_id == core_obj.id
        ).first()

        version_info = None
        if active_version:
            version = db.query(ObjectVersion).filter(
                ObjectVersion.id == active_version.active_version_id
            ).first()

            if version:
                version_info = {
                    "id": str(version.id),
                    "number": version.version_number,
                    "created_at": version.created_at.isoformat()
                }

        # Build unified object
        unified_obj = {
            "id": str(core_obj.id),
            "type": object_type,
            "metadata": {
                "project_id": str(project_id),
                "created_at": core_obj.created_at.isoformat() if hasattr(core_obj, 'created_at') else None,
                "updated_at": core_obj.updated_at.isoformat() if hasattr(core_obj, 'updated_at') else None,
            },
            "data": translation.data,
            "languages": {
                "available": available_languages,
                "active": translation.language,
                "default": available_languages[0] if available_languages else None,
            },
            "version": version_info,
        }

        result_objects.append(unified_obj)

    # Calculate pagination
    total = len(result_objects)
    start = (page - 1) * page_size
    end = start + page_size
    paginated_objects = result_objects[start:end]

    return {
        "objects": paginated_objects,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.post("/projects/{project_id}/objects/{object_type}")
async def create_object(
    project_id: UUID,
    object_type: str,
    request: CreateObjectRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Create a new object of a specific type.
    """
    # Validate object type
    if object_type not in VALID_OBJECT_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid object type: {object_type}")

    # Verify user has access to project
    project = db.query(Project).filter(
        Project.id == project_id,
        Project.user_id == current_user.id
    ).first()

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Create core object (structure only)
    model_class = get_model_class(object_type)
    object_id = uuid4()

    core_obj = model_class(
        id=object_id,
        project_id=project_id,
    )
    db.add(core_obj)

    # Create initial version
    version_id = uuid4()
    version = ObjectVersion(
        id=version_id,
        object_type=object_type,
        object_id=object_id,
        version_number=1,
        data={request.language: request.data},
        user_request=request.user_request or 'Initial Creation',
        created_by=current_user.id,
    )
    db.add(version)

    # Create active version pointer
    active_version = ActiveVersion(
        object_type=object_type,
        object_id=object_id,
        active_version_id=version_id,
    )
    db.add(active_version)

    # Create translation cache
    translation = ObjectTranslation(
        id=uuid4(),
        object_type=object_type,
        object_id=object_id,
        language=request.language,
        data=request.data,
        is_active=True,
    )
    db.add(translation)

    db.commit()
    db.refresh(core_obj)

    # Return unified object response
    return build_unified_object_response(
        core_obj, translation, version, [request.language]
    )


@router.delete("/objects/{object_type}/{object_id}")
async def delete_object(
    object_type: str,
    object_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Delete an object and all its translations/versions.
    """
    # Validate object type
    if object_type not in VALID_OBJECT_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid object type: {object_type}")

    # Get core object and verify ownership
    model_class = get_model_class(object_type)
    core_obj = db.query(model_class).filter(
        model_class.id == object_id
    ).first()

    if not core_obj:
        raise HTTPException(status_code=404, detail="Object not found")

    # Verify user has access to the project
    project = db.query(Project).filter(
        Project.id == core_obj.project_id,
        Project.user_id == current_user.id
    ).first()

    if not project:
        raise HTTPException(status_code=403, detail="Access denied")

    # Delete all related data
    # 1. Delete translations
    db.query(ObjectTranslation).filter(
        ObjectTranslation.object_id == object_id
    ).delete()

    # 2. Delete versions
    db.query(ObjectVersion).filter(
        ObjectVersion.object_id == object_id
    ).delete()

    # 3. Delete active version pointer
    db.query(ActiveVersion).filter(
        ActiveVersion.object_id == object_id
    ).delete()

    # 4. Delete core object
    db.delete(core_obj)

    db.commit()

    return {
        "success": True,
        "message": f"{object_type.capitalize()} deleted successfully"
    }
```

---

## Frontend Store Methods

Add to `App/frontend/src/store/unifiedObjectStore.ts`:

```typescript
interface UnifiedObjectStore {
  // ... existing methods ...

  // List operations
  fetchObjectList: (type: ObjectType, projectId: string, language?: string) => Promise<UnifiedObject[]>;
  createObject: (type: ObjectType, projectId: string, request: CreateObjectRequest) => Promise<UnifiedObject>;
  deleteObject: (type: ObjectType, id: string) => Promise<void>;
}

// Implementation
const store = create<UnifiedObjectStore>((set, get) => ({
  // ... existing implementation ...

  fetchObjectList: async (type, projectId, language) => {
    try {
      const response = await unifiedObjectService.listObjects(type, projectId, language);

      // Store all objects in the objects map
      const objectsMap: Record<string, UnifiedObject> = {};
      response.objects.forEach(obj => {
        objectsMap[obj.id] = obj;
      });

      set(state => ({
        objects: { ...state.objects, ...objectsMap },
      }));

      return response.objects;
    } catch (error) {
      console.error('Failed to fetch object list:', error);
      throw error;
    }
  },

  createObject: async (type, projectId, request) => {
    try {
      const newObject = await unifiedObjectService.createObject(type, projectId, request);

      set(state => ({
        objects: { ...state.objects, [newObject.id]: newObject },
      }));

      return newObject;
    } catch (error) {
      console.error('Failed to create object:', error);
      throw error;
    }
  },

  deleteObject: async (type, id) => {
    try {
      await unifiedObjectService.deleteObject(type, id);

      set(state => {
        const { [id]: deleted, ...remainingObjects } = state.objects;
        return { objects: remainingObjects };
      });
    } catch (error) {
      console.error('Failed to delete object:', error);
      throw error;
    }
  },
}));
```

---

## Priority

**HIGH** - These endpoints are required for:
- NameDescriptionManager component (Character, Organization, Location, Lorebook)
- Any list/grid views
- Bulk operations
- Project overview pages

---

## Next Steps

1. Implement list endpoint in `unified_object_routes.py`
2. Implement create endpoint
3. Implement delete endpoint
4. Add corresponding methods to `unifiedObjectService.ts`
5. Add corresponding methods to `unifiedObjectStore.ts`
6. Complete NameDescriptionManager migration
7. Test all CRUD operations

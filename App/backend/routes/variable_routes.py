"""API routes for prompt variable management"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from ..database import get_db
from ..auth import get_current_user
from ..models.db_models import User
from ..schemas.variables import (
    VariableCreate,
    VariableValueUpdate,
    VariableDefinitionUpdate,
    VariableResponse,
    VariableListResponse,
    VariablesForTemplateResponse,
    VariableReorderRequest
)
from ..services.variable_service import variable_service

router = APIRouter(prefix="/api/v1/variables", tags=["variables"])


@router.get(
    "",
    response_model=List[VariableResponse]
)
async def list_all_variables(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all variables for the current user ordered by display_order"""
    return variable_service.get_all_variables(db=db, user_id=current_user.id)


@router.get(
    "/values",
    response_model=VariablesForTemplateResponse
)
async def get_variables_for_template(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all variables as a dict for template engine usage"""
    variables_dict = variable_service.get_variables_for_template(db=db, user_id=current_user.id)
    return VariablesForTemplateResponse(variables=variables_dict)


@router.get(
    "/by-id/{variable_id}",
    response_model=VariableResponse
)
async def get_variable_by_id(
    variable_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get a single variable by ID"""
    variable = variable_service.get_variable_by_id(db=db, user_id=current_user.id, variable_id=variable_id)
    if not variable:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Variable with ID '{variable_id}' not found"
        )
    return variable


@router.post(
    "",
    response_model=VariableResponse,
    status_code=status.HTTP_201_CREATED
)
async def create_variable(
    data: VariableCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new variable"""
    try:
        return variable_service.create_variable(db=db, user_id=current_user.id, data=data)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e)
        )


@router.patch(
    "/by-id/{variable_id}/value",
    response_model=VariableResponse
)
async def update_variable_value_by_id(
    variable_id: str,
    data: VariableValueUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update variable value by ID (for auto-save scenario)"""
    try:
        variable = variable_service.update_variable_value_by_id(
            db=db, user_id=current_user.id, variable_id=variable_id, data=data
        )
        if not variable:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Variable with ID '{variable_id}' not found"
            )
        return variable
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.put(
    "/by-id/{variable_id}",
    response_model=VariableResponse
)
async def update_variable_definition_by_id(
    variable_id: str,
    data: VariableDefinitionUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update variable definition by ID (name, description, options)"""
    try:
        variable = variable_service.update_variable_definition_by_id(
            db=db, user_id=current_user.id, variable_id=variable_id, data=data
        )
        if not variable:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Variable with ID '{variable_id}' not found"
            )
        return variable
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e)
        )


@router.delete(
    "/by-id/{variable_id}",
    status_code=status.HTTP_200_OK
)
async def delete_variable_by_id(
    variable_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a variable by ID"""
    deleted = variable_service.delete_variable_by_id(db=db, user_id=current_user.id, variable_id=variable_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Variable with ID '{variable_id}' not found"
        )
    return {"message": "Variable deleted successfully"}


@router.put(
    "/reorder",
    status_code=status.HTTP_200_OK
)
async def reorder_variables(
    data: VariableReorderRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Reorder variables by updating display_order"""
    variable_service.reorder_variables(
        db=db, user_id=current_user.id, ordered_ids=data.ordered_ids
    )
    return {"message": "Variables reordered successfully"}

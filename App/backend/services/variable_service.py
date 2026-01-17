"""Variable service for managing user-defined prompt variables"""
from sqlalchemy.orm import Session
from sqlalchemy import and_
from typing import Optional, List, Dict, Any, Union
from datetime import datetime
import uuid

from ..models.db_models import PromptVariable
from ..schemas.variables import (
    VariableCreate,
    VariableValueUpdate,
    VariableDefinitionUpdate,
    VariableResponse,
    VariableType,
    NumberOptions
)


class VariableService:
    """Service for managing prompt variables"""

    @staticmethod
    def get_all_variables(
        db: Session,
        user_id: uuid.UUID
    ) -> List[VariableResponse]:
        """
        Get all variables for a user ordered by display_order.

        Args:
            db: Database session
            user_id: User ID

        Returns:
            List of VariableResponse
        """
        variables = db.query(PromptVariable).filter(
            PromptVariable.user_id == user_id
        ).order_by(PromptVariable.display_order).all()

        return [
            VariableResponse(
                id=str(v.id),
                name=v.name,
                var_type=VariableType(v.var_type),
                value=v.value.get('value') if v.value else None,
                select_options=v.select_options,
                number_options=NumberOptions(**v.number_options) if v.number_options else None,
                description=v.description,
                display_order=v.display_order,
                created_at=v.created_at,
                updated_at=v.updated_at
            )
            for v in variables
        ]

    @staticmethod
    def get_variables_for_template(
        db: Session,
        user_id: uuid.UUID
    ) -> Dict[str, Union[str, int, float, bool, None]]:
        """
        Get all variables as a dict for template engine usage.

        Args:
            db: Database session
            user_id: User ID

        Returns:
            Dict of variable name -> value
        """
        variables = db.query(PromptVariable).filter(
            PromptVariable.user_id == user_id
        ).all()

        return {
            v.name: v.value.get('value') if v.value else None
            for v in variables
        }

    @staticmethod
    def get_variable_by_id(
        db: Session,
        user_id: uuid.UUID,
        variable_id: str
    ) -> Optional[VariableResponse]:
        """
        Get a single variable by ID.

        Args:
            db: Database session
            user_id: User ID
            variable_id: Variable ID (UUID string)

        Returns:
            VariableResponse or None if not found
        """
        try:
            var_uuid = uuid.UUID(variable_id)
        except ValueError:
            return None

        variable = db.query(PromptVariable).filter(
            and_(
                PromptVariable.user_id == user_id,
                PromptVariable.id == var_uuid
            )
        ).first()

        if not variable:
            return None

        return VariableResponse(
            id=str(variable.id),
            name=variable.name,
            var_type=VariableType(variable.var_type),
            value=variable.value.get('value') if variable.value else None,
            select_options=variable.select_options,
            number_options=NumberOptions(**variable.number_options) if variable.number_options else None,
            description=variable.description,
            display_order=variable.display_order,
            created_at=variable.created_at,
            updated_at=variable.updated_at
        )

    @staticmethod
    def create_variable(
        db: Session,
        user_id: uuid.UUID,
        data: VariableCreate
    ) -> VariableResponse:
        """
        Create a new variable.

        Args:
            db: Database session
            user_id: User ID
            data: Variable creation data

        Returns:
            Created VariableResponse

        Raises:
            ValueError: If variable name already exists
        """
        # Check for existing variable with same name
        existing = db.query(PromptVariable).filter(
            and_(
                PromptVariable.user_id == user_id,
                PromptVariable.name == data.name
            )
        ).first()

        if existing:
            raise ValueError(f"Variable '{data.name}' already exists")

        # Get max display_order for this user
        max_order = db.query(PromptVariable).filter(
            PromptVariable.user_id == user_id
        ).count()

        # Determine default value based on type
        default_value = data.default_value
        if default_value is None:
            if data.var_type == VariableType.STRING:
                default_value = ""
            elif data.var_type == VariableType.NUMBER:
                default_value = 0
            elif data.var_type == VariableType.BOOLEAN:
                default_value = False
            elif data.var_type == VariableType.SELECT and data.select_options:
                default_value = data.select_options[0]

        variable = PromptVariable(
            id=uuid.uuid4(),
            user_id=user_id,
            name=data.name,
            var_type=data.var_type.value,
            value={'value': default_value},
            select_options=data.select_options,
            number_options=data.number_options.model_dump() if data.number_options else None,
            description=data.description,
            display_order=max_order
        )

        db.add(variable)
        db.commit()
        db.refresh(variable)

        return VariableResponse(
            id=str(variable.id),
            name=variable.name,
            var_type=VariableType(variable.var_type),
            value=variable.value.get('value') if variable.value else None,
            select_options=variable.select_options,
            number_options=NumberOptions(**variable.number_options) if variable.number_options else None,
            description=variable.description,
            display_order=variable.display_order,
            created_at=variable.created_at,
            updated_at=variable.updated_at
        )

    @staticmethod
    def update_variable_value_by_id(
        db: Session,
        user_id: uuid.UUID,
        variable_id: str,
        data: VariableValueUpdate
    ) -> Optional[VariableResponse]:
        """
        Update just the value of a variable by ID (for auto-save scenario).

        Args:
            db: Database session
            user_id: User ID
            variable_id: Variable ID (UUID string)
            data: Value update data

        Returns:
            Updated VariableResponse or None if not found
        """
        try:
            var_uuid = uuid.UUID(variable_id)
        except ValueError:
            return None

        variable = db.query(PromptVariable).filter(
            and_(
                PromptVariable.user_id == user_id,
                PromptVariable.id == var_uuid
            )
        ).first()

        if not variable:
            return None

        # Validate value type
        var_type = VariableType(variable.var_type)
        value = data.value

        if var_type == VariableType.STRING and value is not None and not isinstance(value, str):
            raise ValueError('String type requires string value')
        elif var_type == VariableType.NUMBER and value is not None and not isinstance(value, (int, float)):
            raise ValueError('Number type requires numeric value')
        elif var_type == VariableType.BOOLEAN and value is not None and not isinstance(value, bool):
            raise ValueError('Boolean type requires boolean value')
        elif var_type == VariableType.SELECT and variable.select_options:
            if value is not None and value not in variable.select_options:
                raise ValueError('Value must be one of the select options')

        # Validate number value against min/max if number_options is set
        if var_type == VariableType.NUMBER and value is not None and variable.number_options:
            num_opts = variable.number_options
            if num_opts.get('min') is not None and value < num_opts['min']:
                raise ValueError(f'Value must be at least {num_opts["min"]}')
            if num_opts.get('max') is not None and value > num_opts['max']:
                raise ValueError(f'Value must be at most {num_opts["max"]}')

        variable.value = {'value': value}
        variable.updated_at = datetime.utcnow()

        db.commit()
        db.refresh(variable)

        return VariableResponse(
            id=str(variable.id),
            name=variable.name,
            var_type=VariableType(variable.var_type),
            value=variable.value.get('value') if variable.value else None,
            select_options=variable.select_options,
            number_options=NumberOptions(**variable.number_options) if variable.number_options else None,
            description=variable.description,
            display_order=variable.display_order,
            created_at=variable.created_at,
            updated_at=variable.updated_at
        )

    @staticmethod
    def update_variable_definition_by_id(
        db: Session,
        user_id: uuid.UUID,
        variable_id: str,
        data: VariableDefinitionUpdate
    ) -> Optional[VariableResponse]:
        """
        Update variable definition by ID (name, description, options).

        Args:
            db: Database session
            user_id: User ID
            variable_id: Variable ID (UUID string)
            data: Definition update data

        Returns:
            Updated VariableResponse or None if not found
        """
        try:
            var_uuid = uuid.UUID(variable_id)
        except ValueError:
            return None

        variable = db.query(PromptVariable).filter(
            and_(
                PromptVariable.user_id == user_id,
                PromptVariable.id == var_uuid
            )
        ).first()

        if not variable:
            return None

        # Check if new name conflicts with existing
        if data.name and data.name != variable.name:
            existing = db.query(PromptVariable).filter(
                and_(
                    PromptVariable.user_id == user_id,
                    PromptVariable.name == data.name
                )
            ).first()

            if existing:
                raise ValueError(f"Variable '{data.name}' already exists")

            variable.name = data.name

        if data.description is not None:
            variable.description = data.description

        if data.select_options is not None:
            if VariableType(variable.var_type) == VariableType.SELECT:
                if len(data.select_options) < 2:
                    raise ValueError('Select type requires at least 2 options')
                variable.select_options = data.select_options

                # Reset value if current value is no longer valid
                current_value = variable.value.get('value') if variable.value else None
                if current_value and current_value not in data.select_options:
                    variable.value = {'value': data.select_options[0]}

        # Handle number_options update
        if data.number_options is not None:
            if VariableType(variable.var_type) == VariableType.NUMBER:
                variable.number_options = data.number_options.model_dump()

                # Validate current value against new min/max
                current_value = variable.value.get('value') if variable.value else None
                if current_value is not None:
                    num_opts = data.number_options
                    if num_opts.min is not None and current_value < num_opts.min:
                        variable.value = {'value': num_opts.min}
                    elif num_opts.max is not None and current_value > num_opts.max:
                        variable.value = {'value': num_opts.max}

        if data.display_order is not None:
            variable.display_order = data.display_order

        variable.updated_at = datetime.utcnow()

        db.commit()
        db.refresh(variable)

        return VariableResponse(
            id=str(variable.id),
            name=variable.name,
            var_type=VariableType(variable.var_type),
            value=variable.value.get('value') if variable.value else None,
            select_options=variable.select_options,
            number_options=NumberOptions(**variable.number_options) if variable.number_options else None,
            description=variable.description,
            display_order=variable.display_order,
            created_at=variable.created_at,
            updated_at=variable.updated_at
        )

    @staticmethod
    def delete_variable_by_id(
        db: Session,
        user_id: uuid.UUID,
        variable_id: str
    ) -> bool:
        """
        Delete a variable by ID.

        Args:
            db: Database session
            user_id: User ID
            variable_id: Variable ID (UUID string)

        Returns:
            True if deleted, False if not found
        """
        try:
            var_uuid = uuid.UUID(variable_id)
        except ValueError:
            return False

        variable = db.query(PromptVariable).filter(
            and_(
                PromptVariable.user_id == user_id,
                PromptVariable.id == var_uuid
            )
        ).first()

        if not variable:
            return False

        db.delete(variable)
        db.commit()

        return True

    @staticmethod
    def reorder_variables(
        db: Session,
        user_id: uuid.UUID,
        ordered_ids: List[str]
    ) -> bool:
        """
        Reorder variables by updating display_order based on the provided ID list.

        Args:
            db: Database session
            user_id: User ID
            ordered_ids: List of variable IDs in desired order

        Returns:
            True if successful
        """
        for index, var_id in enumerate(ordered_ids):
            try:
                var_uuid = uuid.UUID(var_id)
            except ValueError:
                continue

            variable = db.query(PromptVariable).filter(
                and_(
                    PromptVariable.user_id == user_id,
                    PromptVariable.id == var_uuid
                )
            ).first()

            if variable:
                variable.display_order = index
                variable.updated_at = datetime.utcnow()

        db.commit()
        return True


# Singleton instance
variable_service = VariableService()

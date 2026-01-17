"""Pydantic schemas for prompt variable management"""
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, Field, field_validator, model_validator


class VariableType(str, Enum):
    """Supported variable types"""
    STRING = 'string'
    NUMBER = 'number'
    BOOLEAN = 'boolean'
    SELECT = 'select'


class NumberOptions(BaseModel):
    """Options for number type variables"""
    min: Optional[float] = None
    max: Optional[float] = None
    step: Optional[float] = Field(default=1, gt=0)
    input_type: Literal['input', 'slider'] = 'input'

    @model_validator(mode='after')
    def validate_slider_requires_min_max(self):
        """Slider input type requires both min and max to be specified"""
        if self.input_type == 'slider':
            if self.min is None or self.max is None:
                raise ValueError('Slider input type requires both min and max values')
            if self.min >= self.max:
                raise ValueError('min must be less than max')
        return self


class VariableCreate(BaseModel):
    """Create new variable"""
    name: str = Field(..., min_length=1, max_length=100, pattern=r'^[a-zA-Z][a-zA-Z0-9_]*$')
    var_type: VariableType
    description: Optional[str] = Field(None, max_length=500)
    select_options: Optional[List[str]] = None
    default_value: Optional[Union[str, int, float, bool]] = None
    number_options: Optional[NumberOptions] = None  # Only for number type

    @field_validator('select_options')
    @classmethod
    def validate_select_options(cls, v, info):
        if info.data.get('var_type') == VariableType.SELECT:
            if not v or len(v) < 2:
                raise ValueError('Select type requires at least 2 options')
        return v

    @field_validator('default_value')
    @classmethod
    def validate_default_value(cls, v, info):
        var_type = info.data.get('var_type')
        if v is None:
            return v

        if var_type == VariableType.STRING and not isinstance(v, str):
            raise ValueError('String type requires string default value')
        elif var_type == VariableType.NUMBER and not isinstance(v, (int, float)):
            raise ValueError('Number type requires numeric default value')
        elif var_type == VariableType.BOOLEAN and not isinstance(v, bool):
            raise ValueError('Boolean type requires boolean default value')
        elif var_type == VariableType.SELECT:
            select_options = info.data.get('select_options', [])
            if select_options and v not in select_options:
                raise ValueError('Default value must be one of the select options')
        return v

    @field_validator('number_options')
    @classmethod
    def validate_number_options(cls, v, info):
        var_type = info.data.get('var_type')
        if var_type != VariableType.NUMBER and v is not None:
            raise ValueError('number_options only valid for number type')
        return v


class VariableValueUpdate(BaseModel):
    """Update variable value only (for auto-save)"""
    value: Union[str, int, float, bool, None]


class VariableDefinitionUpdate(BaseModel):
    """Update variable definition (name, description, options)"""
    name: Optional[str] = Field(None, min_length=1, max_length=100, pattern=r'^[a-zA-Z][a-zA-Z0-9_]*$')
    description: Optional[str] = Field(None, max_length=500)
    select_options: Optional[List[str]] = None
    display_order: Optional[int] = None
    number_options: Optional[NumberOptions] = None  # Only for number type


class VariableResponse(BaseModel):
    """Variable response"""
    id: str
    name: str
    var_type: VariableType
    value: Union[str, int, float, bool, None]
    select_options: Optional[List[str]]
    number_options: Optional[NumberOptions]
    description: Optional[str]
    display_order: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class VariableListResponse(BaseModel):
    """List of variables"""
    variables: List[VariableResponse]


class VariablesForTemplateResponse(BaseModel):
    """Variables as dict for template engine usage"""
    variables: Dict[str, Union[str, int, float, bool, None]]


class VariableReorderRequest(BaseModel):
    """Request to reorder variables"""
    ordered_ids: List[str] = Field(..., min_length=1)

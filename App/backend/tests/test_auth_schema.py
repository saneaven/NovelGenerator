from __future__ import annotations

from uuid import uuid4

from App.backend.models.db_models import User
from App.backend.schemas.auth import UserResponse


def test_user_response_includes_admin_flag() -> None:
    user = User(
        id=uuid4(),
        email="admin@example.com",
        username="admin_user",
        password_hash="hashed",
        is_active=True,
        is_verified=True,
        is_admin=True,
    )

    payload = UserResponse.model_validate(user).model_dump()

    assert payload["is_admin"] is True

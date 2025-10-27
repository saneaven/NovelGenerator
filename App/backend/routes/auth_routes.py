"""Authentication routes"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from datetime import datetime
import uuid

from ..database import get_db
from ..models.db_models import User, UserSettings
from ..schemas.auth import UserRegister, UserLogin, Token, UserResponse
from ..auth import (
    get_password_hash,
    verify_password,
    create_access_token,
    get_current_user
)
from ..services.prompt_service import prompt_service
from ..prompts import get_default_prompts

router = APIRouter(prefix="/api/v1/auth", tags=["Authentication"])


@router.post("/register", response_model=Token, status_code=status.HTTP_201_CREATED)
async def register(user_data: UserRegister, db: Session = Depends(get_db)):
    """
    Register a new user account

    Creates a new user with hashed password and default settings.
    Returns a JWT token for automatic login after registration.
    """
    # Check if email already exists
    existing_user = db.query(User).filter(User.email == user_data.email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )

    # Check if username already exists
    existing_username = db.query(User).filter(User.username == user_data.username).first()
    if existing_username:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already taken"
        )

    # Create new user
    hashed_password = get_password_hash(user_data.password)
    new_user = User(
        id=uuid.uuid4(),
        email=user_data.email,
        username=user_data.username,
        password_hash=hashed_password,
        is_active=True,
        is_verified=False
    )

    db.add(new_user)
    db.flush()  # Get user ID without committing

    # Create default settings for user
    default_settings = UserSettings(
        id=uuid.uuid4(),
        user_id=new_user.id,
        active_provider='copilot',
        ai_model='gpt-5-mini',
        providers_config={
            'copilot': {},
            'openrouter': {'apiKey': ''},
            'custom': {'baseUrl': '', 'apiKey': ''}
        },
        provider_preferences={},
        primary_language='English',
        secondary_language=None
    )

    db.add(default_settings)

    # Initialize default prompts for new user
    try:
        default_prompts = get_default_prompts()
        prompt_service.initialize_default_prompts(
            db=db,
            user_id=new_user.id,
            default_prompts=default_prompts
        )
    except Exception as e:
        # Log error but don't fail registration - prompts can be initialized later
        print(f"Warning: Failed to initialize default prompts for user {new_user.id}: {e}")

    db.commit()
    db.refresh(new_user)

    # Create access token for automatic login
    access_token = create_access_token(data={"sub": str(new_user.id)})

    return {"access_token": access_token, "token_type": "bearer"}


@router.post("/login", response_model=Token)
async def login(credentials: UserLogin, db: Session = Depends(get_db)):
    """
    Login with username and password

    Returns a JWT access token for authenticated requests.
    """
    # Find user by username
    user = db.query(User).filter(User.username == credentials.username).first()

    if not user or not verify_password(credentials.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is inactive"
        )

    # Update last login timestamp
    user.last_login_at = datetime.utcnow()
    db.commit()

    # Create access token
    access_token = create_access_token(data={"sub": str(user.id)})

    return {"access_token": access_token, "token_type": "bearer"}


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(current_user: User = Depends(get_current_user)):
    """
    Get current user information

    Returns the authenticated user's profile.
    """
    return current_user


@router.post("/logout")
async def logout(current_user: User = Depends(get_current_user)):
    """
    Logout current user

    Client should discard the JWT token.
    """
    return {"message": "Successfully logged out"}

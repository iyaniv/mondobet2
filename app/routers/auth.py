from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud
from app.auth import create_token, get_current_user, verify_password
from app.database import get_db
from app.schemas import AuthResponse, LoginRequest, SignupRequest, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/signup", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def signup(data: SignupRequest, db: AsyncSession = Depends(get_db)):
    if await crud.get_user_by_email(db, data.email.strip().lower()):
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered.")
    user = await crud.create_user(db, name=data.name.strip(), email=data.email.strip().lower(), password=data.password, phone=data.phone.strip())
    return AuthResponse(user=UserOut.model_validate(user), token=create_token(user.id))


@router.post("/login", response_model=AuthResponse)
async def login(data: LoginRequest, db: AsyncSession = Depends(get_db)):
    user = await crud.get_user_by_email(db, data.email.strip().lower())
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong email or password.")
    return AuthResponse(user=UserOut.model_validate(user), token=create_token(user.id))


@router.get("/me", response_model=UserOut)
async def me(user=Depends(get_current_user)):
    return user

from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud
from app.auth import get_current_user, require_admin
from app.database import get_db
from app.schemas import HelpSeenIn, UserOut, UserPatch, UserProfileUpdate

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/", response_model=list[UserOut])
async def list_users(_=Depends(require_admin), db: AsyncSession = Depends(get_db)):
    return await crud.get_participants(db)


@router.get("/admin/participants")
async def admin_participants(_=Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Admin-only: participants with full entry details for the expandable dashboard table."""
    return await crud.get_participants_with_entries(db)


@router.patch("/{user_id}", response_model=UserOut)
async def patch_user(
    user_id: int,
    data: UserPatch,
    _=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if data.has_paid is None:
        raise HTTPException(400, "Nothing to update.")
    user = await crud.update_user(db, user_id, data.has_paid)
    if not user:
        raise HTTPException(404, "User not found.")
    return user


@router.get("/me", response_model=UserOut)
async def get_me(user=Depends(get_current_user)):
    return user


@router.patch("/me", response_model=UserOut)
async def update_me(data: UserProfileUpdate, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    updated = await crud.update_user_profile(db, user.id, data.name)
    if not updated:
        raise HTTPException(404, "User not found.")
    return updated


@router.put("/me/help-seen", response_model=UserOut)
async def set_my_help_seen(
    data: HelpSeenIn,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Replace the caller's help_seen map. Used by the onboarding popups so
    the same first-time tips don't re-trigger on a new device or browser.
    """
    updated = await crud.set_user_help_seen(db, user.id, data.help_seen or {})
    if not updated:
        raise HTTPException(404, "User not found.")
    return updated

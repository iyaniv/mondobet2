"""Admin-only data operations: full-database backup & restore.

- GET  /api/admin/backup  → a JSON snapshot of every app table (the client
  saves it as a downloadable .json file).
- POST /api/admin/restore → destructively replaces ALL data from such a
  snapshot (atomic; admin login is always preserved). See crud.import_all.
"""

from fastapi import APIRouter, Body, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud
from app.auth import require_admin
from app.database import get_db

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/backup", response_model=dict)
async def backup(
    _=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Return a full snapshot of every app table (admin only)."""
    return await crud.export_all(db)


@router.post("/restore", response_model=dict)
async def restore(
    payload: dict = Body(...),
    _=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Destructively replace all data from a backup snapshot (admin only)."""
    try:
        counts = await crud.import_all(db, payload)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    return {"ok": True, "restored": counts}

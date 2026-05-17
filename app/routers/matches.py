from fastapi import APIRouter
from app.matches import MATCHES, TEAMS

router = APIRouter(prefix="/matches", tags=["matches"])


@router.get("/")
async def list_matches():
    return {"matches": MATCHES, "teams": TEAMS}

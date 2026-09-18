# @author: Wendy Yang
# @date: 2026-09-19

from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok", "service": "erp-api"}

# @author: Wendy Yang
# @date: 2026-09-19

"""Offset/limit pagination helpers for catalog and directory list endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import Response

from app.schemas import PaginationMeta


def build_pagination(*, skip: int, limit: int, total: int) -> PaginationMeta:
    safe_skip = max(int(skip or 0), 0)
    safe_limit = max(int(limit or 0), 0)
    page_size = safe_limit if safe_limit > 0 else 1
    page = (safe_skip // page_size) + 1
    counted = max(int(total or 0), 0)
    total_pages = (counted + page_size - 1) // page_size if counted else 0
    return PaginationMeta(
        page=page,
        limit=safe_limit,
        total=counted,
        total_pages=total_pages,
    )


def paginate_query(query, *, skip: int, limit: int, order_by: Any):
    total = query.order_by(None).count()
    clauses = order_by if isinstance(order_by, (list, tuple)) else (order_by,)
    rows = query.order_by(*clauses).offset(max(int(skip or 0), 0)).limit(limit).all()
    return rows, build_pagination(skip=skip, limit=limit, total=total)


def set_total_count_header(response: Response | None, total: int) -> None:
    if response is None:
        return
    response.headers["X-Total-Count"] = str(max(int(total or 0), 0))

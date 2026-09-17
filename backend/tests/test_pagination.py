from app.schemas import PaginationMeta
from app.services.pagination import build_pagination


def test_build_pagination_first_page():
    meta = build_pagination(skip=0, limit=10, total=145)
    assert meta.page == 1
    assert meta.limit == 10
    assert meta.total == 145
    assert meta.total_pages == 15
    payload = meta.model_dump(by_alias=True)
    assert payload["totalPages"] == 15
    assert payload["total"] == 145


def test_build_pagination_middle_page():
    meta = build_pagination(skip=20, limit=10, total=145)
    assert meta.page == 3
    assert meta.total_pages == 15


def test_build_pagination_empty():
    meta = build_pagination(skip=0, limit=10, total=0)
    assert meta.page == 1
    assert meta.total == 0
    assert meta.total_pages == 0


def test_pagination_meta_json_alias():
    meta = PaginationMeta(page=3, limit=10, total=145, total_pages=15)
    assert meta.model_dump(by_alias=True) == {
        "page": 3,
        "limit": 10,
        "total": 145,
        "totalPages": 15,
    }

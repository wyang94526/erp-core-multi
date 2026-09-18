# @author: Wendy Yang
# @date: 2026-09-19

"""ChromaDB RAG pipeline for ERP documentation and schema context.

Uses OpenAI embeddings when OPENAI_API_KEY is set; otherwise falls back to
keyword search over local knowledge markdown (still useful for demos).
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

from app.config import PROJECT_ROOT, get_settings

logger = logging.getLogger(__name__)

_COLLECTION = "erp_knowledge"


def _chroma_dir() -> Path:
    settings = get_settings()
    path = Path(settings.ai_chroma_path)
    if not path.is_absolute():
        path = PROJECT_ROOT / path
    path.mkdir(parents=True, exist_ok=True)
    return path


def _knowledge_dir() -> Path:
    settings = get_settings()
    path = Path(settings.ai_knowledge_path)
    if not path.is_absolute():
        path = PROJECT_ROOT / path
    return path


def _load_documents() -> list[tuple[str, str]]:
    docs: list[tuple[str, str]] = []
    knowledge = _knowledge_dir()
    if knowledge.exists():
        for path in sorted(knowledge.glob("*.md")):
            docs.append((path.stem, path.read_text(encoding="utf-8")))

    schema = PROJECT_ROOT / "init-scripts" / "01-schema.sql"
    if schema.exists():
        text = schema.read_text(encoding="utf-8")
        chunk_size = 3500
        for i in range(0, len(text), chunk_size):
            docs.append((f"schema_{i // chunk_size}", text[i : i + chunk_size]))
    return docs


def _split_text(text: str, chunk_size: int = 1200, overlap: int = 150) -> list[str]:
    if len(text) <= chunk_size:
        return [text]
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(len(text), start + chunk_size)
        chunks.append(text[start:end])
        if end >= len(text):
            break
        start = max(0, end - overlap)
    return chunks


def _keyword_search(query: str, k: int = 4) -> list[dict]:
    tokens = [t for t in re.findall(r"[a-z0-9_]+", query.lower()) if len(t) > 2]
    scored: list[tuple[int, str, str]] = []
    for source, text in _load_documents():
        for i, chunk in enumerate(_split_text(text)):
            lower = chunk.lower()
            score = sum(lower.count(tok) for tok in tokens)
            if score:
                scored.append((score, f"{source}-{i}", chunk))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [{"source": sid, "content": content} for _, sid, content in scored[:k]]


def get_vectorstore():
    from langchain_community.vectorstores import Chroma
    from langchain_openai import OpenAIEmbeddings

    settings = get_settings()
    embeddings = OpenAIEmbeddings(
        api_key=settings.openai_api_key,
        model=settings.openai_embedding_model,
    )
    return Chroma(
        collection_name=_COLLECTION,
        embedding_function=embeddings,
        persist_directory=str(_chroma_dir()),
    )


def ingest_knowledge(*, force: bool = False) -> int:
    """Embed ERP docs into Chroma when OpenAI is configured. Returns chunk count."""
    settings = get_settings()
    if not settings.openai_api_key:
        docs = _load_documents()
        return sum(len(_split_text(t)) for _, t in docs)

    from langchain_community.vectorstores import Chroma

    docs = _load_documents()
    if not docs:
        logger.warning("No AI knowledge documents found to ingest")
        return 0

    store = get_vectorstore()
    try:
        existing = store._collection.count()  # noqa: SLF001
    except Exception:
        existing = 0
    if existing > 0 and not force:
        return existing

    if force and existing > 0:
        try:
            store.delete_collection()
        except Exception:
            pass
        store = get_vectorstore()

    texts: list[str] = []
    metadatas: list[dict] = []
    ids: list[str] = []
    for doc_id, text in docs:
        for i, chunk in enumerate(_split_text(text)):
            texts.append(chunk)
            metadatas.append({"source": doc_id})
            ids.append(f"{doc_id}-{i}")

    if texts:
        store.add_texts(texts=texts, metadatas=metadatas, ids=ids)
        try:
            store.persist()
        except Exception:
            pass
    return len(texts)


def search_knowledge(query: str, k: int = 4) -> list[dict]:
    settings = get_settings()
    if not settings.openai_api_key:
        return _keyword_search(query, k=k)
    try:
        store = get_vectorstore()
        if store._collection.count() == 0:  # noqa: SLF001
            ingest_knowledge()
        results = store.similarity_search(query, k=k)
        return [
            {"source": d.metadata.get("source", "unknown"), "content": d.page_content}
            for d in results
        ]
    except Exception as exc:
        logger.exception("Vector RAG failed; falling back to keyword search")
        hits = _keyword_search(query, k=k)
        if not hits:
            return [{"source": "error", "content": f"Knowledge search unavailable: {exc}"}]
        return hits

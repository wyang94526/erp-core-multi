#!/usr/bin/env python3
# @author: Wendy Yang
# @date: 2026-09-19

"""Ingest ERP knowledge into ChromaDB for the AI assistant.

Usage (from repo root, with venv active):
    python backend/scripts/ingest_ai_knowledge.py
    python backend/scripts/ingest_ai_knowledge.py --force
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.ai.rag import ingest_knowledge  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest ERP AI knowledge base")
    parser.add_argument("--force", action="store_true", help="Rebuild vector store")
    args = parser.parse_args()
    count = ingest_knowledge(force=args.force)
    print(f"Ingested/available chunks: {count}")


if __name__ == "__main__":
    main()

# @author: Wendy Yang
# @date: 2026-09-19

"""Helpers for security-question answers (catalog lives in DB)."""

DEFAULT_SECURITY_QUESTION = "What is your favorite color?"
DEFAULT_SECURITY_ANSWER = "blue"


def normalize_security_answer(answer: str) -> str:
    return " ".join(answer.strip().lower().split())

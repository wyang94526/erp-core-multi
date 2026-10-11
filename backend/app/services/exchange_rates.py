# @author: Wendy Yang
# @date: 2026-10-11

"""Dated exchange rates. One quote currency unit converts to rate_to_base base units."""

from __future__ import annotations

from datetime import date
from decimal import Decimal, ROUND_HALF_UP

import requests
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models import Company, ExchangeRate


def normalize_currency(value: str) -> str:
    code = (value or "").strip().upper()
    if len(code) != 3 or not code.isalpha():
        raise HTTPException(status_code=400, detail="Currency must be a 3-letter code")
    return code


def pick_rate(
    base_currency: str,
    quote_currency: str,
    as_of: date,
    rows: list[tuple[date, Decimal]],
) -> Decimal:
    """Latest rate on or before as_of. Later rows do not change an earlier date."""
    base = normalize_currency(base_currency)
    quote = normalize_currency(quote_currency)
    if quote == base:
        return Decimal("1")
    eligible = [(effective, rate) for effective, rate in rows if effective <= as_of]
    if not eligible:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No exchange rate for {quote} on or before {as_of.isoformat()}",
        )
    eligible.sort(key=lambda item: item[0], reverse=True)
    return Decimal(eligible[0][1])


def rate_on(db: Session, company: Company, currency: str, as_of: date) -> Decimal:
    quote = normalize_currency(currency)
    base = normalize_currency(company.base_currency)
    if quote == base:
        return Decimal("1")
    stored = (
        db.query(ExchangeRate.effective_date, ExchangeRate.rate_to_base)
        .filter(
            ExchangeRate.company_id == company.id,
            ExchangeRate.quote_currency == quote,
            ExchangeRate.effective_date <= as_of,
        )
        .all()
    )
    return pick_rate(base, quote, as_of, [(row[0], Decimal(row[1])) for row in stored])


def base_amount(amount: Decimal, rate: Decimal) -> Decimal:
    return (Decimal(amount) * Decimal(rate)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def upsert_rate(
    db: Session,
    company: Company,
    quote_currency: str,
    rate: Decimal,
    effective_date: date,
    source: str,
) -> ExchangeRate:
    quote = normalize_currency(quote_currency)
    if quote == normalize_currency(company.base_currency):
        raise HTTPException(status_code=400, detail="The base currency does not need an exchange rate")
    if rate <= 0:
        raise HTTPException(status_code=400, detail="Exchange rate must be greater than zero")
    if source not in {"manual", "frankfurter"}:
        raise HTTPException(status_code=400, detail="Unknown exchange rate source")
    row = (
        db.query(ExchangeRate)
        .filter(
            ExchangeRate.company_id == company.id,
            ExchangeRate.quote_currency == quote,
            ExchangeRate.effective_date == effective_date,
        )
        .first()
    )
    if row is None:
        row = ExchangeRate(
            company_id=company.id,
            quote_currency=quote,
            rate_to_base=rate,
            effective_date=effective_date,
            source=source,
        )
        db.add(row)
    else:
        row.rate_to_base = rate
        row.source = source
    return row


def frankfurter_rates(base_currency: str, effective_date: date) -> dict[str, Decimal]:
    """Return quote -> rate_to_base using the public Frankfurter (ECB) feed."""
    base = normalize_currency(base_currency)
    url = f"https://api.frankfurter.app/{effective_date.isoformat()}"
    try:
        response = requests.get(url, params={"from": base}, timeout=20)
        response.raise_for_status()
        payload = response.json()
    except requests.RequestException as exc:
        raise HTTPException(
            status_code=502,
            detail="Could not refresh exchange rates from Frankfurter",
        ) from exc
    raw = payload.get("rates") or {}
    converted: dict[str, Decimal] = {}
    for code, per_base in raw.items():
        foreign_per_base = Decimal(str(per_base))
        if foreign_per_base <= 0:
            continue
        # Feed is "1 base = foreign_per_base quote". Store "1 quote = ? base".
        converted[normalize_currency(code)] = (Decimal("1") / foreign_per_base).quantize(Decimal("0.00000001"))
    if not converted:
        raise HTTPException(status_code=502, detail="Frankfurter returned no rates")
    return converted

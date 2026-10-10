#!/bin/sh
set -eu

cd /app/backend

python - <<'PY'
import os
import time

import psycopg

host = os.environ.get("POSTGRES_HOST", "localhost")
port = int(os.environ.get("POSTGRES_PORT", "5432"))
user = os.environ.get("POSTGRES_USER", "erp_admin")
password = os.environ.get("POSTGRES_PASSWORD", "")
dbname = os.environ.get("POSTGRES_DB", "erp_system")

for attempt in range(60):
    try:
        with psycopg.connect(
            host=host,
            port=port,
            user=user,
            password=password,
            dbname=dbname,
            connect_timeout=3,
        ):
            print("postgres is ready", flush=True)
            break
    except Exception as exc:
        print(f"waiting for postgres ({attempt + 1}/60): {exc}", flush=True)
        time.sleep(2)
else:
    raise SystemExit("postgres did not become ready")
PY

python - <<'PY'
import subprocess

from sqlalchemy import create_engine, text

from app.config import get_settings

settings = get_settings()
engine = create_engine(settings.database_url)
with engine.connect() as conn:
    exists = conn.execute(
        text(
            "SELECT 1 FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name = 'alembic_version'"
        )
    ).scalar()
if not exists:
    # init-scripts match the schema through 20260923_0041 (gl_account_balances).
    # Later revisions add columns the API models require; do not stamp head.
    print("No alembic_version table — stamping 20260923_0041 after init-scripts", flush=True)
    raise SystemExit(subprocess.call(["alembic", "stamp", "20260923_0041"]))
PY

alembic upgrade head
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'

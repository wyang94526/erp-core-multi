FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ backend/
COPY init-scripts/ init-scripts/
COPY backend/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh \
    && mkdir -p /data/chroma

ENV PYTHONUNBUFFERED=1 \
    AI_CHROMA_PATH=/data/chroma

WORKDIR /app/backend
EXPOSE 8000
ENTRYPOINT ["/docker-entrypoint.sh"]

FROM node:25-alpine AS frontend-builder
# Build-time API base URL (must be provided via --build-arg)
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
WORKDIR /app/frontend
#COPY frontend/package.json frontend/package-lock.json ./
COPY frontend .
RUN npm install
RUN npm ci
RUN npm run build

FROM python:3.12-slim AS backend
ENV PYTHONUNBUFFERED=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends net-tools procps tcpdump build-essential curl postgresql-client && rm -rf /var/lib/apt/lists/*
COPY backend /app/backend
WORKDIR /app/backend
RUN pip install --no-cache-dir uv && \
    uv pip install --system .
WORKDIR /app
COPY migrations /app/migrations
COPY config.yaml /app/config.yaml
COPY cloudflare-ban.txt /app/cloudflare-ban.txt
COPY --from=frontend-builder /app/frontend/out /app/frontend-static
ENV UVICORN_HOST=0.0.0.0
ENV UVICORN_PORT=8080
EXPOSE 8080
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8080"]

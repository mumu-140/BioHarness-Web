FROM node:22-slim AS frontend

WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    BIOHARNESS_WEB_STATIC_DIR=/app/static \
    BIOHARNESS_WEB_HOST=0.0.0.0 \
    BIOHARNESS_WEB_PORT=8080

WORKDIR /app
COPY pyproject.toml README.md ./
COPY backend ./backend
RUN python -m pip install --no-cache-dir .

COPY --from=frontend /src/frontend/dist ./static

EXPOSE 8080

CMD ["uvicorn", "bioharness_web.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8080"]

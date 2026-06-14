FROM node:22-slim AS frontend-build
WORKDIR /app
COPY package.json ./
COPY frontend/package.json frontend/
RUN npm install
COPY frontend/ frontend/
RUN npm run build -w frontend

FROM python:3.13-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

ENV PATH="/app/.venv/bin:$PATH"

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY backend/ backend/
RUN mkdir -p /app/cache
COPY --from=frontend-build /app/frontend/dist /app/static

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]

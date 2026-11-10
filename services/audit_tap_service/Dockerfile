# Dedicated SWRT Audit-Tap Microservice Dockerfile
# Pure Python 3.11 runtime (NO Node.js installed)
FROM python:3.11-slim-bookworm

WORKDIR /app

# Install uv for fast, reliable deterministic venv management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

# Create isolated Python virtual environment
RUN uv venv /opt/venv

# Install required quantitative, Merkle audit, OTel, and MCP dependencies into /opt/venv
RUN uv pip install --python /opt/venv/bin/python \
    numpy \
    scipy \
    pot \
    cvxpy \
    clarabel \
    duckdb \
    pyarrow \
    pydantic \
    fastmcp \
    httpx \
    opentelemetry-api

# Copy repository sources
COPY pyproject.toml ./
COPY services/ ./services/
COPY agents/ ./agents/
COPY tests/ ./tests/

# Unbuffered stdout logging ensures docker compose logs swrt-audit-tap streams in real time
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app
ENV AUDIT_TAP_PORT=4002
ENV SWRT_VAULT_DIR=/app/audit_vault

EXPOSE 4002

CMD ["/opt/venv/bin/python", "-m", "services.audit_tap_service.server"]

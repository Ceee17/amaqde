# ============================================================================
# IDX SWRT Engine — Unified Python 3.12 Quant Kernel + Next.js 14 Dockerfile
# ============================================================================
FROM python:3.12-slim-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SWRT_REPO_ROOT=/app \
    PYTHON_BIN=/opt/venv/bin/python \
    PATH="/opt/venv/bin:$PATH"

# Install system dependencies + Node.js 20 LTS
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    gnupg \
    build-essential \
    libgomp1 \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1. Install Python 3.12 quantitative environment into /opt/venv
COPY pyproject.toml ./
RUN python -m venv /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir --upgrade pip && \
    /opt/venv/bin/pip install --no-cache-dir \
      "numpy>=2.0.0,<2.3.0" \
      "scipy>=1.13.0,<1.16.0" \
      "pot==0.9.4" \
      "cvxpy>=1.5.0,<1.6.0" \
      "clarabel>=0.9.0" \
      "duckdb>=1.1.0" \
      "pyarrow>=17.0.0" \
      "pydantic>=2.9.0" \
      "fastmcp>=0.4.0" \
      "httpx>=0.27.0" \
      "pytest>=8.3.0"

# 2. Install Next.js frontend dependencies
COPY frontend/package.json frontend/package-lock.json* ./frontend/
RUN cd /app/frontend && npm install

# 3. Copy full repository (services, agents, frontend, rules, skills)
COPY services ./services
COPY agents ./agents
COPY tests ./tests
COPY .agents ./.agents
COPY AGENTS.md mcp_config.json Makefile ./
COPY frontend ./frontend
COPY docker-entrypoint.sh /app/docker-entrypoint.sh

RUN sed -i 's/\r$//' /app/docker-entrypoint.sh && \
    chmod +x /app/docker-entrypoint.sh && \
    cd /app/frontend && npm run build

EXPOSE 3000

ENTRYPOINT ["/app/docker-entrypoint.sh"]

.PHONY: setup test run-pipeline frontend-dev frontend-build docker-up docker-down docker-logs docker-logs-ui docker-logs-tap docker-logs-rust

setup:
	uv sync --python 3.12

test:
	uv run pytest tests/test_swrt_pipeline.py -v

run-pipeline:
	uv run python -m agents.agent_exe_unifier --run-all-regimes

frontend-dev:
	cd frontend && npm run dev

frontend-build:
	cd frontend && npm run build

docker-up:
	docker compose up --build -d

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f

docker-logs-ui:
	docker compose logs -f swrt-web-ui

docker-logs-tap:
	docker compose logs -f swrt-audit-tap

docker-logs-rust:
	docker compose logs -f swrt-rust-kernel

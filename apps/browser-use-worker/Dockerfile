FROM python:3.12-slim-bookworm

COPY --from=ghcr.io/astral-sh/uv:0.12.17 /uv /uvx /bin/
ENV VIRTUAL_ENV=/opt/browser-use-venv \
    PATH="/opt/browser-use-venv/bin:${PATH}" \
    PLAYWRIGHT_BROWSERS_PATH=/opt/browser-use-browsers \
    ANONYMIZED_TELEMETRY=false \
    BROWSER_USE_DISABLE_EXTENSIONS=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN uv venv /opt/browser-use-venv \
    && uv pip install --python /opt/browser-use-venv/bin/python browser-use==0.13.10 \
    && /opt/browser-use-venv/bin/browser-use install \
    && useradd --system --uid 10001 --create-home browseruse \
    && mkdir -p /screenshots /opt/browser-use-browsers \
    && chown -R browseruse:browseruse /screenshots /opt/browser-use-browsers /home/browseruse

ENV BROWSER_USE_CLOUD_SYNC=false BROWSER_USE_SETUP_LOGGING=false BROWSER_USE_LOGGING_LEVEL=error
WORKDIR /app
COPY apps/browser-use-worker/worker.py /app/worker.py
USER browseruse
CMD ["python", "/app/worker.py"]

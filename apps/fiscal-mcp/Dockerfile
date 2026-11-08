FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY apps/fiscal-mcp/requirements.lock.txt ./
RUN pip install --no-cache-dir --require-hashes -r requirements.lock.txt
COPY apps/fiscal-mcp/pyproject.toml apps/fiscal-mcp/README.md apps/fiscal-mcp/LICENSE ./
COPY apps/fiscal-mcp/src ./src
RUN pip install --no-cache-dir --no-deps . && useradd --system --uid 10002 fiscal
USER 10002
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8093/health', timeout=3)"
CMD ["mcp-fiscal-brasil", "--transport", "http", "--host", "127.0.0.1", "--port", "8093"]

FROM python:3.13-slim-bookworm@sha256:a5a7017efc5969e00ae2b91c8eb0631049a569652aa4ffc4501769049ae45c72 AS build
WORKDIR /build
RUN python -m pip install --no-cache-dir uv==0.12.24
COPY apps/contract-signature-validator/pyproject.toml apps/contract-signature-validator/uv.lock apps/contract-signature-validator/README.md /build/apps/contract-signature-validator/
COPY apps/contract-signature-validator/src/ /build/apps/contract-signature-validator/src/
COPY apps/contract-signature-service/pyproject.toml apps/contract-signature-service/uv.lock apps/contract-signature-service/README.md /build/apps/contract-signature-service/
COPY apps/contract-signature-service/src/ /build/apps/contract-signature-service/src/
RUN uv sync --frozen --no-dev --no-editable --project apps/contract-signature-service --python /usr/local/bin/python

FROM python:3.13-slim-bookworm@sha256:a5a7017efc5969e00ae2b91c8eb0631049a569652aa4ffc4501769049ae45c72
COPY --from=build /build/apps/contract-signature-service/.venv /opt/validator
RUN groupadd --gid 10001 validator \
    && useradd --uid 10001 --gid 10001 --no-create-home gateway \
    && useradd --uid 10002 --gid 10001 --no-create-home worker \
    && install -d -o 10002 -g 10001 -m 0750 /run/validator /config/public \
    && install -d -o 10001 -g 10001 -m 0500 /run/secrets/validator
ENV PATH="/opt/validator/bin:/usr/local/bin:/usr/bin:/bin" PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
USER 10001:10001
ENTRYPOINT ["/opt/validator/bin/python", "-I", "-m", "contract_signature_service"]
CMD ["gateway"]

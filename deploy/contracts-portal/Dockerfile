FROM docuseal/docuseal@sha256:28d0ca583860e2c73e5b068756023a93a325799a22da1f788355d566865dd051
# Upstream remains 3.3.3. Adds our authenticated model-publication API;
# original attribution and signing behavior remain. Build only in GitHub CI.
COPY overlay/ /app/
COPY avila-source.tar.gz /app/public/avila-source.tar.gz
ARG RELEASE_SHA
LABEL org.opencontainers.image.title="Ávila Ops Contratos" \
      org.opencontainers.image.revision="${RELEASE_SHA}" \
      org.opencontainers.image.source="https://github.com/avilaops/erp-next/tree/main/deploy/contracts-portal"

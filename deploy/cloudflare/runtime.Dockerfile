# Both arguments must be immutable validated ghcr.io/avilaops image digests.
ARG API_IMAGE
ARG WEB_IMAGE
FROM ${WEB_IMAGE} AS web
FROM ${API_IMAGE}
USER root
# The API image uses Debian trixie; the Node binary from bookworm runs on its
# newer glibc. Keep the API's existing native TLS/ICP-Brasil dependencies.
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 && rm -rf /var/lib/apt/lists/*
COPY --from=web /usr/local/bin/node /usr/local/bin/node
COPY --from=web --chown=10001:10001 /app/ /app/
COPY --chown=10001:10001 deploy/cloudflare/runtime-supervisor.mjs deploy/cloudflare/runtime-configuration.mjs /app/runtime/
ARG RELEASE_SHA
LABEL org.opencontainers.image.title="ERP Next native Cloudflare runtime" \
      org.opencontainers.image.revision="${RELEASE_SHA}" \
      org.opencontainers.image.source="https://github.com/avilaops/erp-next"
WORKDIR /app
USER 10001
ENV API_BIND_ADDRESS=127.0.0.1:8080 PORT=3000 HOSTNAME=0.0.0.0 NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=45s CMD /usr/local/bin/node -e "Promise.all([fetch('http://127.0.0.1:8080/health/ready'),fetch('http://127.0.0.1:3000/entrar')]).then(rs=>process.exit(rs.every(r=>r.ok)?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/local/bin/node", "/app/runtime/runtime-supervisor.mjs"]
CMD []

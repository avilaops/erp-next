FROM debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libssl3t64 curl && rm -rf /var/lib/apt/lists/* && useradd --system --uid 10001 erp
COPY target/release/erp-next-api /usr/local/bin/erp-next-api
USER 10001
ENV API_BIND_ADDRESS=0.0.0.0:8080
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s CMD curl --fail --silent http://127.0.0.1:8080/health/ready || exit 1
ENTRYPOINT ["/usr/local/bin/erp-next-api"]

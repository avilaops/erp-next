#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly ROOT=/mnt/HC_Volume_106542212/erp-next
readonly APPLICATION=erp-next

fail() { printf '%s\n' "$*" >&2; exit 1; }

[[ $# == 0 ]] || fail 'invalid dispatcher arguments'
original_command=${SSH_ORIGINAL_COMMAND:-}
[[ "$original_command" =~ ^deploy\ erp-next\ ([0-9a-f]{40})$ ]] || fail 'invalid deploy command'
source_sha=${BASH_REMATCH[1]}
[[ $EUID == 0 ]] || fail 'dispatcher requires root'

exec 9>"$ROOT/.deploy.lock"
flock -n 9 || fail 'another ERP deployment is running'

previous_release=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' erp-next-web-1)
[[ "$previous_release" == "$ROOT/releases/"* ]] || fail 'active release is not managed by this dispatcher'

staging=$(mktemp -d "$ROOT/.incoming.XXXXXX")
release="$ROOT/releases/$source_sha"
cleanup() { rm -rf -- "$staging"; }
trap cleanup EXIT

# Extract the complete stream first, then enforce the allow-list below. GNU tar
# does not reliably match the selected names when the sender emits ./ prefixes.
tar --extract --gzip --no-same-owner --directory "$staging" --file -

for file in api-image.tar.gz web-image.tar.gz fiscal-image.tar.gz compose.yaml fiscal-compose.yaml; do
  [[ -s "$staging/$file" ]] || fail "missing artifact: $file"
done
[[ ! -e "$release" ]] || fail 'release already exists'

for image in api web fiscal; do
  docker load --input "$staging/$image-image.tar.gz" >/dev/null
  docker image inspect "erp-next-$image:sha-$source_sha" >/dev/null || fail "image not loaded: $image"
done

mkdir -m 700 "$release"

if [[ -f "$previous_release/compose.json" ]]; then
  # Current production still uses a generated, self-contained Compose JSON.
  # Keep its private runtime configuration on the server and replace only the
  # three immutable image references.
  cp -p "$previous_release/compose.json" "$release/compose.json"
  # The generated JSON carries the public release marker in the web
  # environment; update it together with the immutable image references.
  sed -i "s|\"ERP_RELEASE_SHA\": \"[0-9a-f]*\"|\"ERP_RELEASE_SHA\": \"$source_sha\"|g" "$release/compose.json"
  previous_api=$(docker inspect --format '{{.Config.Image}}' erp-next-api-1)
  previous_web=$(docker inspect --format '{{.Config.Image}}' erp-next-web-1)
  previous_fiscal=$(docker inspect --format '{{.Config.Image}}' erp-next-fiscal-engine-1)
  for pair in \
    "$previous_api|erp-next-api:sha-$source_sha" \
    "$previous_web|erp-next-web:sha-$source_sha" \
    "$previous_fiscal|erp-next-fiscal:sha-$source_sha"; do
    old=${pair%%|*}
    new=${pair#*|}
    escaped_old=$(printf '%s' "$old" | sed 's/[.[\*^$()+?{|\\]/\\&/g')
    sed -i "s|$escaped_old|$new|g" "$release/compose.json"
  done
  grep -q "erp-next-api:sha-$source_sha" "$release/compose.json" || fail 'API image was not pinned'
  grep -q "erp-next-web:sha-$source_sha" "$release/compose.json" || fail 'web image was not pinned'
  grep -q "erp-next-fiscal:sha-$source_sha" "$release/compose.json" || fail 'fiscal image was not pinned'
  grep -q "\\\"ERP_RELEASE_SHA\\\": \\\"$source_sha\\\"" "$release/compose.json" || fail 'release SHA was not pinned'
  compose_file=compose.json
  compose_env_args=()
else
  [[ -f "$previous_release/compose.yaml" && -f "$previous_release/api.env" && -f "$previous_release/web.env" && -f "$previous_release/.env" ]] || fail 'active release has an unknown layout'
  cp -p "$staging/compose.yaml" "$staging/fiscal-compose.yaml" "$release/"
  cp -p "$previous_release/api.env" "$previous_release/web.env" "$previous_release/.env" "$release/"
  chmod 600 "$release/api.env" "$release/web.env" "$release/.env"
  sed -i \
    -e "s|^ERP_API_IMAGE=.*|ERP_API_IMAGE=erp-next-api:sha-$source_sha|" \
    -e "s|^ERP_WEB_IMAGE=.*|ERP_WEB_IMAGE=erp-next-web:sha-$source_sha|" \
    -e "s|^ERP_FISCAL_ENGINE_IMAGE=.*|ERP_FISCAL_ENGINE_IMAGE=erp-next-fiscal:sha-$source_sha|" \
    -e "s|^ERP_RELEASE_SHA=.*|ERP_RELEASE_SHA=$source_sha|" \
    "$release/.env"
  grep -q "^ERP_API_IMAGE=erp-next-api:sha-$source_sha$" "$release/.env" || fail 'API image was not pinned'
  grep -q "^ERP_WEB_IMAGE=erp-next-web:sha-$source_sha$" "$release/.env" || fail 'web image was not pinned'
  grep -q "^ERP_RELEASE_SHA=$source_sha$" "$release/.env" || fail 'release SHA was not pinned'
  compose_file=compose.yaml
  compose_env_args=(--env-file "$release/.env")
fi

compose() {
  docker compose --project-name "$APPLICATION" --project-directory "$1" \
    "${compose_env_args[@]}" --file "$1/$compose_file" "${@:2}"
}

rollback() {
  local status=$?
  trap - EXIT
  printf '%s\n' 'ERP deploy failed; restoring previous release' >&2
  if [[ -f "$previous_release/compose.json" ]]; then
    docker compose --project-name "$APPLICATION" --project-directory "$previous_release" \
      --file "$previous_release/compose.json" up --detach --no-build --wait --wait-timeout 120 || true
  else
    docker compose --project-name "$APPLICATION" --project-directory "$previous_release" \
      --env-file "$previous_release/.env" --file "$previous_release/compose.yaml" \
      --file "$previous_release/fiscal-compose.yaml" up --detach --no-build --wait --wait-timeout 120 || true
  fi
  exit "$status"
}

trap rollback ERR
compose "$release" config --quiet
compose "$release" up --detach --no-build --wait --wait-timeout 120

curl --fail --silent --show-error --connect-timeout 5 --max-time 15 \
  http://127.0.0.1:3141/health/ready >/dev/null

python3 - "$source_sha" <<'PY'
import json
import sys
import urllib.request

expected = sys.argv[1]
with urllib.request.urlopen("http://127.0.0.1:3140/api/health", timeout=10) as response:
    health = json.load(response)
if health.get("commit") != expected or health.get("ok") is not True:
    raise SystemExit("ERP health does not match the requested release")
for path in ("/entrar", "/erp-preview.webp"):
    with urllib.request.urlopen("http://127.0.0.1:3140" + path, timeout=10) as response:
        if response.status != 200:
            raise SystemExit(f"ERP public path failed: {path}")
print(json.dumps({"application": health.get("application"), "commit": health.get("commit")}))
PY

trap - EXIT
printf 'ERP deploy completed: %s\n' "$source_sha"



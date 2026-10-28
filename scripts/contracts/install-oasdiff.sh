#!/usr/bin/env bash
set -euo pipefail
destination="${RUNNER_TEMP:?}/erp-oasdiff-1.34.1"
mkdir -p "$destination"
curl --fail --silent --show-error --location --retry 3 \
  https://github.com/oasdiff/oasdiff/releases/download/v1.34.1/oasdiff_1.34.1_linux_amd64.tar.gz \
  --output "$destination/oasdiff.tar.gz"
printf '%s\n' "75775f65b0adebd26a8e013af51a799342dfdc6262d89efa9e3b7bdf89657d90  $destination/oasdiff.tar.gz" | sha256sum --check
tar -xzf "$destination/oasdiff.tar.gz" -C "$destination" oasdiff
echo "OASDIFF_BIN=$destination/oasdiff" >> "$GITHUB_ENV"

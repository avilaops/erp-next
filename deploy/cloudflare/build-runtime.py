#!/usr/bin/env python3
"""Plan/build the native runtime from an existing exact-source release manifest."""
import argparse
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location('erp_release_manifest', ROOT / 'deploy/release-retention.py')
_release = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_release)
CONTEXT_FILES = (
    'deploy/cloudflare/runtime.Dockerfile',
    'deploy/cloudflare/runtime-supervisor.mjs',
    'deploy/cloudflare/runtime-configuration.mjs',
)


def build_runtime(release, source_sha, repository=ROOT, *, execute=False, run=subprocess.run):
    value = _release.validate_manifest(release, source_sha)
    files = {}
    for path in CONTEXT_FILES:
        try:
            result = run(['git', 'show', source_sha + ':' + path], cwd=repository,
                         capture_output=True, timeout=30, check=False)
            if result.returncode or not result.stdout or len(result.stdout) > 128 * 1024:
                raise ValueError('Exact reviewed runtime source is unavailable')
            files[path] = result.stdout
        except (OSError, subprocess.SubprocessError):
            raise ValueError('Cannot read the exact reviewed runtime source') from None
    image = 'erp-next-runtime:sha-' + source_sha
    proof = {'schema': 'erp-native-runtime-build/1', 'applicationSourceSha': source_sha,
             'apiImage': value['images']['api'], 'webImage': value['images']['web'],
             'image': image, 'contextFiles': list(CONTEXT_FILES),
             'built': False, 'published': False, 'activated': False}
    if not execute:
        return proof
    # No checkout-wide Docker context: only these three immutable Git blobs.
    # This excludes private/untracked PDFs, credentials, backups and test data.
    with tempfile.TemporaryDirectory(prefix='erp-runtime-context-') as directory:
        context = Path(directory).resolve()
        if context.parent != Path(tempfile.gettempdir()).resolve():
            raise ValueError('Unexpected temporary build context')
        for path, content in files.items():
            target = context / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
        command = ['docker', 'build', '-f', str(context / CONTEXT_FILES[0]),
                   '--build-arg', 'API_IMAGE=' + value['images']['api'],
                   '--build-arg', 'WEB_IMAGE=' + value['images']['web'],
                   '--build-arg', 'RELEASE_SHA=' + source_sha, '-t', image, str(context)]
        try:
            result = run(command, capture_output=True, timeout=900, check=False)
        except (OSError, subprocess.SubprocessError):
            raise ValueError('Native runtime image build failed; nothing was published') from None
        if result.returncode:
            raise ValueError('Native runtime image build failed; nothing was published')
    proof['built'] = True
    return proof


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release-json', type=Path, required=True)
    parser.add_argument('--source-sha', required=True)
    parser.add_argument('--build', action='store_true', help='Build locally; never push or activate')
    args = parser.parse_args()
    try:
        if args.release_json.stat().st_size > 16384:
            raise ValueError('Invalid release manifest size')
        value = json.loads(args.release_json.read_text(encoding='utf-8'))
        print(json.dumps(build_runtime(value, args.source_sha, execute=args.build)))
        return 0
    except (OSError, ValueError):
        print('Native runtime preparation failed; check the reviewed source and release manifest', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())

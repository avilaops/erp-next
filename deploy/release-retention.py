#!/usr/bin/env python3
"""Bound ERP release storage without touching volumes or another application's images."""
import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import time

ROOT = Path('/mnt/HC_Volume_106542212/erp-next')
COMPONENTS = ('api', 'web', 'fiscal', 'fiscal-mcp')
SHA = re.compile(r'[a-f0-9]{40}')
REGISTRY = 'ghcr.io/avilaops/erp-next-'


def validate_manifest(value, expected_sha):
    if (not SHA.fullmatch(expected_sha) or not isinstance(value, dict)
            or set(value) != {'schema', 'sourceSha', 'images'}
            or value['schema'] != 'erp-release/1' or value['sourceSha'] != expected_sha
            or not isinstance(value['images'], dict) or set(value['images']) != set(COMPONENTS)):
        raise ValueError('Invalid release manifest identity or components')
    for component, image in value['images'].items():
        if not isinstance(image, str) or not re.fullmatch(re.escape(REGISTRY + component) + r'@sha256:[a-f0-9]{64}', image):
            raise ValueError('Image must belong to the ERP registry and be pinned by digest')
    return value


def owned_reference(reference):
    return isinstance(reference, str) and any(
        re.fullmatch(re.escape(REGISTRY + component) + r'(?:@sha256:[a-f0-9]{64}|:[a-zA-Z0-9_.-]+)', reference)
        or re.fullmatch(re.escape('erp-next-' + component) + r':sha-[a-f0-9]{40}', reference)
        for component in COMPONENTS
    )


def managed_images(directory):
    manifest = directory / 'release.json'
    if manifest.is_file() and not manifest.is_symlink():
        return list(validate_manifest(json.loads(manifest.read_text()), directory.name)['images'].values())
    # Compatibility with releases produced before registry manifests existed.
    compose = directory / 'compose.json'
    if compose.is_file() and not compose.is_symlink():
        services = json.loads(compose.read_text()).get('services', {})
        refs = [service.get('image') for service in services.values()]
        return [ref for ref in refs if owned_reference(ref)]
    env = directory / '.env'
    if (directory / 'compose.yaml').is_file() and env.is_file() and not env.is_symlink():
        return [line.split('=', 1)[1].strip() for line in env.read_text().splitlines()
                if re.match(r'^ERP_(?:API|WEB|FISCAL_ENGINE|FISCAL_MCP)_IMAGE=', line)
                and owned_reference(line.split('=', 1)[1].strip())]
    return []


def directory_plan(root, active, rollback):
    root = Path(root).resolve()
    releases = root / 'releases'
    if releases.is_symlink() or releases.resolve() != releases or not releases.is_dir():
        raise ValueError('Invalid releases directory')
    for sha in (active, rollback):
        directory = releases / sha
        if not SHA.fullmatch(sha) or directory.is_symlink() or not directory.is_dir() or not managed_images(directory):
            raise ValueError('Protected release is missing or has no managed image references')
    result = []
    for directory in sorted(releases.iterdir()):
        if directory.name in {active, rollback} or not SHA.fullmatch(directory.name) or directory.is_symlink() or not directory.is_dir():
            continue
        if managed_images(directory):
            result.append(directory)
    return result


def image_candidates(images, protected_ids):
    result = []
    for image in images:
        refs = (image.get('RepoTags') or []) + (image.get('RepoDigests') or [])
        if image['Id'] not in protected_ids and refs and all(owned_reference(ref) for ref in refs):
            result.append(image['Id'])
    return sorted(set(result))


def snapshot_plan(root, active, rollback):
    private = root / 'private'
    if not private.exists():
        return []
    if private.is_symlink() or private.resolve() != private:
        raise ValueError('Invalid technical snapshot directory')
    result, failed = [], []
    allowed = {'ledger-before.json', 'ledger-after.json', 'schema-before.sql', 'ledger-before.sql',
               'migration.log', 'verification.json', 'image-check.log', 'database-check.log',
               'ledger-before.log', 'ledger-after.log', 'schema-backup.log', 'ledger-backup.log',
               'postgres-user.log', 'grant-fiscal-monitor.log', 'grant-cte-distribution.log'}
    for directory in private.iterdir():
        if not re.fullmatch(r'migration-[a-f0-9]{40}', directory.name) or directory.is_symlink() or not directory.is_dir():
            continue
        if directory.name[10:] in {active, rollback}:
            continue
        if any(p.name not in allowed or p.is_symlink() or not p.is_file() for p in directory.iterdir()):
            continue
        proof = directory / 'verification.json'
        if proof.exists():
            if json.loads(proof.read_text()).get('sha') == directory.name[10:]:
                result.append(directory)
        else:
            failed.append(directory)
    # Keep the latest failed attempt's diagnostics in addition to the two releases.
    failed.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return result + failed[1:]


def staging_plan(root):
    allowed = {'release.json', 'compose.yaml', 'fiscal-compose.yaml', 'migrate-release.py',
               'release-retention.py', 'images.txt', 'api-image.tar.gz', 'web-image.tar.gz',
               'fiscal-image.tar.gz', 'fiscal-mcp-image.tar.gz', 'grant-fiscal-monitor.sql', 'grant-cte-distribution.sql'}
    result = []
    for directory in sorted(root.iterdir()):
        if not re.fullmatch(r'\.incoming\.[A-Za-z0-9]{6}', directory.name) or directory.is_symlink() or not directory.is_dir():
            continue
        if time.time() - directory.stat().st_mtime < 86400:
            continue
        if all(p.is_file() and not p.is_symlink() and p.name in allowed for p in directory.iterdir()):
            result.append(directory)
    return result


def cleanup(root, active, rollback, *, apply=False, run=subprocess.run):
    root = Path(root).resolve()
    directories = directory_plan(root, active, rollback)

    def docker(*args):
        return run(['docker', *args], check=True, capture_output=True, text=True).stdout.strip()

    # Protect every existing container, including stopped and foreign containers.
    containers = docker('container', 'ls', '--all', '--quiet').split()
    protected_ids = set()
    if containers:
        container_data = json.loads(docker('container', 'inspect', *containers))
        protected_ids.update(item['Image'] for item in container_data)
        protected_directories = {(item.get('Config', {}).get('Labels') or {}).get('com.docker.compose.project.working_dir') for item in container_data}
        directories = [p for p in directories if str(p) not in protected_directories]
    for sha in {active, rollback}:
        for reference in managed_images(root / 'releases' / sha):
            protected_ids.add(docker('image', 'inspect', '--format', '{{.Id}}', reference))
    ids = docker('image', 'ls', '--all', '--quiet', '--no-trunc').split()
    images = json.loads(docker('image', 'inspect', *sorted(set(ids)))) if ids else []
    candidates = image_candidates(images, protected_ids)
    snapshots = snapshot_plan(root, active, rollback)
    staging = staging_plan(root)
    report = {'active': active, 'rollback': rollback, 'releases': [p.name for p in directories],
              'images': candidates, 'technicalSnapshots': [p.name for p in snapshots],
              'abandonedStaging': [p.name for p in staging], 'applied': apply}
    if apply:
        for image in images:
            if image['Id'] in candidates:
                # Remove only known ERP references, without forcing images in use.
                refs = sorted(set((image.get('RepoTags') or []) + (image.get('RepoDigests') or [])))
                for reference in refs:
                    # Removing a tag may automatically remove its same-repository
                    # digests. Inspect each remaining reference, rather than
                    # failing on the stale snapshot or forcing image removal.
                    present = run(['docker', 'image', 'inspect', '--format', '{{.Id}}', reference],
                                  check=False, capture_output=True, text=True)
                    if present.returncode:
                        if 'No such image' in present.stderr:
                            continue
                        present.check_returncode()
                    docker('image', 'rm', '--no-prune', reference)
        # Recheck paths immediately before deletion. Never traverse directory symlinks.
        for directory in directories + snapshots + staging:
            if directory.is_symlink() or directory.resolve() != directory:
                raise ValueError('Cleanup target changed')
            shutil.rmtree(directory)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('active')
    parser.add_argument('rollback', nargs='?')
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--manifest', type=Path)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if args.manifest:
        value = validate_manifest(json.loads(args.manifest.read_text()), args.active)
        for name in COMPONENTS:
            print(name + ' ' + value['images'][name])
    else:
        if not args.rollback:
            parser.error('Rollback revision is required')
        print(json.dumps(cleanup(args.root, args.active, args.rollback, apply=args.apply)))


if __name__ == '__main__':
    main()

"""Check the screen manual, route ownership, local links, and relocation audit.

Run `python scripts/docs/check.py`; add --audit-moves to verify the one-time move
against its base commit. No services or dependencies are required.
"""
from pathlib import Path
import argparse
import csv
import hashlib
import json
import re
import subprocess
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / 'docs'
LINK = re.compile(r'!?\[[^\]\n]*\]\(([^\s)]+)(?:[^)\n]*)\)')


def git(*args, data=None):
    return subprocess.check_output(['git', '-C', str(ROOT), *args], input=data)


def canonical(data):
    # Git stores LF; Windows checkouts may materialize CRLF.
    return data.replace(b'\r\n', b'\n')


def local_target(source, href):
    href = href.strip('<>')
    parsed = urlsplit(href)
    if parsed.scheme or href.startswith(('/', '#')) or not parsed.path:
        return None
    return ((ROOT / source).parent / unquote(parsed.path)).resolve()


def baseline_files(commit):
    paths = [p for p in git('ls-tree', '-r', '--name-only', '-z', commit).decode('utf-8').split('\0')
             if p.endswith(('.md', '.mdx'))]
    payload = ''.join(f'{commit}:{p}\n' for p in paths).encode('utf-8')
    process = subprocess.run(['git', '-C', str(ROOT), 'cat-file', '--batch'], input=payload,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    data, offset, results = process.stdout, 0, {}
    for path in paths:
        end = data.index(b'\n', offset)
        header = data[offset:end].split()
        if len(header) != 3 or header[1] != b'blob':
            raise ValueError(f'Cannot read baseline document: {path}')
        size = int(header[2])
        results[path] = data[end + 1:end + 1 + size]
        offset = end + size + 2
    return results


def broken_links(path, text):
    for match in LINK.finditer(text):
        target = local_target(path, match[1])
        if target is not None and not target.exists():
            yield match[1], target


def check(audit=False):
    errors = []
    manifest = json.loads((DOCS / 'tecnica/movimentacoes.json').read_text(encoding='utf-8'))
    moves = {item['previous']: item['current'] for item in manifest['files']}
    reverse = {new: old for old, new in moves.items()}
    guides = sorted(DOCS.glob('telas/*/*/README.md'))
    rows = list(csv.DictReader((DOCS / 'tecnica/mapa-telas.csv').open(encoding='utf-8', newline='')))
    routes = {}
    for page in (ROOT / 'apps/web/src/app').rglob('page.tsx'):
        part = page.parent.relative_to(ROOT / 'apps/web/src/app').as_posix()
        routes['/' + part if part != '.' else '/'] = page.relative_to(ROOT).as_posix()
    if len({row['rota'] for row in rows}) != len(rows):
        errors.append('Duplicate routes in mapa-telas.csv')
    if {row['rota'] for row in rows} != set(routes):
        errors.append('Route map does not match the current page.tsx files')
    for row in rows:
        if row['fonte'] != routes.get(row['rota']):
            errors.append(f"Wrong page source: {row['rota']}")
        if not (ROOT / row['guia']).is_file():
            errors.append(f"Missing screen guide: {row['guia']}")
    for guide in guides:
        text = guide.read_text(encoding='utf-8')
        for section in ['**Onde acessar:**', '## Regras e limites', '## Referências para manutenção']:
            if section not in text:
                errors.append(f'Missing {section}: {guide.relative_to(ROOT)}')
        access = re.search(r'^\*\*Onde acessar:\*\*(.*)$', text, re.MULTILINE)
        if access:
            for route in re.findall(r'`(/[^`]*)`', access[1]):
                route = route.replace('{id}', '[id]').split('#', 1)[0].split('?', 1)[0]
                matches = any(re.fullmatch('/'.join('[^/]+' if segment.startswith('[') else re.escape(segment)
                                                   for segment in pattern.split('/')), route)
                              for pattern in routes)
                if not matches:
                    errors.append(f'Nonexistent screen address: {guide.relative_to(ROOT)} -> {route}')

    # Historical missing links are compared to their old resolved destinations.
    # New screen guides never inherit an allowance from an old document.
    base = baseline_files(manifest['baseCommit'])
    old_missing = set()
    base_paths = set(git('ls-tree', '-r', '--name-only', '-z', manifest['baseCommit']).decode('utf-8').split('\0'))
    for source, content in base.items():
        for match in LINK.finditer(content.decode('utf-8-sig')):
            target = local_target(source, match[1])
            if target is None or not target.is_relative_to(ROOT):
                continue
            rel = target.relative_to(ROOT).as_posix()
            exists_at_base = rel in base_paths or any(p.startswith(rel.rstrip('/') + '/') for p in base_paths)
            if not exists_at_base:
                old_missing.add((source, rel))

    candidates = [p for p in git('ls-files', '--cached', '--others', '--exclude-standard', '-z').decode('utf-8').split('\0')
                  if p.endswith(('.md', '.mdx')) and (ROOT / p).is_file()]
    inherited = []
    link_count = 0
    for source in candidates:
        text = (ROOT / source).read_text(encoding='utf-8-sig')
        link_count += len(LINK.findall(text))
        for href, target in broken_links(source, text):
            rel = target.relative_to(ROOT).as_posix() if target.is_relative_to(ROOT) else str(target)
            identity = (reverse.get(source, source), reverse.get(rel, rel))
            if identity in old_missing and not source.startswith('docs/telas/'):
                inherited.append((source, href))
            elif identity in old_missing and '/referencias/' in source:
                inherited.append((source, href))
            else:
                errors.append(f'Broken link: {source} -> {href}')

    # Contract sources are executable consumers, not just Markdown links.
    catalogue = json.loads((ROOT / 'verification/contracts.json').read_text(encoding='utf-8'))
    def walk(value):
        if isinstance(value, dict):
            for item in value.values():
                walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)
        elif isinstance(value, str) and value.startswith('docs/') and not (ROOT / value).is_file():
            errors.append(f'Missing contract source: {value}')
    walk(catalogue)

    if audit:
        for item in manifest['files']:
            new = ROOT / item['current']
            original = git('show', f"{manifest['baseCommit']}:{item['previous']}")
            if hashlib.sha256(canonical(original)).hexdigest() != item['originalSha256']:
                errors.append(f"Original hash mismatch: {item['previous']}")
            if not new.is_file():
                errors.append(f"Relocated file missing: {item['current']}")
                continue
            current = new.read_bytes()
            if hashlib.sha256(canonical(current)).hexdigest() != item['organizedSha256']:
                errors.append(f"Relocation hash mismatch: {item['current']}")
            if item['previous'].endswith(('.md', '.mdx')):
                a = original.decode('utf-8-sig').replace('\r\n', '\n')
                b = current.decode('utf-8-sig').replace('\r\n', '\n')
                # Only path changes are authorized inside the old technical records.
                for old, dest in sorted(moves.items(), key=lambda pair: -len(pair[0])):
                    a = a.replace(old, dest)
                a = LINK.sub('[link]', a)
                b = LINK.sub('[link]', b)
                if a != b:
                    errors.append(f"Content changed beyond links: {item['current']}")
            elif canonical(original) != canonical(current):
                errors.append(f"Non-Markdown original modified: {item['current']}")

    result = dict(screenGuides=len(guides), pageRoutes=len(rows), relocatedDocuments=len(moves),
                  linksChecked=link_count, preExistingBrokenLinks=len(inherited), errors=errors)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if errors else 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audit-moves', action='store_true')
    args = parser.parse_args()
    raise SystemExit(check(args.audit_moves))

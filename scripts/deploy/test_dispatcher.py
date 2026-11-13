"""Exercise the real dispatcher against isolated filesystem and Docker/HTTP fixtures."""
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile
import threading
import unittest

DEPLOY = Path(__file__).resolve().parents[2] / 'deploy'
A, B, C = ('a' * 40, 'b' * 40, 'c' * 40)
COMPONENTS = ('api', 'web', 'fiscal', 'fiscal-mcp')


def archive(files):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w:gz') as target:
        for name, content in files:
            entry = tarfile.TarInfo(name)
            entry.size = len(content)
            target.addfile(entry, io.BytesIO(content))
    return output.getvalue()


class ArchiveTests(unittest.TestCase):
    def test_traversal_duplicates_and_oversized_bundles_are_rejected(self):
        code = re.search(r"python3 -c '(\nimport os, sys, tarfile[\s\S]*?)\n' \"\$staging\"", (DEPLOY / 'production-deploy.sh').read_text())[1]
        names = ('release.json', 'compose.yaml', 'fiscal-compose.yaml', 'migrate-release.py', 'release-retention.py', 'grant-fiscal-monitor.sql', 'grant-cte-distribution.sql')
        valid = [(name, b'fixture') for name in names]
        for extra, expected in [([], 0), ([('../escape', b'x')], 1), ([('release.json', b'x')], 1), ([('unknown', b'x')], 1), ([('unknown', b'x' * 524289)], 1)]:
            with self.subTest(extra=[name for name, _ in extra]), tempfile.TemporaryDirectory() as directory:
                import sys
                result = subprocess.run([sys.executable, '-c', code, directory], input=archive(valid + extra), capture_output=True)
                self.assertEqual(result.returncode, expected, result.stderr)
                self.assertFalse((Path(directory).parent / 'escape').exists())


FAKE_DOCKER = r'''#!/usr/bin/env python3
import hashlib,json,os,sys
from pathlib import Path
p=Path(os.environ['FAKE_DOCKER_STATE']); s=json.loads(p.read_text()); a=sys.argv[1:]
def save():p.write_text(json.dumps(s))
def image(ref):return next((i for i in s['images'] if ref==i['Id'] or ref in i['RepoTags']+i['RepoDigests']),None)
def fail(message='No such image'):print(message,file=sys.stderr);raise SystemExit(1)
if a[0]=='inspect':
 if 'working_dir' in a[2]: print(s['root']+'/releases/'+s['active'])
 else:
  component={'erp-next-api-1':'api','erp-next-web-1':'web','erp-next-fiscal-engine-1':'fiscal'}[a[-1]]
  print('erp-next-'+component+':sha-'+s['active'])
elif a[0]=='pull':
 if s['failure']=='pull':fail('synthetic pull failure')
 if not image(a[1]):s['images'].append({'Id':'sha256:'+hashlib.sha256(a[1].encode()).hexdigest(),'RepoTags':[],'RepoDigests':[a[1]]})
 save()
elif a[0]=='tag':image(a[1])['RepoTags'].append(a[2]);save()
elif a[:2]==['image','inspect']:
 if '--format' in a:
  i=image(a[-1])
  if not i:fail()
  print(i['Id'])
 else:print(json.dumps([image(ref) for ref in a[2:] if image(ref)]))
elif a[:2]==['image','ls']:print('\n'.join(i['Id'] for i in s['images']))
elif a[:2]==['image','rm']:
 ref=a[-1];i=image(ref)
 if not i:fail()
 i['RepoTags']=[x for x in i['RepoTags'] if x!=ref];i['RepoDigests']=[x for x in i['RepoDigests'] if x!=ref]
 if not i['RepoTags'] and not i['RepoDigests']:s['images'].remove(i)
 save()
elif a[:2]==['container','ls']:print('api\nweb\nfiscal\nfiscal-mcp')
elif a[:2]==['container','inspect']:
 print(json.dumps([{'Image':image('erp-next-'+c+':sha-'+s['active'])['Id'],'Config':{'Labels':{'com.docker.compose.project.working_dir':s['root']+'/releases/'+s['active']}}} for c in ('api','web','fiscal','fiscal-mcp')]))
elif a[0]=='compose' and 'up' in a:
 sha=Path(a[a.index('--project-directory')+1]).name
 if s['failure']=='rollback' and sha!=s['candidate']:fail('synthetic rollback failure')
 s['active']=sha;save()
 if s['failure'] in ('activation','rollback') and sha==s['candidate']:fail('synthetic activation failure')
elif a[0]!='compose':fail('unexpected fixture command')
'''


@unittest.skipUnless(os.name == 'posix', 'Full dispatcher simulation runs on the Linux CI runner')
class DispatcherTests(unittest.TestCase):
    def scenario(self, failure='', prior_state=True):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            releases = root / 'releases'
            releases.mkdir()
            images = []
            for sha in (B, C):
                release = releases / sha
                release.mkdir()
                services = {}
                for component in COMPONENTS:
                    ref = 'erp-next-' + component + ':sha-' + sha
                    images.append({'Id': 'sha256:' + hashlib.sha256(ref.encode()).hexdigest(), 'RepoTags': [ref], 'RepoDigests': []})
                    name = 'fiscal-engine' if component == 'fiscal' else component
                    services[name] = {'image': ref, 'environment': {'ERP_RELEASE_SHA': sha, 'ERP_FISCAL_ENGINE_TOKEN': 'synthetic-private-token-1234567890'}, 'healthcheck': {}}
                (release / 'compose.json').write_text(json.dumps({'services': services}))
            if prior_state:
                (root / 'deployment-state.json').write_text(json.dumps({'active': B, 'rollback': C}))
            state_file = root / 'docker-state.json'
            state_file.write_text(json.dumps({'root': str(root), 'active': B, 'candidate': A, 'failure': failure, 'images': images}))
            class Handler(BaseHTTPRequestHandler):
                def log_message(self, *args): pass
                def do_GET(self):
                    state = json.loads(state_file.read_text())
                    body = json.dumps({'application': 'erp-next', 'commit': state['active'], 'ok': not (failure == 'health' and state['active'] == A)}).encode()
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(body)
            server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                binary = root / 'bin'
                binary.mkdir()
                (binary / 'docker').write_text(FAKE_DOCKER)
                (binary / 'docker').chmod(0o755)
                (binary / 'curl').write_text('#!/bin/sh\nexit 0\n')
                (binary / 'curl').chmod(0o755)
                code = (DEPLOY / 'production-deploy.sh').read_text()
                code = code.replace('readonly ROOT=/mnt/HC_Volume_106542212/erp-next', 'readonly ROOT=' + str(root))
                code = code.replace("[[ $EUID == 0 ]] || fail 'dispatcher requires root'", ': # root authentication is outside this isolated fixture')
                code = code.replace('http://127.0.0.1:3140', f'http://127.0.0.1:{server.server_port}')
                script = root / 'dispatcher.sh'
                script.write_text(code)
                manifest = {'schema': 'erp-release/1', 'sourceSha': A, 'images': {c: 'ghcr.io/avilaops/erp-next-' + c + '@sha256:' + hashlib.sha256(c.encode()).hexdigest() for c in COMPONENTS}}
                migrate = b'import os,sys\nsys.exit(1 if os.environ.get("FAKE_FAILURE")=="migration" else 0)\n'
                files = [('release.json', json.dumps(manifest).encode()), ('migrate-release.py', migrate),
                         ('release-retention.py', (DEPLOY / 'release-retention.py').read_bytes()),
                         ('compose.yaml', (DEPLOY / 'compose.yaml').read_bytes()), ('fiscal-compose.yaml', (DEPLOY / 'fiscal-compose.yaml').read_bytes()),
                         ('grant-fiscal-monitor.sql', (DEPLOY / 'grant-fiscal-monitor.sql').read_bytes()),
                         ('grant-cte-distribution.sql', (DEPLOY / 'grant-cte-distribution.sql').read_bytes())]
                environment = {**os.environ, 'PATH': str(binary) + os.pathsep + os.environ['PATH'], 'FAKE_DOCKER_STATE': str(state_file), 'FAKE_FAILURE': failure, 'SSH_ORIGINAL_COMMAND': 'deploy erp-next ' + A}
                result = subprocess.run(['bash', str(script)], input=archive(files), capture_output=True, env=environment, timeout=30)
                state = json.loads(state_file.read_text())
                self.assertEqual(list(root.glob('.incoming.*')), [], result.stderr.decode())
                if not failure:
                    self.assertEqual(result.returncode, 0, result.stderr.decode())
                    self.assertEqual(state['active'], A)
                    self.assertTrue((releases / A).exists())
                    self.assertTrue((releases / B).exists())
                    self.assertFalse((releases / C).exists())
                else:
                    self.assertNotEqual(result.returncode, 0)
                    self.assertEqual(state['active'], A if failure == 'rollback' else B)
                    self.assertTrue((releases / B).exists())
                    if not prior_state:
                        self.assertTrue((releases / C).exists(), 'First failed deploy must preserve previous rollback')
                    if failure == 'rollback':
                        self.assertTrue((releases / A).exists(), 'Partially active candidate must remain protected')
            finally:
                server.shutdown()
                server.server_close()
                thread.join()

    def test_success_retains_active_and_previous(self): self.scenario()
    def test_failed_pull_does_not_touch_running_services(self): self.scenario('pull')
    def test_failed_migration_does_not_activate_candidate(self): self.scenario('migration')
    def test_activation_failure_restores_previous_release(self): self.scenario('activation')
    def test_health_failure_restores_previous_release(self): self.scenario('health')
    def test_failed_rollback_protects_candidate_still_in_use(self): self.scenario('rollback')
    def test_first_failed_deploy_preserves_unconfirmed_previous_rollback(self): self.scenario('pull', prior_state=False)


if __name__ == '__main__': unittest.main()

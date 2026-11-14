#!/usr/bin/env python3
"""Verify built service artifacts and real restricted Linux containers, never deploy."""
import argparse
import base64
from dataclasses import replace
from datetime import datetime, timedelta, timezone
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import ssl
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from uuid import uuid4
import zipfile
import zipimport

ROOT = Path(__file__).resolve().parents[2]
TESTS = ROOT/'apps/contract-signature-service/tests'


def verify_archives(directory):
    wheel, = directory.glob('*.whl')
    sdist, = directory.glob('*.tar.gz')
    with zipfile.ZipFile(wheel) as archive:
        names = archive.namelist()
        if 'contract_signature_service/launcher.py' not in names: raise ValueError('missing_service_entrypoint')
    with tarfile.open(sdist) as archive: names += archive.getnames()
    for name in names:
        if ({'tests', '.venv', '__pycache__'} & set(Path(name).parts)
            or name.endswith(('.pyc', '.key', '.pfx', '.p12', '.pem', '.der'))):
            raise ValueError('service_archive_contains_forbidden_material')
    return wheel


def command(args, *, timeout=120, expected=0, capture=True):
    result = subprocess.run(args, cwd=ROOT, capture_output=capture, text=True, timeout=timeout)
    if result.returncode != expected:
        # Test data and key bytes must never be passed in command arguments or stderr.
        # Docker build diagnostics contain package names only; validation diagnostics
        # are generic and assertion errors contain no real signatory data.
        if capture: sys.stderr.write((result.stderr or '')[-4000:])
        raise RuntimeError('signature_service_verification_failed')
    return result.stdout or ''


def _mount(source, target, *, writable=False):
    return ['--mount', f'type=bind,src={source},dst={target}'+('' if writable else ',readonly')]


def _limits(user):
    return ['--read-only', '--init', '--user', user, '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges:true', '--pids-limit', '32', '--memory', '1g', '--cpus', '1']


def remove_owned(kind, name, token):
    if kind not in ('container', 'volume', 'image'): raise ValueError('invalid_cleanup_kind')
    try:
        found = subprocess.run(['docker', kind, 'inspect', name], capture_output=True, text=True, timeout=20)
        if found.returncode:
            return any(marker in (getattr(found, 'stderr', '') or '') for marker in
                       ('No such container', 'No such image', 'No such volume', 'No such object'))
        details = json.loads(found.stdout)
        if not details: return True
        labels = details[0].get('Labels', {}) if kind == 'volume' else details[0].get('Config', {}).get('Labels', {})
        if (labels or {}).get('avilaops.validator-ci') != token: return False
        args = ['docker', kind, 'rm']+(['--force'] if kind == 'container' else [])+[name]
        return subprocess.run(args, capture_output=True, timeout=20).returncode == 0
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return False


def _public_files(directory, fixture):
    from asn1crypto import pem
    _, context, _, evidence, trust = fixture
    directory.mkdir(mode=0o755)
    directory.chmod(0o755)
    roots = b''.join(pem.armor('CERTIFICATE', value) for value in trust.root_der)
    intermediates = b''.join(pem.armor('CERTIFICATE', value) for value in trust.intermediate_der)
    (directory/'roots.pem').write_bytes(roots)
    (directory/'intermediates.pem').write_bytes(intermediates)
    rules = {'schemaVersion': 'avila-evidence-origins/1', 'rules': {'http://revocation.invalid': ['/']},
        'provenance': {'rootsPemSha256': hashlib.sha256(roots).hexdigest(),
                       'intermediatesPemSha256': hashlib.sha256(intermediates).hexdigest()}}
    (directory/'evidence-origins.json').write_text(json.dumps(rules), encoding='utf-8')
    (directory/'clock.json').write_text(json.dumps({'observedAt': context.observed_at.isoformat()}), encoding='utf-8')
    # Derive the issuer association rather than relying on EvidenceSet tuple order.
    from cryptography import x509
    root = x509.load_der_x509_certificate(trust.root_der[0])
    intermediate = x509.load_der_x509_certificate(trust.intermediate_der[0])
    for raw in evidence.crls:
        issuer = x509.load_der_x509_crl(raw).issuer
        if issuer == root.subject: (directory/'root.crl').write_bytes(raw)
        elif issuer == intermediate.subject: (directory/'leaf.crl').write_bytes(raw)
    if not all((directory/name).is_file() for name in ('root.crl', 'leaf.crl')):
        raise ValueError('missing_synthetic_crl')


def _secret_files(directory, authenticator):
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID
    directory.mkdir(mode=0o755)
    directory.chmod(0o755)
    key = ec.generate_private_key(ec.SECP256R1())
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'SYNTHETIC VALIDATOR CI ONLY')])
    now = datetime.now(timezone.utc)
    certificate = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject).public_key(key.public_key())
        .serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(minutes=1))
        .not_valid_after(now+timedelta(hours=1)).add_extension(x509.SubjectAlternativeName([
            x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]), critical=False).sign(key, hashes.SHA256()))
    (directory/'tls.pem').write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
    (directory/'tls-key.pem').write_bytes(key.private_bytes(serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    (directory/'hmac.json').write_text(json.dumps({'schemaVersion': 'avila-validator-keys/1',
        'keys': {name: base64.b64encode(value).decode('ascii') for name, value in authenticator._keys.items()}}),
        encoding='utf-8')


def _post(port, request, context, authenticator, tls):
    from contract_signature_validator.transport import encode_request
    frame = encode_request(request)
    headers = authenticator.headers_for(frame, operation=request.operation, request_id=request.request_id,
                                         key_id=context.key_id, sent_at=context.sent_at)
    endpoint = f'https://127.0.0.1:{port}/internal/v1/{request.operation}'
    # Explicit ProxyHandler prevents CI host proxy settings from receiving test requests.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=tls))
    with opener.open(urllib.request.Request(endpoint, data=frame, headers=headers, method='POST'), timeout=20) as result:
        raw = result.read(40*1024*1024+1)
        if result.status != 200: raise ValueError('unexpected_validator_status')
        return raw, list(result.headers.items())


def verify_docker():
    if sys.platform != 'linux': raise RuntimeError('real_linux_docker_is_required')
    from helpers import validation_fixture
    from contract_signature_service.bundle import decode_bundle
    token = uuid4().hex
    image, volume = f'avila-validator-ci:{token}', f'avila-validator-ci-channel-{token}'
    worker, gateway = f'avila-validator-ci-worker-{token}', f'avila-validator-ci-gateway-{token}'
    containers, created_volume, built = [], False, False
    try:
        command(['docker', 'build', '--file', 'deploy/contracts-validator/Dockerfile', '--tag', image,
                 '--label', f'avilaops.validator-ci={token}', '.'],
                timeout=360, capture=False)
        built = True
        # First prove the image has installed packages, no source fixtures/test helpers.
        inspection = ('import importlib.util,pathlib,contract_signature_service,contract_signature_validator;'
            'assert importlib.util.find_spec("fixtures") is None;'
            'assert importlib.util.find_spec("helpers") is None;'
            'p=pathlib.Path(contract_signature_service.__file__);'
            'assert str(p).startswith("/opt/validator/");'
            'assert not any(v.name=="tests" or v.suffix in (".key",".pfx",".p12") for v in p.parent.rglob("*"));'
            'print("installed image excludes fixtures")')
        command(['docker', 'run', '--rm', '--network', 'none', *_limits('10001:10001'),
                 '--entrypoint', '/opt/validator/bin/python', image, '-I', '-c', inspection])
        # All Linux-specific unit assertions must execute here; tests are mounted,
        # never copied to the runtime image. Only public fiscal files are mounted.
        unit_name = f'avila-validator-ci-unit-{token}'
        containers.append(unit_name)
        unit = ['docker', 'run', '--rm', '--name', unit_name, '--label', f'avilaops.validator-ci={token}',
                '--network', 'none', *_limits('10002:10001'),
                '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m,mode=1777',
                *_mount(TESTS, '/repo/apps/contract-signature-service/tests'),
                *_mount(ROOT/'apps/contract-signature-validator/tests', '/repo/apps/contract-signature-validator/tests'),
                *_mount(ROOT/'deploy/fiscal/icp-brasil-roots.pem', '/repo/deploy/fiscal/icp-brasil-roots.pem'),
                *_mount(ROOT/'deploy/fiscal/icp-brasil-intermediates.pem', '/repo/deploy/fiscal/icp-brasil-intermediates.pem'),
                '--entrypoint', '/opt/validator/bin/python', image, '-I', '-c',
                'import unittest; s=unittest.TestLoader().discover("/repo/apps/contract-signature-service/tests");'
                'r=unittest.TextTestRunner().run(s);raise SystemExit(0 if r.wasSuccessful() and not r.skipped else 1)']
        command(unit, timeout=180, capture=False)
        fixture = validation_fixture()
        authenticator, context, _, _, _ = fixture
        with tempfile.TemporaryDirectory(prefix='avila-validator-ci-') as temporary:
            public, secrets = Path(temporary)/'public', Path(temporary)/'secrets'
            _public_files(public, fixture)
            _secret_files(secrets, authenticator)
            # Only synthetic secret files in this newly created directory. Leave
            # directory ownership with CI so its normal cleanup can unlink files.
            permissions = ('import os;from pathlib import Path;'
                '[(os.chown(p,10001,10001),os.chmod(p,0o600)) for p in '
                '(Path("/test-secrets/hmac.json"),Path("/test-secrets/tls-key.pem"))]')
            command(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--user', '0:0',
                '--cap-drop', 'ALL', '--cap-add', 'CHOWN', '--cap-add', 'FOWNER',
                *_mount(secrets, '/test-secrets', writable=True), '--entrypoint', '/opt/validator/bin/python',
                image, '-I', '-c', permissions])
            command(['docker', 'volume', 'create', '--label', f'avilaops.validator-ci={token}', volume])
            created_volume = True
            mounts = [*_mount(public, '/config/public'), *_mount(TESTS/'container_harness.py', '/harness/runner.py')]
            for name, uid, mode, network, extra in (
                (worker, '10002:10001', 'worker', ['--network', 'none'], ['--volume', volume+':/run/validator:rw']),
                (gateway, '10001:10001', 'gateway', ['--publish', '127.0.0.1::8443'],
                 ['--volume', volume+':/run/validator:ro', *_mount(secrets, '/run/secrets/validator')])):
                containers.append(name)
                command(['docker', 'run', '--detach', '--name', name, '--label', f'avilaops.validator-ci={token}',
                    *_limits(uid), *network, *mounts, *extra,
                    '--entrypoint', '/opt/validator/bin/python', image, '-I', '/harness/runner.py', mode])
            details = json.loads(command(['docker', 'inspect', gateway]))[0]
            port = int(details['NetworkSettings']['Ports']['8443/tcp'][0]['HostPort'])
            # The TLS certificate is public; its directory is readable even after
            # the synthetic HMAC/private-key files were restricted to gateway UID.
            tls = ssl.create_default_context(cafile=str(secrets/'tls.pem'))
            deadline = time.monotonic()+40
            preflight = replace(context.request, operation='preflight', parent=None, candidate=None,
                                signer=None, previous_signers=())
            while True:
                try:
                    _post(port, preflight, context, authenticator, tls)
                    break
                except urllib.error.HTTPError as error:
                    if error.code != 503 or time.monotonic() >= deadline: raise
                except (OSError, urllib.error.URLError):
                    if time.monotonic() >= deadline: raise
                time.sleep(0.1)
            probe = json.loads(command(['docker', 'exec', worker, '/opt/validator/bin/python',
                                       '-I', '/harness/runner.py', 'probe']))
            body, headers = _post(port, context.request, context, authenticator, tls)
            decoded = decode_bundle(body, headers, context, authenticator,
                                    trust_profile='synthetic_not_icp', now=context.observed_at)
            if decoded.response['report']['verdict'] != 'accepted' or not decoded.evidence.crls:
                raise ValueError('restricted_pipeline_did_not_validate')
            # Production entry point must still reject the very same synthetic
            # public roots, without a harness or a trust-downgrade flag.
            negative = f'avila-validator-ci-negative-{token}'
            containers.append(negative)
            command(['docker', 'run', '--rm', '--name', negative, '--label', f'avilaops.validator-ci={token}',
                '--network', 'none', *_limits('10001:10001'), *_mount(public, '/config/public'),
                *_mount(secrets, '/run/secrets/validator'), image, 'gateway'], expected=78, timeout=15)
            return {'restrictedTlsUnixPipeline': True, 'productionRejectsSyntheticTrust': True,
                    'bundleSha256': decoded.sha256, **probe}
    finally:
        # Names are generated and owned by this invocation; never prune shared state.
        cleaned = [remove_owned('container', name, token) for name in reversed(containers)]
        if created_volume: cleaned.append(remove_owned('volume', volume, token))
        if built: cleaned.append(remove_owned('image', image, token))
        if not all(cleaned):
            sys.stderr.write('owned_harness_cleanup_incomplete\n')
            if sys.exc_info()[0] is None: raise RuntimeError('owned_harness_cleanup_incomplete')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--docker', action='store_true')
    args = parser.parse_args()
    wheel = verify_archives(args.directory.resolve())
    sys.path.insert(0, str(wheel))
    import contract_signature_service
    if not isinstance(contract_signature_service.__loader__, zipimport.zipimporter):
        raise RuntimeError('service_must_import_built_wheel')
    suite = unittest.TestLoader().discover(str(TESTS), pattern='test_*.py')
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    if not result.wasSuccessful() or (sys.platform == 'linux' and result.skipped): return 1
    if not isinstance(contract_signature_service.__loader__, zipimport.zipimporter):
        raise RuntimeError('tests_replaced_selected_wheel')
    report = {'wheelCorpus': True, 'cases': result.testsRun, 'skipped': len(result.skipped),
              'docker': verify_docker() if args.docker else None, 'syntheticOnly': True}
    target = ROOT/'artifacts/verification/contract-signature-service.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(report))
    return 0


if __name__ == '__main__': raise SystemExit(main())

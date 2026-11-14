"""SYNTHETIC CI ONLY • mounted explicitly, never copied to a release image.

Exercises the real TLS, Unix, peer, process and kernel boundaries. Production
CLI/child never allow synthetic roots; this mounted test harness opts in in code.
"""
import asyncio
from datetime import datetime
import json
from pathlib import Path
import sys

PUBLIC = Path('/config/public')


def configuration():
    from contract_signature_validator.trust import load_trust_bundle
    from contract_signature_service.config import ServiceConfig
    from contract_signature_service.egress import NetworkPolicy
    trust = load_trust_bundle((PUBLIC/'roots.pem').read_bytes(), (PUBLIC/'intermediates.pem').read_bytes(),
                              allow_synthetic=True)  # TEST HARNESS ONLY
    return ServiceConfig(trust, NetworkPolicy({'http://revocation.invalid': ('/',)}))


def child(stage):
    from contract_signature_service.engine import run_engine
    from contract_signature_service.ipc import REQUEST_MAX, decode_job, encode_result
    config = configuration()
    context, evidence = decode_job(sys.stdin.buffer.read(REQUEST_MAX+1), config, stage=stage)
    result = run_engine(stage, context, evidence, config)
    sys.stdout.buffer.write(encode_result(stage, result, context))
    sys.stdout.buffer.flush()


async def worker():
    import contract_signature_service.worker as module
    from contract_signature_service.launcher import _until_stop
    module.require_worker_isolation()
    bounded = module.run_bounded
    async def mounted_child(command, data, **limits):
        expected = (sys.executable, '-I', '-m', 'contract_signature_service.child')
        assert tuple(command[:-1]) == expected and command[-1] in ('discover', 'validate')
        assert limits['profile'] == 'pdf'
        return await bounded((sys.executable, '-I', str(Path(__file__).resolve()), 'child', command[-1]),
                             data, **limits)
    module.run_bounded = mounted_child
    await _until_stop(module.WorkerServer(Path('/run/validator/validator.sock'), PUBLIC).serve_forever())


async def gateway():
    from aiohttp import web
    from contract_signature_service.gateway import SERVER_OPTIONS, create_app
    from contract_signature_service.launcher import (_require_gateway_isolation, _until_stop,
                                                     load_gateway_security)
    from contract_signature_service.worker import WorkerClient
    _require_gateway_isolation()
    config = configuration()
    auth, tls = load_gateway_security(Path('/run/secrets/validator'))
    now = datetime.fromisoformat(json.loads((PUBLIC/'clock.json').read_bytes())['observedAt'])
    class MountedPublicEvidence:
        async def fetch(self, target, *, timeout):
            if target.kind != 'crls' or target.url not in (
                'http://revocation.invalid/root.crl', 'http://revocation.invalid/leaf.crl'):
                raise ValueError('synthetic_evidence_unavailable')
            return (PUBLIC/target.url.rsplit('/', 1)[-1]).read_bytes()
    app = create_app(config, auth, WorkerClient(Path('/run/validator/validator.sock'), config),
                     clock=lambda: now, collector=MountedPublicEvidence())
    async def serve():
        runner = web.AppRunner(app, shutdown_timeout=5, **SERVER_OPTIONS)
        try:
            await runner.setup()
            await web.TCPSite(runner, '0.0.0.0', 8443, ssl_context=tls).start()
            await asyncio.Event().wait()
        finally: await runner.cleanup()
    await _until_stop(serve())


def probe():
    import os
    import socket
    import stat
    from contract_signature_service.worker import require_worker_isolation
    require_worker_isolation()
    assert not Path('/run/secrets/validator/hmac.json').exists()
    status = dict(line.split(':', 1) for line in Path('/proc/self/status').read_text().splitlines() if ':' in line)
    assert status['NoNewPrivs'].strip() == '1' and int(status['CapEff'].strip(), 16) == 0
    info = Path('/run/validator/validator.sock').stat()
    assert info.st_uid == 10002 and info.st_gid == 10001 and stat.S_IMODE(info.st_mode) == 0o660
    channel = socket.socket()
    try:
        channel.settimeout(0.2)
        try: channel.connect(('1.1.1.1', 443))
        except OSError: pass
        else: raise AssertionError('offline worker reached network')
    finally: channel.close()
    print(json.dumps({'offlineWorker': True, 'readOnlyRoot': True, 'peerSocketPermissions': True,
                      'noGatewaySecrets': True, 'noCapabilities': True}))


if __name__ == '__main__':
    if sys.argv[1:] == ['worker']: asyncio.run(worker())
    elif sys.argv[1:] == ['gateway']: asyncio.run(gateway())
    elif sys.argv[1:] == ['probe']: probe()
    elif len(sys.argv) == 3 and sys.argv[1] == 'child' and sys.argv[2] in ('discover', 'validate'):
        child(sys.argv[2])
    else: raise SystemExit(78)

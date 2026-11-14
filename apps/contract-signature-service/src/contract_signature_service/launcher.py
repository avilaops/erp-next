"""Fail-closed production entry points. Local files only; no test trust switches."""
import asyncio
import base64
import os
from pathlib import Path
import signal
import ssl
import stat
import sys

from contract_signature_validator.transport import strict_json
from contract_signature_validator.transport_auth import TransportAuthenticator
from .config import ConfigurationError, load_config, read_local_file

PUBLIC_CONFIG = Path('/config/public')
SECRETS = Path('/run/secrets/validator')
CHANNEL = Path('/run/validator/validator.sock')


def _secret(path, maximum):
    data = read_local_file(path, maximum)
    info = path.stat(follow_symlinks=False)
    if sys.platform == 'linux' and (info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) & 0o077):
        raise ConfigurationError()
    return data


def load_gateway_security(root):
    try:
        root = Path(root)
        raw = strict_json(_secret(root/'hmac.json', 4096), max_bytes=4096)
        if (type(raw) is not dict or set(raw) != {'schemaVersion', 'keys'}
            or raw['schemaVersion'] != 'avila-validator-keys/1' or type(raw['keys']) is not dict
            or not 1 <= len(raw['keys']) <= 2
            or any(not isinstance(value, str) or len(value) > 88 for value in raw['keys'].values())):
            raise ConfigurationError()
        authenticator = TransportAuthenticator({name: base64.b64decode(value, validate=True)
                                                for name, value in raw['keys'].items()})
        read_local_file(root/'tls.pem', 256*1024)
        _secret(root/'tls-key.pem', 32*1024)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.set_alpn_protocols(['http/1.1'])
        # An encrypted/misconfigured key must fail, never prompt on a service stdin.
        context.load_cert_chain(root/'tls.pem', root/'tls-key.pem', password=lambda: b'')
        return authenticator, context
    except (OSError, ValueError, TypeError, KeyError, OverflowError):
        raise ConfigurationError() from None


def _require_gateway_isolation():
    if sys.platform != 'linux': raise ConfigurationError()
    if (os.geteuid() != 10001 or os.getegid() != 10001
        or not os.statvfs('/').f_flag & os.ST_RDONLY): raise ConfigurationError()
    status = Path('/proc/self/status').read_text()
    fields = dict(line.split(':', 1) for line in status.splitlines() if ':' in line)
    if fields.get('NoNewPrivs', '').strip() != '1' or int(fields.get('CapEff', '1').strip(), 16) != 0:
        raise ConfigurationError()


async def _until_stop(coroutine):
    loop, stopping = asyncio.get_running_loop(), asyncio.Event()
    for event in (signal.SIGTERM, signal.SIGINT): loop.add_signal_handler(event, stopping.set)
    owned = [asyncio.create_task(coroutine), asyncio.create_task(stopping.wait())]
    try:
        done, _ = await asyncio.wait(owned, return_when=asyncio.FIRST_COMPLETED)
        if owned[0] in done: owned[0].result()
    finally:
        for task in owned: task.cancel()
        await asyncio.gather(*owned, return_exceptions=True)
        for event in (signal.SIGTERM, signal.SIGINT): loop.remove_signal_handler(event)


async def _gateway(config, authenticator, tls):
    from aiohttp import web
    from .gateway import SERVER_OPTIONS, create_app
    from .worker import WorkerClient
    app = create_app(config, authenticator, WorkerClient(CHANNEL, config))
    runner = web.AppRunner(app, shutdown_timeout=5, **SERVER_OPTIONS)
    try:
        await runner.setup()
        await web.TCPSite(runner, '0.0.0.0', 8443, ssl_context=tls).start()
        await asyncio.Event().wait()
    finally:
        await runner.cleanup()


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    try:
        if args not in (['gateway'], ['worker']) or sys.platform != 'linux':
            raise ConfigurationError()
        if args == ['gateway']:
            _require_gateway_isolation()
            config = load_config(PUBLIC_CONFIG)
            authenticator, tls = load_gateway_security(SECRETS)
            asyncio.run(_until_stop(_gateway(config, authenticator, tls)))
        else:
            from .worker import WorkerServer, require_worker_isolation
            require_worker_isolation()
            load_config(PUBLIC_CONFIG)
            asyncio.run(_until_stop(WorkerServer(CHANNEL, PUBLIC_CONFIG).serve_forever()))
        return 0
    except Exception:
        sys.stderr.write('service_configuration_rejected\n')
        return 78

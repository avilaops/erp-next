"""Private TLS/HMAC ingress, bounded orchestration and authenticated output."""
import asyncio
from dataclasses import replace
from datetime import datetime, timezone
import logging
import time

from aiohttp import web
from contract_signature_validator.model import EvidenceSet
from contract_signature_validator.transport import FRAME_MAX_BYTES
from contract_signature_validator.transport_auth import AuthenticationError

from .bundle import encode_response_bundle
from .collector import EvidenceCollector
from .egress import LIMITS

UPLOAD_SECONDS = 10
EXECUTION_SECONDS = 40
_http_logger = logging.Logger('avila.contract-validator.http', level=logging.CRITICAL+1)
_http_logger.disabled = True
_http_logger.propagate = False
SERVER_OPTIONS = {'access_log': None, 'logger': _http_logger, 'handler_cancellation': True,
    'max_headers': 32, 'max_line_size': 8190, 'max_field_size': 8190,
    'auto_decompress': False, 'lingering_time': 0, 'keepalive_timeout': 5}


def _error(status, code):
    response = web.json_response({'error': code}, status=status, headers={'Cache-Control': 'no-store'})
    response.force_close()
    return response


async def _expect(request):
    # aiohttp must never send 100 Continue before our authentication/body gate.
    return _error(417, 'unsupported_expectation')


class Pipeline:
    def __init__(self, config, worker, collector, *, monotonic=None):
        self.config, self.worker, self.collector = config, worker, collector
        self.monotonic = monotonic or time.monotonic

    async def run(self, frame, authenticated):
        evidence = EvidenceSet(authenticated.observed_at)
        queries, downloaded, seen, network_deadline = 0, 0, set(), None
        for _ in range(2):
            result = await self.worker.call('discover', frame, authenticated, evidence, timeout=15)
            evidence = result.evidence
            if result.terminal: return result
            if network_deadline is None: network_deadline = self.monotonic()+12
            attempted = False
            for target in result.targets:
                self.config.network_policy.approve(target)
                remaining = network_deadline-self.monotonic()
                if queries >= 12 or remaining <= 0 or downloaded >= 32*1024*1024: break
                if target in seen: continue
                seen.add(target)
                queries += 1
                attempted = True
                try:
                    raw = await self.collector.fetch(target, timeout=min(3, remaining))
                    if not isinstance(raw, bytes) or not 0 < len(raw) <= LIMITS[target.kind]: continue
                    downloaded += len(raw)
                    if downloaded > 32*1024*1024: break
                    values = tuple(sorted(set((*getattr(evidence, target.kind), raw))))
                    evidence = replace(evidence, **{target.kind: values})
                except (OSError, ValueError, TimeoutError):
                    # Failed collection is absence of evidence, never positive validation.
                    continue
            if not attempted: break
        return await self.worker.call('validate', frame, authenticated, evidence, timeout=15)


def create_app(config, authenticator, worker, *, clock=None, collector=None):
    clock = clock or (lambda: datetime.now(timezone.utc))
    pipeline = Pipeline(config, worker, collector or EvidenceCollector(config.network_policy))
    active = False

    async def handle(request):
        nonlocal active
        if not request.secure: return _error(426, 'tls_required')
        headers = list(request.headers.items())
        try:
            authorization = authenticator.authorize_headers(headers, method=request.method,
                target=request.raw_path, now=clock())
        except AuthenticationError:
            return _error(401, 'unauthorized')
        if active: return _error(503, 'validation_busy')
        active = True
        response = None
        try:
            body, size = bytearray(), 0
            try:
                async with asyncio.timeout(UPLOAD_SECONDS):
                    async for chunk in request.content.iter_chunked(65536):
                        size += len(chunk)
                        if size > authorization.content_length or size > FRAME_MAX_BYTES:
                            return _error(413, 'validation_body_limit')
                        body.extend(chunk)
            except TimeoutError:
                return _error(408, 'validation_upload_timeout')
            # The observation belongs to the server after the complete upload, not to
            # an asserted signing time or a proxy header. Verify original bytes again.
            authenticated = authenticator.decode_request(bytes(body), headers, method=request.method,
                target=request.raw_path, now=clock(), policy_sha256=config.policy.sha256,
                trust_bundle_sha256=config.trust.sha256)
            async with asyncio.timeout(EXECUTION_SECONDS):
                result = await pipeline.run(bytes(body), authenticated)
                raw, response_headers = encode_response_bundle(authenticated, result.response,
                    result.evidence, config.trust, authenticator)
                response = web.StreamResponse(status=200, headers=response_headers | {'Cache-Control': 'no-store'})
                response.force_close()
                # Keep the single admission slot until delivery completes. A slow
                # recipient cannot retain many evidence bundles behind a released slot.
                async with asyncio.timeout(10):
                    await response.prepare(request)
                    for offset in range(0, len(raw), 65536):
                        await response.write(raw[offset:offset+65536])
                    await response.write_eof()
                return response
        except AuthenticationError:
            return _error(401, 'unauthorized')
        except Exception:
            if response is not None and response.prepared:
                if request.transport is not None: request.transport.close()
                return response
            return _error(503, 'validation_unavailable')
        finally:
            active = False

    app = web.Application(client_max_size=FRAME_MAX_BYTES)
    app.router.add_route('*', '/{tail:.*}', handle, expect_handler=_expect)
    return app

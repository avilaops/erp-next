import asyncio
from dataclasses import replace
from datetime import datetime, timedelta, timezone
import ipaddress
import json
from pathlib import Path
import ssl
import tempfile
import unittest
from unittest.mock import patch

from aiohttp import ClientSession, TCPConnector, web
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

from helpers import load, validation_fixture
from contract_signature_validator.model import EvidenceSet
from contract_signature_validator.transport import encode_request
from fixtures import NOW, chain_fixture, issued_crl


class LocalWorker:
    """Only test HTTP composition here; real subprocess/Unix isolation is a CI gate."""
    def __init__(self, engine, config):
        self.engine, self.config, self.calls = engine, config, []
        self.block = None
        self.started = asyncio.Event()
        self.cancelled = asyncio.Event()

    async def call(self, stage, frame, context, evidence, *, timeout):
        self.calls.append((stage, context))
        self.started.set()
        if self.block is not None:
            try: await self.block.wait()
            except asyncio.CancelledError:
                self.cancelled.set()
                raise
        return await asyncio.to_thread(self.engine.run_engine, stage, context, evidence, self.config)


class LocalCollector:
    def __init__(self): self.calls = []

    async def fetch(self, target, *, timeout):
        self.calls.append((target, timeout))
        chain = chain_fixture()
        if target.url.endswith('/root.crl'): return issued_crl(chain.root, chain.root_key)
        if target.url.endswith('/leaf.crl'): return issued_crl(chain.intermediate, chain.intermediate_key)
        raise ValueError('external private diagnostics must never appear')


class GatewayTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = validation_fixture()
        cls.temp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temp.cleanup)
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'SYNTHETIC LOOPBACK TEST ONLY')])
        now = datetime.now(timezone.utc)
        cert = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(minutes=1))
            .not_valid_after(now+timedelta(hours=1)).add_extension(x509.SubjectAlternativeName([
                x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]), critical=False).sign(key, hashes.SHA256()))
        root = Path(cls.temp.name)
        (root/'tls.pem').write_bytes(cert.public_bytes(serialization.Encoding.PEM))
        (root/'tls-key.pem').write_bytes(key.private_bytes(serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        cls.server_tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        cls.server_tls.load_cert_chain(root/'tls.pem', root/'tls-key.pem')
        cls.client_tls = ssl.create_default_context(cafile=str(root/'tls.pem'))

    async def asyncSetUp(self):
        self.api = load(self, 'gateway')
        self.auth, self.ctx, _, self.evidence, trust = self.fixture
        self.config = load(self, 'config').ServiceConfig(trust,
            load(self, 'egress').NetworkPolicy({'http://revocation.invalid': ('/',)}))
        self.worker = LocalWorker(load(self, 'engine'), self.config)
        self.collector = LocalCollector()
        self.observations = []
        self.app = self.api.create_app(self.config, self.auth, self.worker,
            clock=lambda: self.observations.pop(0) if self.observations else NOW, collector=self.collector)
        self.runner = web.AppRunner(self.app, **self.api.SERVER_OPTIONS)
        await self.runner.setup()
        self.site = web.TCPSite(self.runner, '127.0.0.1', 0, ssl_context=self.server_tls)
        await self.site.start()
        self.url = 'https://127.0.0.1:'+str(self.site._server.sockets[0].getsockname()[1])
        self.session = ClientSession(connector=TCPConnector(ssl=self.client_tls))
        self.frame = encode_request(self.ctx.request)
        self.headers = self.auth.headers_for(self.frame, operation='increment', request_id=self.ctx.request.request_id,
                                             key_id='test', sent_at=NOW)

    async def asyncTearDown(self):
        if self.worker.block is not None: self.worker.block.set()
        await self.session.close()
        await self.runner.cleanup()

    async def post(self, frame=None, headers=None, path='/internal/v1/increment'):
        response = await self.session.post(self.url+path, data=self.frame if frame is None else frame,
                                           headers=self.headers if headers is None else headers)
        return response, await response.read()

    async def test_tls_pipeline_uses_real_offline_core_and_returns_reproducible_bundle(self):
        response, body = await self.post()
        self.assertEqual(response.status, 200, body)
        result = load(self, 'bundle').decode_bundle(body, list(response.headers.items()), self.ctx, self.auth,
                                                   trust_profile='synthetic_not_icp', now=NOW)
        self.assertEqual(result.response['report']['verdict'], 'accepted')
        self.assertEqual(result.trust.sha256, self.config.trust.sha256)
        self.assertTrue(result.evidence.crls)
        self.assertLessEqual(len(self.collector.calls), 12)
        self.assertTrue(all(0 < seconds <= 3 for _, seconds in self.collector.calls))
        self.assertLessEqual(sum(stage == 'discover' for stage, _ in self.worker.calls), 2)

    async def test_authentication_rejects_headers_before_reading_or_using_worker(self):
        bad = self.headers | {'authorization': 'HMAC-SHA256 test:'+'0'*64}
        response, body = await self.post(frame=b'', headers=bad)
        self.assertEqual(response.status, 401)
        self.assertEqual(json.loads(body), {'error': 'unauthorized'})
        self.assertFalse(self.worker.calls)
        self.assertFalse(self.collector.calls)
        self.assertEqual(response.headers.get('Connection'), 'close')

    async def test_fixed_target_content_hash_and_encoding_are_enforced(self):
        response, _ = await self.post(path='/internal/v1/increment?command=anything')
        self.assertEqual(response.status, 401)
        response, _ = await self.post(frame=self.frame[:-1]+bytes([self.frame[-1]^1]))
        self.assertEqual(response.status, 401)
        response, _ = await self.post(headers=self.headers | {'Content-Encoding': 'gzip'})
        self.assertEqual(response.status, 401)
        self.assertFalse(self.worker.calls)

    async def test_concurrent_authenticated_request_is_rejected_without_queue(self):
        self.worker.block = asyncio.Event()
        first = asyncio.create_task(self.post())
        await asyncio.wait_for(self.worker.started.wait(), 3)
        try:
            response, body = await self.post()
            self.assertEqual(response.status, 503)
            self.assertEqual(json.loads(body), {'error': 'validation_busy'})
            self.assertEqual(len(self.worker.calls), 1)
        finally:
            self.worker.block.set()
            await first

    async def test_missing_network_material_remains_indeterminate_and_errors_are_sanitized(self):
        async def failed(*args, **kwargs): raise ValueError('CPF and certificate private diagnostics')
        self.collector.fetch = failed
        response, body = await self.post()
        self.assertEqual(response.status, 200)
        result = load(self, 'bundle').decode_bundle(body, list(response.headers.items()), self.ctx, self.auth,
                                                   trust_profile='synthetic_not_icp', now=NOW)
        self.assertEqual(result.response['report']['verdict'], 'indeterminate')
        self.assertNotIn(b'private diagnostics', body)

    async def test_worker_failure_is_generic_and_does_not_seal_acceptance(self):
        async def failed(*args, **kwargs): raise RuntimeError('private PDF diagnostics')
        self.worker.call = failed
        response, body = await self.post()
        self.assertEqual(response.status, 503)
        self.assertEqual(json.loads(body), {'error': 'validation_unavailable'})
        self.assertNotIn('x-validation-response-mac', response.headers)

    async def test_plain_http_and_forwarded_tls_headers_cannot_bypass_tls(self):
        site = web.TCPSite(self.runner, '127.0.0.1', 0)
        await site.start()
        address = 'http://127.0.0.1:'+str(site._server.sockets[0].getsockname()[1])
        try:
            async with self.session.post(address+'/internal/v1/increment', data=b'',
                headers=self.headers | {'X-Forwarded-Proto': 'https'}) as response:
                self.assertEqual(response.status, 426)
        finally: await site.stop()
        self.assertFalse(self.worker.calls)

    async def test_preflight_has_no_network_and_keeps_authenticated_request_context(self):
        request = replace(self.ctx.request, operation='preflight', parent=None, candidate=None,
                          signer=None, previous_signers=())
        frame = encode_request(request)
        headers = self.auth.headers_for(frame, operation='preflight', request_id=request.request_id,
                                         key_id='test', sent_at=NOW)
        response, body = await self.post(frame=frame, headers=headers, path='/internal/v1/preflight')
        self.assertEqual(response.status, 200)
        self.assertFalse(self.collector.calls)
        self.assertEqual(self.worker.calls[0][1].request.operation, 'preflight')

    async def test_unauthenticated_body_is_never_consumed_and_upload_has_a_deadline(self):
        # A declared body which never arrives must not hold a slot after the deadline.
        tls_reader, tls_writer = await asyncio.open_connection('127.0.0.1',
            self.site._server.sockets[0].getsockname()[1], ssl=self.client_tls, server_hostname='127.0.0.1')
        raw = ('POST /internal/v1/increment HTTP/1.1\r\nHost: localhost\r\n'+
               ''.join(name+': '+value+'\r\n' for name, value in self.headers.items())+'\r\n').encode('ascii')
        try:
            with patch.object(self.api, 'UPLOAD_SECONDS', 0.05):
                tls_writer.write(raw)
                await tls_writer.drain()
                received = await asyncio.wait_for(tls_reader.read(4096), 2)
                self.assertIn(b'408', received.split(b'\r\n', 1)[0])
        finally:
            tls_writer.close()
            await tls_writer.wait_closed()
        self.assertFalse(self.worker.calls)

    async def test_expect_continue_is_refused_without_reading_the_body(self):
        response, _ = await self.post(headers=self.headers | {'Expect': '100-continue'})
        self.assertEqual(response.status, 417)
        self.assertFalse(self.worker.calls)

    async def test_observation_is_server_utc_after_the_upload(self):
        later = NOW+timedelta(seconds=2)
        self.observations[:] = [NOW, later]
        response, body = await self.post()
        self.assertEqual(response.status, 200)
        result = load(self, 'bundle').decode_bundle(body, list(response.headers.items()),
            replace(self.ctx, observed_at=later), self.auth, trust_profile='synthetic_not_icp', now=later)
        self.assertEqual(result.response['checkedAt'], later.isoformat().replace('+00:00', 'Z'))
        self.assertTrue(all(ctx.observed_at == later for _, ctx in self.worker.calls))

    async def test_overall_deadline_cancels_worker_and_returns_no_acceptance(self):
        self.worker.block = asyncio.Event()
        with patch.object(self.api, 'EXECUTION_SECONDS', 0.05): response, body = await self.post()
        self.assertEqual(response.status, 503)
        self.assertTrue(self.worker.cancelled.is_set())
        self.assertNotIn('x-validation-response-mac', response.headers)

    async def test_client_disconnect_cancels_validation_and_releases_admission(self):
        self.worker.block = asyncio.Event()
        first = asyncio.create_task(self.post())
        await asyncio.wait_for(self.worker.started.wait(), 3)
        first.cancel()
        await asyncio.gather(first, return_exceptions=True)
        await asyncio.wait_for(self.worker.cancelled.wait(), 3)
        self.worker.block.set()
        response, _ = await self.post()
        self.assertEqual(response.status, 200)

    async def test_admission_is_held_until_evidence_bundle_has_been_delivered(self):
        started, release = asyncio.Event(), asyncio.Event()
        original = web.StreamResponse.write
        async def delayed(response, data):
            started.set()
            await release.wait()
            await original(response, data)
        with patch.object(web.StreamResponse, 'write', delayed):
            first = asyncio.create_task(self.post())
            await asyncio.wait_for(started.wait(), 3)
            try:
                response, _ = await self.post()
                self.assertEqual(response.status, 503)
            finally:
                release.set()
                response, _ = await first
                self.assertEqual(response.status, 200)

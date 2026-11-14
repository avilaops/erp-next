import asyncio
from pathlib import Path
import socket
import struct
import sys
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

from helpers import load, validation_fixture
from contract_signature_validator.transport import encode_request


class WorkerProtocolTests(unittest.TestCase):
    def setUp(self): self.api = load(self, 'worker')

    def test_channel_header_only_allows_fixed_stages_and_bounded_lengths(self):
        for stage in ('discover', 'validate'):
            self.assertEqual(self.api.decode_header(self.api.encode_header(stage, 123)), (stage, 123))
        for stage, size in (('shell', 1), ('discover', 0), ('validate', 2**40), ('validate', True)):
            with self.assertRaises(self.api.WorkerError): self.api.encode_header(stage, size)
        for bad in (b'', b'x'*24, self.api.encode_header('validate', 1)+b'x'):
            with self.assertRaises(self.api.WorkerError): self.api.decode_header(bad)

    def test_runtime_guard_rejects_root_writable_root_or_network_interface(self):
        with patch.object(self.api.sys, 'platform', 'win32'):
            with self.assertRaises(self.api.WorkerError): self.api.require_worker_isolation()
        if sys.platform != 'linux': return
        with patch.object(self.api.os, 'geteuid', return_value=0):
            with self.assertRaises(self.api.WorkerError): self.api.require_worker_isolation()
        with patch.object(self.api.os, 'geteuid', return_value=10002), \
             patch.object(self.api.socket, 'if_nameindex', return_value=[(1, 'lo'), (2, 'eth0')]):
            with self.assertRaises(self.api.WorkerError): self.api.require_worker_isolation()
        with patch.object(self.api.os, 'geteuid', return_value=10002), \
             patch.object(self.api.socket, 'if_nameindex', return_value=[(1, 'lo')]), \
             patch.object(self.api.os, 'statvfs') as filesystem:
            filesystem.return_value.f_flag = 0
            with self.assertRaises(self.api.WorkerError): self.api.require_worker_isolation()


class SupervisorCancellationTests(unittest.IsolatedAsyncioTestCase):
    async def test_disconnect_cancels_the_owned_parser_before_it_finishes(self):
        api = load(self, 'worker')
        reader, started, cancelled = asyncio.StreamReader(), asyncio.Event(), asyncio.Event()
        reader.feed_data(api.encode_header('validate', 2)+b'xx')
        class Writer:
            def __init__(self): self.output = bytearray()
            def get_extra_info(self, name): return object()
            def write(self, data): self.output.extend(data)
            async def drain(self): pass
            def close(self): pass
            async def wait_closed(self): pass
        writer = Writer()
        async def parser(*args, **kwargs):
            started.set()
            try: await asyncio.sleep(30)
            except asyncio.CancelledError:
                cancelled.set()
                raise
        worker = api.WorkerServer(Path(tempfile.gettempdir()) / 'validator.sock', Path(tempfile.gettempdir()))
        with patch.object(api, 'peer_uid', return_value=api.GATEWAY_UID), patch.object(api, 'run_bounded', parser):
            task = asyncio.create_task(worker.handle_client(reader, writer))
            await asyncio.wait_for(started.wait(), timeout=1)
            reader.feed_eof()
            try:
                await asyncio.wait_for(cancelled.wait(), timeout=0.2)
                await asyncio.wait_for(task, timeout=1)
            finally:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
        self.assertFalse(worker.active)


@unittest.skipUnless(sys.platform == 'linux', 'Unix credentials and sockets require Linux')
class LinuxWorkerTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls): cls.fixture = validation_fixture()

    async def asyncSetUp(self):
        import os
        self.api = load(self, 'worker')
        self.ipc = load(self, 'ipc')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'validator.sock'
        self.auth, self.ctx, _, self.evidence, trust = self.fixture
        self.config = load(self, 'config').ServiceConfig(trust,
            load(self, 'egress').NetworkPolicy({'http://revocation.invalid': ('/',)}))
        self.frame = encode_request(self.ctx.request)
        self.result = await asyncio.to_thread(load(self, 'engine').run_engine,
            'validate', self.ctx, self.evidence, self.config)
        self.runner = AsyncMock(return_value=self.ipc.encode_result('validate', self.result, self.ctx))
        self.patch_runner = patch.object(self.api, 'run_bounded', self.runner)
        self.patch_runner.start()
        self.addCleanup(self.patch_runner.stop)
        self.patch_uid = patch.object(self.api, 'GATEWAY_UID', os.geteuid())
        self.patch_uid.start()
        self.addCleanup(self.patch_uid.stop)
        self.patch_worker_uid = patch.object(self.api, 'WORKER_UID', os.geteuid())
        self.patch_worker_uid.start()
        self.addCleanup(self.patch_worker_uid.stop)
        self.worker = self.api.WorkerServer(self.path, Path(self.temp.name))
        self.server = await asyncio.start_unix_server(self.worker.handle_client, path=str(self.path), limit=65536)
        self.client = self.api.WorkerClient(self.path, self.config)

    async def asyncTearDown(self):
        self.server.close()
        await self.server.wait_closed()

    async def test_real_peer_credentials_and_binary_round_trip(self):
        import os
        left, right = socket.socketpair(socket.AF_UNIX)
        try:
            self.assertEqual(self.api.peer_uid(left), os.geteuid())
        finally:
            left.close()
            right.close()
        received = await self.client.call('validate', self.frame, self.ctx, self.evidence, timeout=3)
        self.assertEqual(received, self.result)
        self.runner.assert_awaited_once()
        args = self.runner.call_args
        self.assertEqual(args.kwargs['profile'], 'pdf')
        self.assertEqual(set(args.kwargs['extra_env']), {'VALIDATOR_CONFIG_ROOT'})

    async def test_wrong_peer_is_denied_before_header_or_body(self):
        with patch.object(self.api, 'GATEWAY_UID', 2**30):
            reader, writer = await asyncio.open_unix_connection(str(self.path))
            self.assertEqual(await reader.read(1), b'N')
            writer.close()
            await writer.wait_closed()
        self.runner.assert_not_called()

    async def test_busy_peer_is_denied_without_queueing_body(self):
        reader, writer = await asyncio.open_unix_connection(str(self.path))
        writer.write(self.api.encode_header('validate', 1))
        await writer.drain()
        self.assertEqual(await reader.readexactly(1), b'Y')
        other, sender = await asyncio.open_unix_connection(str(self.path))
        self.assertEqual(await other.read(1), b'N')
        sender.close()
        writer.close()
        await sender.wait_closed()
        await writer.wait_closed()

    async def test_runner_failure_and_deadline_do_not_leak_diagnostics(self):
        self.runner.side_effect = ValueError('private certificate or personal data')
        with self.assertRaisesRegex(self.api.WorkerError, '^validation_worker_failed$'):
            await self.client.call('validate', self.frame, self.ctx, self.evidence, timeout=3)
        # A stalled local peer is bounded by the client as well as by the supervisor.
        self.server.close()
        await self.server.wait_closed()
        self.path.unlink()
        async def stalled(reader, writer):
            try: await reader.read()
            finally:
                writer.close()
                await writer.wait_closed()
        self.server = await asyncio.start_unix_server(stalled, path=str(self.path))
        with self.assertRaisesRegex(self.api.WorkerError, '^validation_worker_failed$'):
            await self.client.call('validate', self.frame, self.ctx, self.evidence, timeout=0.1)

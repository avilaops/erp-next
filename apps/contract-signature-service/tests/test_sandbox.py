import asyncio
import json
import os
from pathlib import Path
import sys
import time
import unittest
import tempfile

from helpers import load


class SandboxPolicyTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.api = load(self, 'sandbox')

    async def test_unknown_profile_or_unsafe_budgets_are_rejected_before_spawn(self):
        for kwargs in ({'profile': 'untrusted'}, {'timeout': 999}, {'output_limit': 2**40}):
            values = dict(profile='pdf', timeout=1, output_limit=1024) | kwargs
            with self.assertRaises(self.api.SandboxError):
                await self.api.run_bounded((sys.executable, '-c', 'print(1)'), b'', **values)


@unittest.skipUnless(sys.platform == 'linux', 'Linux resource/process tests are mandatory in CI')
class LinuxSandboxTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.api = load(self, 'sandbox')

    async def run_code(self, code, **overrides):
        args = dict(timeout=3, output_limit=65536, profile='pdf') | overrides
        return await self.api.run_bounded((sys.executable, '-I', '-c', code), b'', **args)

    async def test_kernel_limits_and_environment_are_really_applied(self):
        code = ('import os,resource,json;print(json.dumps({"cpu":resource.getrlimit(resource.RLIMIT_CPU),'
                '"as":resource.getrlimit(resource.RLIMIT_AS),"file":resource.getrlimit(resource.RLIMIT_FSIZE),'
                '"core":resource.getrlimit(resource.RLIMIT_CORE),"env":dict(os.environ)}))')
        os.environ['SYNTHETIC_SECRET_TO_STRIP'] = 'must_not_escape'
        try:
            result = json.loads(await self.run_code(code))
        finally:
            del os.environ['SYNTHETIC_SECRET_TO_STRIP']
        self.assertEqual(result['cpu'], [10, 12])
        self.assertEqual(result['as'], [768*1024*1024]*2)
        self.assertEqual(result['file'], [0, 0])
        self.assertEqual(result['core'], [0, 0])
        self.assertNotIn('SYNTHETIC_SECRET_TO_STRIP', result['env'])

    async def test_deadline_and_output_cap_kill_the_owned_process(self):
        started = time.monotonic()
        with self.assertRaises(self.api.SandboxError):
            await self.run_code('import time;time.sleep(30)', timeout=0.1)
        self.assertLess(time.monotonic()-started, 3)
        with self.assertRaises(self.api.SandboxError):
            await self.run_code('import sys;sys.stdout.buffer.write(b"x"*1000000)', output_limit=128)

    async def test_memory_limit_is_effective_and_stderr_is_not_returned(self):
        result = await self.run_code('import sys;sys.stderr.write("private diagnostics");print("public")')
        self.assertEqual(result, b'public\n')
        code = 'try:\n x=bytearray(1024*1024*1024)\nexcept MemoryError:\n print("bounded")'
        self.assertEqual(await self.run_code(code), b'bounded\n')

    async def test_cancellation_cleans_the_process_group(self):
        # Capture only the PIDs emitted by this test's own subprocess, via a Unix
        # socket because the sandbox forbids regular file writes (RLIMIT_FSIZE=0).
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / 'witness.sock')
            witness = asyncio.get_running_loop().create_future()
            async def receive(reader, writer):
                try:
                    raw = await reader.read(128)
                    witness.set_result(tuple(map(int, raw.split())))
                finally:
                    writer.close()
                    await writer.wait_closed()
            server = await asyncio.start_unix_server(receive, path=path)
            code = ('import socket,subprocess,sys,time,os;'
                'p=subprocess.Popen([sys.executable,"-I","-c","import time;time.sleep(30)"],'
                'stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);'
                f's=socket.socket(socket.AF_UNIX);s.connect({path!r});'
                's.sendall((str(os.getpid())+" "+str(p.pid)).encode());s.close();time.sleep(30)')
            task = asyncio.create_task(self.run_code(code, timeout=15))
            try:
                owned = await asyncio.wait_for(witness, timeout=5)
                self.assertEqual(len(owned), 2)
                task.cancel()
                with self.assertRaises(asyncio.CancelledError): await task
                for pid in owned:
                    for _ in range(50):
                        status = Path(f'/proc/{pid}/stat')
                        if not status.exists() or status.read_text().split(') ')[1].startswith('Z'): break
                        await asyncio.sleep(0.02)
                    else: self.fail('owned descendant survived cancellation')
            finally:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
                server.close()
                await server.wait_closed()

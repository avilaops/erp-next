"""Private Unix supervisor. PDF and ASN.1 parsing occurs only in the bounded child."""
import asyncio
import math
import os
from pathlib import Path
import socket
import stat
import struct
import sys

from .sandbox import run_bounded

GATEWAY_UID = 10001
WORKER_UID = 10002
CHANNEL_GID = 10001
_MAGIC = b'AVILA-CVW1\n'
_STAGES = {'discover': b'D', 'validate': b'V'}
HEADER_SIZE = len(_MAGIC)+9
REQUEST_MAX = 120*1024*1024
RESULT_MAX = 40*1024*1024


class WorkerError(ValueError):
    def __init__(self): super().__init__('validation_worker_failed')


def encode_header(stage, size):
    if stage not in _STAGES or type(size) is not int or not 0 < size <= REQUEST_MAX:
        raise WorkerError()
    return _MAGIC+_STAGES[stage]+struct.pack('>Q', size)


def decode_header(raw):
    if (not isinstance(raw, bytes) or len(raw) != HEADER_SIZE or not raw.startswith(_MAGIC)
        or raw[len(_MAGIC):len(_MAGIC)+1] not in _STAGES.values()):
        raise WorkerError()
    stage = next(name for name, code in _STAGES.items() if code == raw[len(_MAGIC):len(_MAGIC)+1])
    size = struct.unpack('>Q', raw[-8:])[0]
    if not 0 < size <= REQUEST_MAX: raise WorkerError()
    return stage, size


def peer_uid(channel):
    if sys.platform != 'linux': raise WorkerError()
    try:
        _, uid, _ = struct.unpack('3i', channel.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        return uid
    except (OSError, AttributeError, struct.error):
        raise WorkerError() from None


def require_worker_isolation():
    if sys.platform != 'linux': raise WorkerError()
    try:
        if (os.geteuid() != WORKER_UID or os.getegid() != CHANNEL_GID
            or {name for _, name in socket.if_nameindex()} != {'lo'}
            or not os.statvfs('/').f_flag & os.ST_RDONLY):
            raise WorkerError()
    except OSError:
        raise WorkerError() from None


async def _close(writer):
    writer.close()
    try:
        async with asyncio.timeout(1): await writer.wait_closed()
    except (OSError, TimeoutError): pass


async def _write(writer, raw):
    for offset in range(0, len(raw), 65536):
        writer.write(raw[offset:offset+65536])
        await writer.drain()


class WorkerServer:
    def __init__(self, path, config_root):
        self.path, self.config_root = Path(path), Path(config_root)
        if (not self.path.is_absolute() or self.path.name != 'validator.sock'
            or not self.config_root.is_absolute()): raise WorkerError()
        self.active = False
        self.tasks = set()

    async def handle_client(self, reader, writer):
        task = asyncio.current_task()
        self.tasks.add(task)
        admitted = False
        owned = []
        try:
            if self.active or peer_uid(writer.get_extra_info('socket')) != GATEWAY_UID:
                async with asyncio.timeout(1): await _write(writer, b'N')
                return
            self.active = admitted = True
            async with asyncio.timeout(2):
                stage, size = decode_header(await reader.readexactly(HEADER_SIZE))
                await _write(writer, b'Y')
            async with asyncio.timeout(5): packet = await reader.readexactly(size)
            process = asyncio.create_task(run_bounded((sys.executable, '-I', '-m', 'contract_signature_service.child', stage),
                packet, timeout=15, output_limit=RESULT_MAX, profile='pdf',
                extra_env={'VALIDATOR_CONFIG_ROOT': str(self.config_root)}))
            disconnected = asyncio.create_task(reader.read(1))
            owned = [process, disconnected]
            done, _ = await asyncio.wait(owned, return_when=asyncio.FIRST_COMPLETED)
            if disconnected in done: raise WorkerError()
            output = process.result()
            async with asyncio.timeout(10):
                await _write(writer, b'Y'+struct.pack('>Q', len(output)))
                await _write(writer, output)
        except (OSError, ValueError, TimeoutError, asyncio.IncompleteReadError):
            # No third-party diagnostic, certificate, path or PDF data crosses this boundary.
            try:
                async with asyncio.timeout(1): await _write(writer, b'N')
            except (OSError, TimeoutError): pass
        finally:
            for owned_task in owned:
                if not owned_task.done(): owned_task.cancel()
            await asyncio.gather(*owned, return_exceptions=True)
            if admitted: self.active = False
            self.tasks.discard(task)
            await _close(writer)

    async def serve_forever(self):
        require_worker_isolation()
        import fcntl
        directory, lock, server, owned_inode = None, None, None, None
        try:
            directory = os.open(self.path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            info = os.fstat(directory)
            if (info.st_uid != WORKER_UID or info.st_gid != CHANNEL_GID
                or stat.S_IMODE(info.st_mode) != 0o750): raise WorkerError()
            lock = os.open('.supervisor.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600, dir_fd=directory)
            locked = os.fstat(lock)
            if not stat.S_ISREG(locked.st_mode) or locked.st_uid != WORKER_UID or locked.st_nlink != 1:
                raise WorkerError()
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            try:
                previous = os.stat(self.path.name, dir_fd=directory, follow_symlinks=False)
            except FileNotFoundError: pass
            else:
                if not stat.S_ISSOCK(previous.st_mode) or previous.st_uid != WORKER_UID: raise WorkerError()
                os.unlink(self.path.name, dir_fd=directory)
            server = await asyncio.start_unix_server(self.handle_client, path=str(self.path),
                                                     limit=65536, backlog=1, start_serving=False)
            os.chmod(self.path.name, 0o660, dir_fd=directory, follow_symlinks=False)
            owned_inode = os.stat(self.path.name, dir_fd=directory, follow_symlinks=False).st_ino
            await server.serve_forever()
        except OSError:
            raise WorkerError() from None
        finally:
            if server is not None:
                server.close()
                await server.wait_closed()
            pending = tuple(self.tasks)
            for task in pending: task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            if owned_inode is not None:
                try:
                    present = os.stat(self.path.name, dir_fd=directory, follow_symlinks=False)
                    if stat.S_ISSOCK(present.st_mode) and present.st_ino == owned_inode:
                        os.unlink(self.path.name, dir_fd=directory)
                except FileNotFoundError: pass
            if lock is not None: os.close(lock)
            if directory is not None: os.close(directory)


class WorkerClient:
    def __init__(self, path, config):
        self.path, self.config = Path(path), config
        if not self.path.is_absolute(): raise WorkerError()

    async def call(self, stage, frame, authenticated, evidence, *, timeout=15):
        from .ipc import decode_result, encode_job
        if (sys.platform != 'linux' or type(timeout) not in (int, float)
            or not math.isfinite(timeout) or not 0 < timeout <= 38): raise WorkerError()
        writer = None
        try:
            packet = encode_job(stage, frame, authenticated, evidence)
            async with asyncio.timeout(timeout):
                reader, writer = await asyncio.open_unix_connection(str(self.path), limit=65536)
                if peer_uid(writer.get_extra_info('socket')) != WORKER_UID: raise WorkerError()
                await _write(writer, encode_header(stage, len(packet)))
                if await reader.readexactly(1) != b'Y': raise WorkerError()
                await _write(writer, packet)
                if await reader.readexactly(1) != b'Y': raise WorkerError()
                size = struct.unpack('>Q', await reader.readexactly(8))[0]
                if not 0 < size <= RESULT_MAX: raise WorkerError()
                result = await reader.readexactly(size)
                return decode_result(result, authenticated, self.config, stage=stage)
        except (OSError, ValueError, TimeoutError, asyncio.IncompleteReadError):
            raise WorkerError() from None
        finally:
            if writer is not None: await _close(writer)

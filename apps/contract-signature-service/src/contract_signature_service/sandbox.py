"""Owned, bounded Linux subprocesses. Never receive a command or environment from HTTP."""
import asyncio
from dataclasses import dataclass
import math
import os
from pathlib import Path
import signal
import sys
from types import MappingProxyType


@dataclass(frozen=True)
class ResourceProfile:
    cpu: tuple[int, int]
    address_space: int
    wall_seconds: int


PROFILES = MappingProxyType({'pdf': ResourceProfile((10, 12), 768*1024*1024, 15),
                             'network': ResourceProfile((5, 6), 512*1024*1024, 3)})


class SandboxError(ValueError):
    def __init__(self, code='validation_process_failed'):
        allowed = {'validation_process_failed', 'validation_process_timeout', 'validation_output_limit',
                   'validation_platform_unsupported', 'invalid_process_configuration'}
        super().__init__(code if code in allowed else 'validation_process_failed')


async def run_bounded(command, input_data, *, timeout, output_limit, profile, extra_env=None):
    if (not isinstance(profile, str) or profile not in PROFILES
        or type(timeout) not in (int, float) or not math.isfinite(timeout)
        or not 0 < timeout <= PROFILES[profile].wall_seconds
        or type(output_limit) is not int or not 0 < output_limit <= 40*1024*1024
        or not isinstance(input_data, bytes) or len(input_data) > 120*1024*1024
        or not isinstance(command, (tuple, list)) or not command
        or any(not isinstance(value, str) or '\x00' in value for value in command)
        or not Path(command[0]).is_absolute()):
        raise SandboxError('invalid_process_configuration')
    extra_env = {} if extra_env is None else extra_env
    if (type(extra_env) is not dict or set(extra_env)-{'VALIDATOR_CONFIG_ROOT'}
        or any(not isinstance(value, str) or not value or len(value) > 4096 or '\x00' in value
               for value in extra_env.values())):
        raise SandboxError('invalid_process_configuration')
    if sys.platform != 'linux':
        raise SandboxError('validation_platform_unsupported')
    environment = {'PATH': os.defpath, 'LANG': 'C.UTF-8', 'PYTHONNOUSERSITE': '1',
                   'PYTHONDONTWRITEBYTECODE': '1', 'PYTHONUNBUFFERED': '1', **extra_env}
    process, tasks = None, []
    try:
        process = await asyncio.create_subprocess_exec(sys.executable, '-I', '-m',
            'contract_signature_service.limit_exec', profile, *command,
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL, start_new_session=True, env=environment)

        async def send():
            for start in range(0, len(input_data), 65536):
                process.stdin.write(input_data[start:start+65536])
                await process.stdin.drain()
            process.stdin.close()
            await process.stdin.wait_closed()

        async def receive():
            output = bytearray()
            while chunk := await process.stdout.read(min(65536, output_limit-len(output)+1)):
                output.extend(chunk)
                if len(output) > output_limit:
                    raise SandboxError('validation_output_limit')
            return bytes(output)

        async with asyncio.timeout(timeout):
            tasks = [asyncio.create_task(send()), asyncio.create_task(receive()),
                     asyncio.create_task(process.wait())]
            await asyncio.gather(*tasks)
            if process.returncode != 0:
                raise SandboxError()
            return tasks[1].result()
    except TimeoutError:
        raise SandboxError('validation_process_timeout') from None
    except (OSError, ConnectionError):
        raise SandboxError() from None
    finally:
        if process is not None:
            # PID/group comes only from our start_new_session subprocess handle.
            # Also kill descendants if the leader exits before they do.
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            for task in tasks:
                if not task.done(): task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            await process.wait()

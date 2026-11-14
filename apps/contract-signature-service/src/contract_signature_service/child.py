"""Fixed offline parser entry point. Binary stdout only; no secrets or diagnostics."""
import os
from pathlib import Path
import sys


def main():
    try:
        if sys.platform != 'linux' or len(sys.argv) != 2 or sys.argv[1] not in ('discover', 'validate'):
            return 78
        from .config import load_config
        from .engine import run_engine
        from .ipc import REQUEST_MAX, decode_job, encode_result
        config = load_config(Path(os.environ.get('VALIDATOR_CONFIG_ROOT', '/config/public')))
        packet = sys.stdin.buffer.read(REQUEST_MAX+1)
        context, evidence = decode_job(packet, config, stage=sys.argv[1])
        result = run_engine(sys.argv[1], context, evidence, config)
        sys.stdout.buffer.write(encode_result(sys.argv[1], result, context))
        sys.stdout.buffer.flush()
        return 0
    except Exception:
        return 78


if __name__ == '__main__':
    raise SystemExit(main())

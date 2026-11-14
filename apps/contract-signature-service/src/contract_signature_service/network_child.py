"""Fixed public evidence fetcher. No PDF parser, private key or inherited credentials."""
import sys
import time


def main():
    try:
        if sys.platform != 'linux' or len(sys.argv) != 1: return 78
        from .collector import JOB_MAX, decode_fetch_job
        from .egress import fetch_one
        target, policy = decode_fetch_job(sys.stdin.buffer.read(JOB_MAX+1))
        result = fetch_one(target, policy, deadline=time.monotonic()+3)
        sys.stdout.buffer.write(result)
        sys.stdout.buffer.flush()
        return 0
    except Exception:
        return 78


if __name__ == '__main__': raise SystemExit(main())

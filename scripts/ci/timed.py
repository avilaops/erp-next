#!/usr/bin/env python3
"""Execute a command, preserve its exit status and append measured wall-clock time."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--label', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command:
        parser.error('A command is required after --')
    label = ' '.join(args.label.split())[:200]
    started_at = datetime.now(timezone.utc).isoformat()
    started = time.perf_counter()
    try:
        status = subprocess.run(command, check=False).returncode
        if status < 0:
            status = 128 - status
    except FileNotFoundError:
        status = 127
    except OSError:
        status = 126
    except KeyboardInterrupt:
        status = 130
    elapsed = round(time.perf_counter() - started, 6)
    record = {'label': label, 'startedAt': started_at, 'durationSeconds': elapsed,
              'exitCode': status, 'job': os.environ.get('GITHUB_JOB'),
              'runId': os.environ.get('GITHUB_RUN_ID'), 'attempt': os.environ.get('GITHUB_RUN_ATTEMPT')}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    try:
        os.write(descriptor, (json.dumps(record, ensure_ascii=False) + '\n').encode('utf-8'))
    finally:
        os.close(descriptor)
    print(f'{label}: {elapsed:.3f} s (exit={status})', flush=True)
    if summary := os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(summary, 'a', encoding='utf-8') as output:
            output.write(f'- {label.replace(chr(96), "").replace(chr(124), "/")}: **{elapsed:.3f} s**, exit `{status}`\n')
    return status


if __name__ == '__main__':
    raise SystemExit(main())

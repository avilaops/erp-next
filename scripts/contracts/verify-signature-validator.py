#!/usr/bin/env python3
"""Exercise the actual wheel with networking denied; synthetic keys stay in tests."""
import argparse
from pathlib import Path
import socket
import sys
import tarfile
import unittest
import zipfile
import zipimport

ROOT = Path(__file__).resolve().parents[2]
SOCKET_SOURCE = Path(socket.__file__).resolve()


def deny_network(event, args):
    if event in ('socket.getaddrinfo', 'socket.gethostbyname', 'socket.gethostbyaddr',
                 'socket.getnameinfo', 'socket.sendto'):
        raise RuntimeError('Network access is forbidden in the offline validation corpus')
    if event == 'socket.connect':
        # Windows asyncio constructs its self-pipe with this exact stdlib routine.
        # No general exception for local connections or caller-controlled hostnames.
        frame = sys._getframe(1)
        if (sys.platform == 'win32' and frame.f_code.co_name == '_fallback_socketpair'
            and Path(frame.f_code.co_filename).resolve() == SOCKET_SOURCE
            and isinstance(args[1], tuple) and args[1][0] in ('127.0.0.1', '::1')):
            return
        raise RuntimeError('Network access is forbidden in the offline validation corpus')


def verify_archives(directory):
    wheel, = directory.glob('*.whl')
    sdist, = directory.glob('*.tar.gz')
    with zipfile.ZipFile(wheel) as archive:
        names = archive.namelist()
        if 'contract_signature_validator/trust_registry.json' not in names:
            raise ValueError('The wheel is missing its pinned public trust registry')
        for name in names:
            if ('tests' in Path(name).parts or '__pycache__' in name
                or name.endswith(('.key', '.pfx', '.p12', '.pem', '.der'))):
                raise ValueError('The wheel contains test fixtures or private material')
    with tarfile.open(sdist) as archive:
        for name in archive.getnames():
            if ('tests' in Path(name).parts or '.venv' in Path(name).parts
                or name.endswith(('.key', '.pfx', '.p12', '.pem', '.der'))):
                raise ValueError('The source archive contains fixtures or private material')
    return wheel


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', required=True, type=Path)
    args = parser.parse_args()
    wheel = verify_archives(args.directory.resolve())
    sys.addaudithook(deny_network)
    sys.path.insert(0, str(wheel))
    import contract_signature_validator
    if not isinstance(contract_signature_validator.__loader__, zipimport.zipimporter):
        raise RuntimeError('The corpus must import the built wheel, not the source checkout')
    suite = unittest.TestLoader().discover(str(ROOT / 'apps/contract-signature-validator/tests'), pattern='test_*.py')
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    if not result.wasSuccessful():
        return 1
    print('Verified wheel import, offline corpus, pinned public registry and fixture exclusion.')
    return 0


if __name__ == '__main__':
    sys.exit(main())

import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


class OfflineVerifierTests(unittest.TestCase):
    def test_guard_blocks_dns_datagrams_and_connections_even_to_loopback(self):
        spec = importlib.util.spec_from_file_location('signature_verifier', ROOT / 'scripts/contracts/verify-signature-validator.py')
        verifier = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(verifier)
        for event, args in (('socket.getaddrinfo', ('example.test', 443)),
                            ('socket.gethostbyname', ('example.test',)),
                            ('socket.sendto', (None, b'x', ('203.0.113.1', 53))),
                            ('socket.connect', (None, ('203.0.113.1', 443))),
                            ('socket.connect', (None, ('127.0.0.1', 443)))):
            with self.subTest(event=event, args=args):
                with self.assertRaises(RuntimeError):
                    verifier.deny_network(event, args)

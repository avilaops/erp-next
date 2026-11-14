import io
import socket
import ssl
import time
import unittest
from unittest.mock import patch

from helpers import load


PUBLIC = '93.184.216.34'


class FakeSocket:
    def __init__(self, response=b'HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\nder', peer=PUBLIC, peer_port=None):
        self.response, self.peer, self.sent, self.closed = response, peer, b'', False
        self.connections, self.timeouts = [], []
        self.peer_port = peer_port

    def settimeout(self, timeout):
        self.timeouts.append(timeout)

    def connect(self, address):
        self.connections.append(address)

    def getpeername(self):
        return self.peer, self.peer_port or self.connections[-1][1]

    def sendall(self, value):
        self.sent += value

    def makefile(self, *args, **kwargs):
        return io.BytesIO(self.response)

    def close(self):
        self.closed = True


class EgressTests(unittest.TestCase):
    def setUp(self):
        self.api = load(self, 'egress')
        self.policy = self.api.NetworkPolicy({
            'http://crl.example.com': ('/public/',),
            'https://ocsp.example.com': ('/status',),
        })

    def target(self, url='http://crl.example.com/public/a.crl', kind='crls', body=b''):
        return self.api.FetchTarget(kind, url, body)

    def address(self, ip=PUBLIC, family=socket.AF_INET):
        return [(family, socket.SOCK_STREAM, socket.IPPROTO_TCP, '', (ip, 80))]

    def fetch(self, target=None, sock=None):
        sock = sock or FakeSocket()
        with patch.object(self.api.socket, 'getaddrinfo', return_value=self.address()), \
             patch.object(self.api.socket, 'socket', return_value=sock):
            result = self.api.fetch_one(target or self.target(), self.policy, deadline=time.monotonic()+3)
        return result, sock

    def test_only_reviewed_origins_and_prefixes_can_be_approved(self):
        accepted = self.policy.approve(self.target())
        self.assertEqual((accepted.host, accepted.port, accepted.path), ('crl.example.com', 80, '/public/a.crl'))
        for url in ('http://other.example.com/public/a.crl', 'http://crl.example.com/private/a.crl',
                    'http://user:pass@crl.example.com/public/a.crl', 'http://crl.example.com:8080/public/a.crl',
                    'http://crl.example.com/public/../secret', 'http://crl.example.com/public/%2e%2e/secret',
                    'http://crl.example.com/public/a?token=x', 'http://crl.example.com/public/a#x',
                    'http://crl.example.com/public//a', 'http://127.0.0.1/public/a',
                    'file:///etc/passwd', 'ldap://crl.example.com/public/a',
                    'http://crl.example.com\\@127.0.0.1/public/a', 'http://crl.example.com/public/\r\nx'):
            with self.subTest(url=url), self.assertRaises(self.api.EgressError):
                self.policy.approve(self.target(url))
        with self.assertRaises(ValueError):
            self.api.NetworkPolicy({'http://127.0.0.1': ('/',)})

    def test_dns_must_be_entirely_public_including_ipv6_transition_cases(self):
        blocked = ('127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.0.1', '169.254.169.254',
                   '100.64.0.1', '0.0.0.0', '224.0.0.1', '192.0.2.1', '::1', 'fc00::1',
                   'fe80::1', 'ff0e::1', '2001:db8::1', '::ffff:93.184.216.34',
                   '64:ff9b::a00:1', '2002:0a00:0001::1', '2001:0000:4136:e378:8000:63bf:3fff:fdd2')
        for ip in blocked:
            family = socket.AF_INET6 if ':' in ip else socket.AF_INET
            with self.subTest(ip=ip), patch.object(self.api.socket, 'getaddrinfo',
                    return_value=self.address()+self.address(ip, family)), self.assertRaises(self.api.EgressError):
                self.api.resolve_public('crl.example.com', 80)
        with patch.object(self.api.socket, 'getaddrinfo', return_value=self.address()):
            self.assertEqual(self.api.resolve_public('crl.example.com', 80), ((socket.AF_INET, PUBLIC),))
        with patch.object(self.api.socket, 'getaddrinfo', return_value=self.address('2606:4700:4700::1111', socket.AF_INET6)):
            self.assertEqual(self.api.resolve_public('crl.example.com', 80)[0][0], socket.AF_INET6)

    def test_socket_is_pinned_peer_is_checked_and_proxies_are_not_used(self):
        result, sock = self.fetch()
        self.assertEqual(result, b'der')
        self.assertEqual(sock.connections, [(PUBLIC, 80)])
        self.assertIn(b'Host: crl.example.com\r\n', sock.sent)
        self.assertIn(b'Accept-Encoding: identity\r\n', sock.sent)
        self.assertTrue(sock.closed)
        with self.assertRaises(self.api.EgressError):
            self.fetch(sock=FakeSocket(peer='127.0.0.1'))
        with self.assertRaises(self.api.EgressError):
            self.fetch(sock=FakeSocket(peer_port=443))
        with patch.dict('os.environ', {'HTTP_PROXY': 'http://127.0.0.1:9999', 'HTTPS_PROXY': 'http://127.0.0.1:9999'}):
            self.assertEqual(self.fetch()[0], b'der')

    def test_https_preserves_hostname_verification_and_ocsp_body(self):
        context, sock = ssl.create_default_context(), FakeSocket()
        target = self.target('https://ocsp.example.com/status', 'ocsps', b'synthetic-ocsp-request')
        answers = [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, '', (PUBLIC, 443))]
        with patch.object(self.api.socket, 'getaddrinfo', return_value=answers), \
             patch.object(self.api.socket, 'socket', return_value=sock), \
             patch.object(self.api.ssl, 'create_default_context', return_value=context), \
             patch.object(context, 'wrap_socket', return_value=sock) as wrap:
            self.assertEqual(self.api.fetch_one(target, self.policy, deadline=time.monotonic()+3), b'der')
        wrap.assert_called_once_with(sock, server_hostname='ocsp.example.com')
        self.assertTrue(context.check_hostname)
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        self.assertGreaterEqual(context.minimum_version, ssl.TLSVersion.TLSv1_2)
        self.assertIn(b'POST /status HTTP/1.1\r\n', sock.sent)
        self.assertTrue(sock.sent.endswith(b'synthetic-ocsp-request'))

    def test_redirect_compression_size_and_truncation_never_return_evidence(self):
        for response in (b'HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1/\r\nContent-Length: 0\r\n\r\n',
                         b'HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nContent-Length: 3\r\n\r\nder',
                         b'HTTP/1.1 200 OK\r\nContent-Length: 8388609\r\n\r\n',
                         b'HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nder',
                         b'HTTP/1.1 404 Not Found\r\nContent-Length: 3\r\n\r\nder'):
            with self.subTest(response=response[:30]), self.assertRaises(self.api.EgressError):
                self.fetch(sock=FakeSocket(response))
        response = b'HTTP/1.1 200 OK\r\nContent-Length: 262145\r\n\r\n'
        with self.assertRaises(self.api.EgressError):
            self.fetch(target=self.target(kind='certificates'), sock=FakeSocket(response))

    def test_body_without_length_is_bounded_and_invalid_targets_are_private(self):
        with self.assertRaises(self.api.EgressError):
            self.fetch(sock=FakeSocket(b'HTTP/1.1 200 OK\r\n\r\n'+b'x'*(8*1024*1024+1)))
        for target in (lambda: self.target(kind='arbitrary'), lambda: self.target(body=b'not allowed'),
                       lambda: self.target('https://ocsp.example.com/status', 'ocsps', b'')):
            with self.assertRaises(self.api.EgressError):
                target()
        value = self.target()
        self.assertNotIn('example.com', repr(value))
        with self.assertRaises(self.api.EgressError) as failure:
            self.api.fetch_one(value, self.policy, deadline=time.monotonic()-1)
        self.assertNotIn('example.com', str(failure.exception))

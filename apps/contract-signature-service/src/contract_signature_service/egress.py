"""Pinned public HTTP retrieval. Run each call in a supervised 3-second process."""
from dataclasses import dataclass, field
import http.client
import ipaddress
import math
import re
import socket
import ssl
import time
from types import MappingProxyType
from urllib.parse import urlsplit

LIMITS = MappingProxyType({'certificates': 256*1024, 'crls': 8*1024*1024, 'ocsps': 256*1024})
_TRANSITION = tuple(ipaddress.ip_network(value) for value in (
    '::/96', '::ffff:0:0/96', '64:ff9b::/96', '64:ff9b:1::/48', '2002::/16', '2001::/32'))
_HOST = re.compile(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}')


class EgressError(ValueError):
    def __init__(self, code='evidence_fetch_failed'):
        allowed = {'evidence_fetch_failed', 'destination_not_approved', 'destination_not_public',
                   'evidence_size_exceeded', 'evidence_timeout', 'invalid_fetch_target'}
        super().__init__(code if code in allowed else 'evidence_fetch_failed')


def _require(condition, code='invalid_fetch_target'):
    if not condition:
        raise EgressError(code)


def _path(value):
    _require(isinstance(value, str) and value.startswith('/') and len(value) <= 2048
             and value.isascii() and all(33 <= ord(char) < 127 for char in value)
             and not any(char in value for char in '%\\?#') and '//' not in value
             and not {'.', '..'}.intersection(value.split('/')))
    return value


def _url(value):
    _require(isinstance(value, str) and 0 < len(value) <= 2048 and value.isascii()
             and all(33 <= ord(char) < 127 for char in value)
             and not any(char in value for char in '%\\?#'))
    parsed = urlsplit(value)
    host = parsed.hostname
    _require(parsed.scheme in {'http', 'https'} and value.startswith(parsed.scheme+'://')
             and isinstance(host, str) and _HOST.fullmatch(host) is not None
             and parsed.username is None and parsed.password is None)
    port = 443 if parsed.scheme == 'https' else 80
    _require(parsed.port in (None, port))
    return parsed.scheme+'://'+host, host, port, _path(parsed.path or '/')


@dataclass(frozen=True)
class FetchTarget:
    kind: str
    url: str = field(repr=False)
    body: bytes = field(default=b'', repr=False)

    def __post_init__(self):
        _require(isinstance(self.kind, str) and self.kind in LIMITS
                 and isinstance(self.body, bytes) and len(self.body) <= 4096
                 and (bool(self.body) if self.kind == 'ocsps' else not self.body))
        try:
            _url(self.url)
        except (ValueError, TypeError, AttributeError):
            raise EgressError('invalid_fetch_target') from None


@dataclass(frozen=True)
class ApprovedTarget:
    kind: str
    host: str = field(repr=False)
    port: int
    path: str = field(repr=False)
    tls: bool
    body: bytes = field(repr=False)


class NetworkPolicy:
    def __init__(self, rules):
        try:
            _require(type(rules) is dict and 1 <= len(rules) <= 64)
            validated = {}
            for origin, prefixes in rules.items():
                canonical, _, _, path = _url(origin)
                _require(origin == canonical and path == '/' and type(prefixes) is tuple
                         and 1 <= len(prefixes) <= 16)
                validated[origin] = tuple(_path(prefix) for prefix in prefixes)
            self.rules = MappingProxyType(validated)
        except (ValueError, TypeError, AttributeError):
            raise ValueError('invalid_network_policy') from None

    def __repr__(self):
        return f'NetworkPolicy(origins={len(self.rules)})'

    def approve(self, target):
        try:
            _require(isinstance(target, FetchTarget))
            origin, host, port, path = _url(target.url)
            prefixes = self.rules.get(origin, ())
            _require(any(path == prefix or (prefix.endswith('/') and path.startswith(prefix))
                         for prefix in prefixes), 'destination_not_approved')
            return ApprovedTarget(target.kind, host, port, path, origin.startswith('https:'), target.body)
        except (ValueError, TypeError, AttributeError):
            raise EgressError('destination_not_approved') from None


def _public(value):
    try:
        _require(isinstance(value, str) and '%' not in value, 'destination_not_public')
        address = ipaddress.ip_address(value)
        _require(address.is_global and not (address.is_multicast or address.is_reserved
                 or address.is_unspecified or address.is_loopback or address.is_link_local
                 or address.is_private), 'destination_not_public')
        if address.version == 6:
            _require(not address.is_site_local and not any(address in net for net in _TRANSITION),
                     'destination_not_public')
        return str(address)
    except (ValueError, TypeError, AttributeError):
        raise EgressError('destination_not_public') from None


def resolve_public(host, port):
    try:
        answers = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM, proto=socket.IPPROTO_TCP)
        _require(0 < len(answers) <= 16, 'destination_not_public')
        selected = []
        for family, kind, protocol, _, address in answers:
            _require(family in (socket.AF_INET, socket.AF_INET6) and kind == socket.SOCK_STREAM
                     and protocol == socket.IPPROTO_TCP and address[1] == port
                     and (len(address) == 2 or (len(address) == 4 and address[3] == 0)),
                     'destination_not_public')
            value = family, _public(address[0])
            if value not in selected:
                selected.append(value)
        return tuple(selected)
    except (ValueError, TypeError, OSError, IndexError):
        raise EgressError('destination_not_public') from None


def _remaining(deadline):
    remaining = deadline-time.monotonic()
    _require(remaining > 0, 'evidence_timeout')
    return min(3, remaining)


def fetch_one(target, policy, *, deadline):
    """Inactivity/byte safeguards here; the process supervisor bounds total DNS/read time."""
    raw, connection, response = None, None, None
    try:
        _require(type(deadline) in (int, float) and math.isfinite(deadline)
                 and 0 < deadline-time.monotonic() <= 3.001, 'evidence_timeout')
        approved = policy.approve(target)
        family, address = resolve_public(approved.host, approved.port)[0]
        raw = socket.socket(family, socket.SOCK_STREAM, socket.IPPROTO_TCP)
        raw.settimeout(_remaining(deadline))
        endpoint = (address, approved.port) if family == socket.AF_INET else (address, approved.port, 0, 0)
        raw.connect(endpoint)
        peer = raw.getpeername()
        _require(_public(peer[0]) == address and peer[1] == approved.port, 'destination_not_public')
        stream = raw
        if approved.tls:
            context = ssl.create_default_context(purpose=ssl.Purpose.SERVER_AUTH)
            context.minimum_version = ssl.TLSVersion.TLSv1_2
            context.set_alpn_protocols(['http/1.1'])
            stream = context.wrap_socket(raw, server_hostname=approved.host)
            peer = stream.getpeername()
            _require(_public(peer[0]) == address and peer[1] == approved.port, 'destination_not_public')
        stream.settimeout(_remaining(deadline))
        connection = http.client.HTTPConnection(approved.host, approved.port, timeout=_remaining(deadline))
        connection.sock = stream  # Already connected to the verified numeric IP; never resolve again.
        connection.putrequest('POST' if approved.kind == 'ocsps' else 'GET', approved.path,
                              skip_host=True, skip_accept_encoding=True)
        for name, value in (('Host', approved.host), ('Accept-Encoding', 'identity'),
                            ('User-Agent', 'Avila-Contract-Evidence/1'), ('Connection', 'close')):
            connection.putheader(name, value)
        if approved.kind == 'ocsps':
            connection.putheader('Content-Type', 'application/ocsp-request')
            connection.putheader('Content-Length', str(len(approved.body)))
        connection.endheaders(approved.body if approved.body else None)
        response = connection.getresponse()
        _require(response.status == 200 and response.getheader('Content-Encoding', 'identity').lower() == 'identity',
                 'evidence_fetch_failed')
        lengths = response.msg.get_all('Content-Length', [])
        transfer = response.msg.get_all('Transfer-Encoding', [])
        _require(len(lengths) <= 1 and len(transfer) <= 1 and not (lengths and transfer)
                 and (not transfer or transfer[0].lower() == 'chunked'))
        expected = None
        if lengths:
            _require(re.fullmatch(r'[0-9]{1,9}', lengths[0]) is not None)
            expected = int(lengths[0])
            _require(0 < expected <= LIMITS[approved.kind], 'evidence_size_exceeded')
        chunks, size = [], 0
        while True:
            stream.settimeout(_remaining(deadline))
            chunk = response.read1(min(65536, LIMITS[approved.kind]-size+1))
            if not chunk:
                break
            size += len(chunk)
            _require(size <= LIMITS[approved.kind], 'evidence_size_exceeded')
            chunks.append(chunk)
        _require(size > 0 and (expected is None or size == expected))
        return b''.join(chunks)
    except EgressError:
        raise
    except (ValueError, TypeError, OSError, http.client.HTTPException, AttributeError):
        raise EgressError() from None
    finally:
        if response is not None:
            response.close()
        if connection is not None:
            connection.close()
        if raw is not None:
            raw.close()

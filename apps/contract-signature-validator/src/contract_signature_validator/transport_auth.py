"""Dedicated internal HMAC authentication. Not a personal/ICP signature or replay store."""
from dataclasses import dataclass, field
from datetime import datetime, timezone
import hashlib
import hmac
import re
from types import MappingProxyType
from uuid import UUID

from . import transport
from .model import _utc

CONTENT_TYPE = 'application/vnd.avila.contract-validation+octet-stream;version=1'
_KEY_ID = re.compile(r'[a-z0-9][a-z0-9_-]{0,31}')


class AuthenticationError(ValueError):
    def __init__(self):
        super().__init__('unauthorized')


def _require(condition):
    if not condition:
        raise AuthenticationError()


@dataclass(frozen=True)
class HeaderAuthorization:
    operation: str
    request_id: UUID
    content_sha256: str
    content_length: int
    key_id: str
    observed_at: datetime
    sent_at: datetime


@dataclass(frozen=True)
class AuthenticatedRequest:
    request: transport.ValidationRequest = field(repr=False)
    observed_at: datetime
    key_id: str
    request_sha256: str
    sent_at: datetime

    def __post_init__(self):
        _require(isinstance(self.request, transport.ValidationRequest))
        _utc(self.observed_at)
        _utc(self.sent_at)
        _require(isinstance(self.key_id, str) and _KEY_ID.fullmatch(self.key_id) is not None)
        _require(isinstance(self.request_sha256, str)
                 and re.fullmatch(r'[0-9a-f]{64}', self.request_sha256) is not None)


def _headers(items):
    _require(isinstance(items, (list, tuple)) and len(items) <= 32)
    result, size = {}, 0
    for item in items:
        _require(isinstance(item, (list, tuple)) and len(item) == 2)
        name, value = item
        _require(isinstance(name, str) and re.fullmatch(r'[A-Za-z0-9-]+', name) is not None
                 and isinstance(value, str) and value.isascii()
                 and all(32 <= ord(char) < 127 for char in value))
        size += len(name)+len(value)+4
        _require(size <= 16*1024 and name.lower() not in result)
        result[name.lower()] = value
    _require('transfer-encoding' not in result and 'content-encoding' not in result)
    return result


def _message(target, key_id, timestamp, request_id, digest, size):
    return ('AVILA-CV-AUTH/1\nPOST\n' + '\n'.join(
        (target, key_id, timestamp, str(request_id), digest, str(size))) + '\n').encode('ascii')


class TransportAuthenticator:
    def __init__(self, keys):
        if (type(keys) is not dict or not 1 <= len(keys) <= 2
            or any(not isinstance(name, str) or _KEY_ID.fullmatch(name) is None
                   or not isinstance(key, bytes) or not 32 <= len(key) <= 64
                   for name, key in keys.items())):
            raise ValueError('invalid_service_keys')
        self._keys = MappingProxyType(dict(keys))

    def headers_for(self, body, *, operation, request_id, key_id, sent_at):
        try:
            _utc(sent_at)
            _require(isinstance(body, bytes) and 0 < len(body) <= transport.FRAME_MAX_BYTES
                     and isinstance(operation, str) and operation in transport.TARGETS
                     and isinstance(request_id, UUID) and request_id.int != 0
                     and key_id in self._keys)
            timestamp, digest = str(int(sent_at.timestamp())), hashlib.sha256(body).hexdigest()
            mac = hmac.digest(self._keys[key_id], _message(transport.TARGETS[operation], key_id,
                              timestamp, request_id, digest, len(body)), 'sha256').hex()
            return {'authorization': f'HMAC-SHA256 {key_id}:{mac}',
                    'content-type': CONTENT_TYPE, 'content-length': str(len(body)),
                    'x-validation-time': timestamp, 'x-validation-request-id': str(request_id),
                    'x-validation-content-sha256': digest}
        except (ValueError, TypeError, KeyError, OverflowError, AttributeError):
            raise AuthenticationError() from None

    def authorize_headers(self, headers, *, method, target, now):
        """Use before reading a body; repeat verification in decode_request after streaming."""
        try:
            _utc(now)
            _require(method == 'POST' and isinstance(target, str) and target in transport.TARGETS.values())
            values = _headers(headers)
            _require(values['content-type'] == CONTENT_TYPE)
            authorization = re.fullmatch(r'HMAC-SHA256 ([a-z0-9][a-z0-9_-]{0,31}):([0-9a-f]{64})',
                                         values['authorization'])
            _require(authorization is not None)
            key_id, received = authorization.groups()
            _require(key_id in self._keys)
            stamp, size, digest = (values['x-validation-time'], values['content-length'],
                                   values['x-validation-content-sha256'])
            _require(re.fullmatch(r'[1-9][0-9]{0,11}', stamp) is not None
                     and re.fullmatch(r'[1-9][0-9]{0,8}', size) is not None
                     and re.fullmatch(r'[0-9a-f]{64}', digest) is not None)
            _require(-5 <= now.timestamp()-int(stamp) <= 60
                     and int(size) <= transport.FRAME_MAX_BYTES)
            request_id = UUID(values['x-validation-request-id'])
            _require(request_id.int != 0 and str(request_id) == values['x-validation-request-id'])
            expected = hmac.digest(self._keys[key_id], _message(target, key_id, stamp,
                                   request_id, digest, int(size)), 'sha256').hex()
            _require(hmac.compare_digest(expected, received))
            operation = next(name for name, path in transport.TARGETS.items() if path == target)
            return HeaderAuthorization(operation, request_id, digest, int(size), key_id, now,
                                       datetime.fromtimestamp(int(stamp), timezone.utc))
        except (ValueError, TypeError, KeyError, OverflowError, AttributeError):
            raise AuthenticationError() from None

    def decode_request(self, body, headers, *, method, target, now,
                       policy_sha256, trust_bundle_sha256):
        authorized = self.authorize_headers(headers, method=method, target=target, now=now)
        _require(isinstance(body, bytes) and len(body) == authorized.content_length
                 and hmac.compare_digest(hashlib.sha256(body).hexdigest(), authorized.content_sha256))
        request = transport.decode_request(body, operation=authorized.operation,
            request_id=authorized.request_id, policy_sha256=policy_sha256,
            trust_bundle_sha256=trust_bundle_sha256)
        return AuthenticatedRequest(request, authorized.observed_at, authorized.key_id,
                                    authorized.content_sha256, authorized.sent_at)

    def response_mac(self, body, authenticated):
        _require(isinstance(body, bytes) and isinstance(authenticated, AuthenticatedRequest)
                 and authenticated.key_id in self._keys)
        message = ('AVILA-CV-RESPONSE/1\n' + '\n'.join((authenticated.key_id,
            str(authenticated.request.request_id), authenticated.request_sha256,
            hashlib.sha256(body).hexdigest(), str(len(body)))) + '\n').encode('ascii')
        return hmac.digest(self._keys[authenticated.key_id], message, 'sha256').hex()

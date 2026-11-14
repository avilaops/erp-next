"""Authenticated result and exact offline material; no persistence or PDF/DER parsing."""
from dataclasses import dataclass, field, replace
from datetime import datetime
import hashlib
import hmac
import re
import struct

from asn1crypto import pem
from contract_signature_validator.model import EvidenceSet
from contract_signature_validator.report import canonical_preflight_bytes, canonical_report_bytes
from contract_signature_validator.transport import canonical_json, strict_json
from contract_signature_validator.transport_auth import AuthenticationError, _headers
from contract_signature_validator.transport_response import encode_response, seal_response, verify_response
from contract_signature_validator.trust import load_trust_bundle

MAGIC = b'AVILA-CVB1\n'
CONTENT_TYPE = 'application/vnd.avila.contract-validation-bundle;version=1'
MAX_BYTES = 40*1024*1024
_HEADER_MAX = 32*1024
_LIMITS = {'report': 256*1024, 'rootsPem': 4*1024*1024, 'intermediatesPem': 4*1024*1024,
           'certificates': 256*1024, 'crls': 8*1024*1024, 'ocsps': 256*1024}
_COUNTS = {'certificates': 64, 'crls': 16, 'ocsps': 16}


class BundleError(ValueError):
    def __init__(self):
        super().__init__('invalid_validation_bundle')


def _require(condition):
    if not condition:
        raise BundleError()


def _digest(value):
    return hashlib.sha256(value).hexdigest()


def _keys(value, expected):
    _require(type(value) is dict and set(value) == set(expected))


@dataclass(frozen=True)
class BundleResult:
    response: dict = field(repr=False)
    evidence: EvidenceSet = field(repr=False)
    trust: object = field(repr=False)
    sha256: str


def _proof(response, evidence, trust, authenticated):
    _require(trust.sha256 == authenticated.request.trust_bundle_sha256
             and response['report']['trustProfile'] == trust.profile
             and evidence.observed_at.isoformat().replace('+00:00', 'Z') == response['checkedAt'])
    available = {_digest(blob) for name in _COUNTS for blob in getattr(evidence, name)}
    required = {value for check in response['report']['checks'] for value in check['evidenceHashes']}
    _require(required <= available)


def _headers_for(body, authenticated, authenticator):
    return {'content-type': CONTENT_TYPE, 'content-length': str(len(body)),
            'x-validation-response-sha256': _digest(body),
            'x-validation-response-mac': f'HMAC-SHA256 {authenticated.key_id}:'
                                       + authenticator.response_mac(body, authenticated)}


def encode_bundle(authenticated, report, evidence, trust, authenticator):
    try:
        raw_report = encode_response(authenticated, report, trust_profile=trust.profile)
        return encode_response_bundle(authenticated, raw_report, evidence, trust, authenticator)
    except (ValueError, TypeError, KeyError, AttributeError, OverflowError):
        raise BundleError() from None


def encode_response_bundle(authenticated, raw_report, evidence, trust, authenticator):
    try:
        _require(isinstance(evidence, EvidenceSet) and evidence.observed_at == authenticated.observed_at)
        evidence = replace(evidence, **{name: tuple(sorted(set(getattr(evidence, name)))) for name in _COUNTS})
        response_headers = seal_response(raw_report, authenticated, authenticator, trust_profile=trust.profile)
        response = verify_response(raw_report, list(response_headers.items()), authenticated,
            authenticator, trust_profile=trust.profile, now=authenticated.observed_at)
        _proof(response, evidence, trust, authenticated)
        roots = b''.join(pem.armor('CERTIFICATE', value) for value in trust.root_der)
        intermediates = b''.join(pem.armor('CERTIFICATE', value) for value in trust.intermediate_der)
        _require(0 < len(roots)+len(intermediates) <= 4*1024*1024)
        material = [('report', 0, raw_report), ('rootsPem', 0, roots), ('intermediatesPem', 0, intermediates)]
        material.extend((name, index, blob) for name in _COUNTS
                        for index, blob in enumerate(getattr(evidence, name)))
        metadata = {'schemaVersion': 'avila-contract-bundle/1', 'responseHeaders': response_headers,
            'evidenceSetSha256': evidence.sha256, 'trustProfile': trust.profile,
            'parts': [{'name': name, 'index': index, 'length': len(blob), 'sha256': _digest(blob)}
                      for name, index, blob in material]}
        header = canonical_json(metadata)
        _require(len(header) <= _HEADER_MAX)
        body = b''.join((MAGIC, struct.pack('>I', len(header)), header, *(blob for _, _, blob in material)))
        _require(len(body) <= MAX_BYTES)
        return body, _headers_for(body, authenticated, authenticator)
    except (ValueError, TypeError, KeyError, AttributeError, OverflowError):
        raise BundleError() from None


def _authenticate(body, headers, authenticated, authenticator):
    try:
        if not isinstance(body, bytes) or not 0 < len(body) <= MAX_BYTES:
            raise AuthenticationError()
        values = _headers(headers)
        mac = re.fullmatch(r'HMAC-SHA256 ([a-z0-9][a-z0-9_-]{0,31}):([0-9a-f]{64})',
                           values['x-validation-response-mac'])
        if (values['content-type'] != CONTENT_TYPE or values['content-length'] != str(len(body))
            or not hmac.compare_digest(values['x-validation-response-sha256'], _digest(body))
            or mac is None or mac[1] != authenticated.key_id
            or not hmac.compare_digest(mac[2], authenticator.response_mac(body, authenticated))):
            raise AuthenticationError()
    except (ValueError, TypeError, KeyError, AttributeError):
        raise AuthenticationError() from None


def decode_bundle(body, headers, authenticated, authenticator, *, trust_profile, now):
    _authenticate(body, headers, authenticated, authenticator)
    try:
        start = len(MAGIC)+4
        _require(body.startswith(MAGIC) and len(body) > start)
        size = struct.unpack('>I', body[len(MAGIC):start])[0]
        _require(0 < size <= _HEADER_MAX and start+size < len(body))
        metadata = strict_json(body[start:start+size], max_bytes=_HEADER_MAX)
        _keys(metadata, ('schemaVersion', 'responseHeaders', 'evidenceSetSha256', 'trustProfile', 'parts'))
        _require(metadata['schemaVersion'] == 'avila-contract-bundle/1'
                 and isinstance(trust_profile, str) and trust_profile in {'icp_brasil', 'synthetic_not_icp'}
                 and metadata['trustProfile'] == trust_profile)
        _require(type(metadata['parts']) is list and 3 <= len(metadata['parts']) <= 99)
        fixed, evidence_parts = {}, {name: [] for name in _COUNTS}
        offset, current_group, snapshot_bytes, evidence_bytes = start+size, 0, 0, 0
        order = list(_COUNTS)
        for position, part in enumerate(metadata['parts']):
            _keys(part, ('name', 'index', 'length', 'sha256'))
            name, index, length = part['name'], part['index'], part['length']
            _require(isinstance(name, str) and name in _LIMITS and type(index) is int and type(length) is int
                     and 0 <= length <= _LIMITS[name] and (length > 0 or name == 'intermediatesPem'))
            if position < 3:
                _require(name == ('report', 'rootsPem', 'intermediatesPem')[position] and index == 0)
            else:
                _require(name in _COUNTS and order.index(name) >= current_group
                         and index == len(evidence_parts[name]) and index < _COUNTS[name])
                current_group = order.index(name)
            _require(offset+length <= len(body))
            blob = body[offset:offset+length]
            _require(part['sha256'] == _digest(blob))
            offset += length
            if name in _COUNTS:
                _require(blob not in evidence_parts[name])
                evidence_parts[name].append(blob)
                evidence_bytes += length
                _require(evidence_bytes <= 32*1024*1024)
            else:
                fixed[name] = blob
                if name != 'report': snapshot_bytes += length
                _require(snapshot_bytes <= 4*1024*1024)
        _require(offset == len(body))
        _keys(metadata['responseHeaders'], ('content-type', 'content-length',
                                           'x-validation-response-sha256', 'x-validation-response-mac'))
        response = verify_response(fixed['report'], list(metadata['responseHeaders'].items()),
            authenticated, authenticator, trust_profile=trust_profile, now=now)
        evidence = EvidenceSet(datetime.fromisoformat(response['checkedAt'].replace('Z', '+00:00')),
                               **{name: tuple(blobs) for name, blobs in evidence_parts.items()})
        _require(evidence.sha256 == metadata['evidenceSetSha256'])
        trust = load_trust_bundle(fixed['rootsPem'], fixed['intermediatesPem'],
                                  allow_synthetic=(trust_profile == 'synthetic_not_icp'))
        _proof(response, evidence, trust, authenticated)
        return BundleResult(response, evidence, trust, _digest(body))
    except (ValueError, TypeError, KeyError, AttributeError, OverflowError, struct.error):
        raise BundleError() from None

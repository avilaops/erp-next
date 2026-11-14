"""Bounded Unix-channel messages. No pickle, paths, commands or private keys."""
import base64
from datetime import datetime
import hashlib
import struct
from uuid import UUID

from contract_signature_validator.model import EvidenceSet
from contract_signature_validator.transport import (FRAME_MAX_BYTES, canonical_json, decode_request, strict_json)
from contract_signature_validator.transport_auth import AuthenticatedRequest
from contract_signature_validator.transport_response import _validated_body

from .bundle import _proof
from .egress import FetchTarget
from .engine import EngineResult

MAGIC = b'AVILA-CVI1\n'
REQUEST_MAX = 120*1024*1024
RESULT_MAX = 40*1024*1024
_HEADER_MAX = 32*1024
_LIMITS = {'certificates': (64, 256*1024), 'crls': (16, 8*1024*1024), 'ocsps': (16, 256*1024)}


class IpcError(ValueError):
    def __init__(self):
        super().__init__('invalid_validation_ipc')


def _require(condition):
    if not condition: raise IpcError()


def _keys(value, expected):
    _require(type(value) is dict and set(value) == set(expected))


def _stamp(value):
    return value.isoformat().replace('+00:00', 'Z')


def _moment(value):
    _require(isinstance(value, str) and 0 < len(value) <= 32 and value.endswith('Z'))
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    _require(_stamp(result) == value)
    return result


def _digest(value):
    return hashlib.sha256(value).hexdigest()


def _pack(metadata, name, blob, evidence, maximum):
    material = [(name, 0, blob)]
    material.extend((kind, index, raw) for kind in _LIMITS
                    for index, raw in enumerate(getattr(evidence, kind)))
    header = canonical_json(metadata | {'parts': [{'name': kind, 'index': index, 'length': len(raw),
                              'sha256': _digest(raw)} for kind, index, raw in material]})
    _require(len(header) <= _HEADER_MAX)
    output = b''.join((MAGIC, struct.pack('>I', len(header)), header, *(raw for _, _, raw in material)))
    _require(len(output) <= maximum)
    return output


def _unpack(packet, name, maximum, expected):
    _require(isinstance(packet, bytes) and len(MAGIC)+4 < len(packet) <= maximum and packet.startswith(MAGIC))
    start = len(MAGIC)+4
    size = struct.unpack('>I', packet[len(MAGIC):start])[0]
    _require(0 < size <= _HEADER_MAX and start+size < len(packet))
    metadata = strict_json(packet[start:start+size], max_bytes=_HEADER_MAX)
    _keys(metadata, (*expected, 'parts'))
    _require(type(metadata['parts']) is list and 1 <= len(metadata['parts']) <= 97)
    offset, fixed, group, total = start+size, None, 0, 0
    evidence = {kind: [] for kind in _LIMITS}
    order = list(_LIMITS)
    for position, part in enumerate(metadata['parts']):
        _keys(part, ('name', 'index', 'length', 'sha256'))
        kind, index, length = part['name'], part['index'], part['length']
        _require(isinstance(kind, str) and type(index) is int and type(length) is int and length > 0)
        if position == 0:
            _require(kind == name and index == 0 and length <= (FRAME_MAX_BYTES if name == 'frame' else 256*1024))
        else:
            _require(kind in _LIMITS and order.index(kind) >= group and index == len(evidence[kind])
                     and index < _LIMITS[kind][0] and length <= _LIMITS[kind][1])
            group = order.index(kind)
            total += length
            _require(total <= 32*1024*1024)
        _require(offset+length <= len(packet))
        raw = packet[offset:offset+length]
        _require(_digest(raw) == part['sha256'])
        offset += length
        if position == 0: fixed = raw
        else: evidence[kind].append(raw)
    _require(offset == len(packet))
    return metadata, fixed, {kind: tuple(values) for kind, values in evidence.items()}


def encode_job(stage, frame, authenticated, evidence):
    try:
        _require(stage in ('discover', 'validate') and _digest(frame) == authenticated.request_sha256
                 and evidence.observed_at == authenticated.observed_at)
        metadata = {'schemaVersion': 'avila-validator-job/1', 'stage': stage,
            'operation': authenticated.request.operation, 'requestId': str(authenticated.request.request_id),
            'observedAt': _stamp(authenticated.observed_at), 'sentAt': _stamp(authenticated.sent_at),
            'keyId': authenticated.key_id, 'requestSha256': authenticated.request_sha256,
            'evidenceSetSha256': evidence.sha256}
        return _pack(metadata, 'frame', frame, evidence, REQUEST_MAX)
    except (ValueError, TypeError, AttributeError, KeyError, OverflowError):
        raise IpcError() from None


def decode_job(packet, config, *, stage):
    try:
        metadata, frame, material = _unpack(packet, 'frame', REQUEST_MAX, ('schemaVersion', 'stage',
            'operation', 'requestId', 'observedAt', 'sentAt', 'keyId', 'requestSha256', 'evidenceSetSha256'))
        _require(stage in ('discover', 'validate') and metadata['schemaVersion'] == 'avila-validator-job/1'
                 and metadata['stage'] == stage and _digest(frame) == metadata['requestSha256'])
        request_id = UUID(metadata['requestId'])
        _require(str(request_id) == metadata['requestId'])
        request = decode_request(frame, operation=metadata['operation'], request_id=request_id,
            policy_sha256=config.policy.sha256, trust_bundle_sha256=config.trust.sha256)
        context = AuthenticatedRequest(request, _moment(metadata['observedAt']), metadata['keyId'],
                                        metadata['requestSha256'], _moment(metadata['sentAt']))
        _require(-5 <= (context.observed_at-context.sent_at).total_seconds() <= 60)
        evidence = EvidenceSet(context.observed_at, **material)
        _require(evidence.sha256 == metadata['evidenceSetSha256'])
        return context, evidence
    except (ValueError, TypeError, KeyError, AttributeError, OverflowError, struct.error):
        raise IpcError() from None


def encode_result(stage, result, authenticated):
    try:
        _require(stage in ('discover', 'validate') and isinstance(result, EngineResult)
                 and len(result.targets) <= 12 and type(result.terminal) is bool)
        metadata = {'schemaVersion': 'avila-validator-result/1', 'stage': stage,
            'requestSha256': authenticated.request_sha256, 'observedAt': _stamp(result.evidence.observed_at),
            'evidenceSetSha256': result.evidence.sha256, 'terminal': result.terminal,
            'targets': [{'kind': target.kind, 'url': target.url,
                         'body': base64.b64encode(target.body).decode('ascii')} for target in result.targets]}
        return _pack(metadata, 'response', result.response, result.evidence, RESULT_MAX)
    except (ValueError, TypeError, KeyError, AttributeError, OverflowError):
        raise IpcError() from None


def decode_result(packet, authenticated, config, *, stage):
    try:
        metadata, response, material = _unpack(packet, 'response', RESULT_MAX, ('schemaVersion', 'stage',
            'requestSha256', 'observedAt', 'evidenceSetSha256', 'terminal', 'targets'))
        _require(stage in ('discover', 'validate') and metadata['stage'] == stage
                 and metadata['schemaVersion'] == 'avila-validator-result/1'
                 and metadata['requestSha256'] == authenticated.request_sha256
                 and metadata['observedAt'] == _stamp(authenticated.observed_at)
                 and type(metadata['terminal']) is bool and type(metadata['targets']) is list
                 and len(metadata['targets']) <= 12 and (stage != 'validate' or metadata['terminal']))
        evidence = EvidenceSet(authenticated.observed_at, **material)
        _require(evidence.sha256 == metadata['evidenceSetSha256'])
        bound = _validated_body(response, authenticated, trust_profile=config.trust.profile, now=authenticated.observed_at)
        _proof(bound, evidence, config.trust, authenticated)
        targets = []
        for value in metadata['targets']:
            _keys(value, ('kind', 'url', 'body'))
            _require(isinstance(value['body'], str) and len(value['body']) <= 5464)
            target = FetchTarget(value['kind'], value['url'], base64.b64decode(value['body'], validate=True))
            config.network_policy.approve(target)
            _require(target not in targets)
            targets.append(target)
        _require((not metadata['terminal'] and bool(targets)) or (metadata['terminal'] and not targets))
        if bound['report']['verdict'] != 'indeterminate': _require(metadata['terminal'])
        return EngineResult(response, evidence, tuple(targets), metadata['terminal'])
    except (ValueError, TypeError, KeyError, AttributeError, OverflowError, struct.error):
        raise IpcError() from None

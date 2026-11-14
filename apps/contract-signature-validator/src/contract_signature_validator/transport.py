"""Bounded internal binary frames. No PDF parsing, network, paths or trust selection."""
from dataclasses import dataclass, field
import hashlib
import json
import re
import struct
from uuid import UUID

from .model import ExpectedSigner

MAGIC = b'AVILA-CV1\n'
HEADER_MAX_BYTES = 32 * 1024
JSON_MAX_DEPTH = 16
PART_LIMITS = {'base': 20 * 1024 * 1024, 'parent': 32 * 1024 * 1024,
               'candidate': 32 * 1024 * 1024}
FRAME_MAX_BYTES = len(MAGIC) + 4 + HEADER_MAX_BYTES + sum(PART_LIMITS.values())
TARGETS = {'preflight': '/internal/v1/preflight', 'increment': '/internal/v1/increment'}


class ProtocolError(ValueError):
    def __init__(self):
        super().__init__('invalid_request')


def _require(condition):
    if not condition:
        raise ProtocolError()


def _hash(value):
    _require(isinstance(value, str) and re.fullmatch(r'[0-9a-f]{64}', value) is not None)


def _identifier(value):
    _require(isinstance(value, str))
    result = UUID(value)
    _require(result.int != 0 and str(result) == value)
    return result


def _keys(value, expected):
    _require(type(value) is dict and set(value) == set(expected))


def _pairs(values):
    result = {}
    for key, value in values:
        _require(key not in result)
        result[key] = value
    return result


def _bounded_depth(text):
    depth, quoted, escaped = 0, False, False
    for char in text:
        if quoted:
            if escaped:
                escaped = False
            elif char == '\\':
                escaped = True
            elif char == '"':
                quoted = False
        elif char == '"':
            quoted = True
        elif char in '[{':
            depth += 1
            _require(depth <= JSON_MAX_DEPTH)
        elif char in ']}':
            depth -= 1
            _require(depth >= 0)
    _require(not quoted and depth == 0)


def strict_json(raw, *, max_bytes):
    try:
        _require(isinstance(raw, bytes) and 0 < len(raw) <= max_bytes)
        text = raw.decode('ascii')
        _bounded_depth(text)
        def reject_constant(_):
            raise ProtocolError()
        result = json.loads(text, object_pairs_hook=_pairs,
                            parse_constant=reject_constant)
        _require(type(result) is dict)
        return result
    except (ValueError, TypeError, RecursionError, UnicodeError):
        raise ProtocolError() from None


def canonical_json(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'),
                      ensure_ascii=True, allow_nan=False).encode('ascii')


@dataclass(frozen=True)
class ValidationRequest:
    operation: str
    request_id: UUID
    tenant_id: UUID
    envelope_id: UUID
    document_id: UUID
    policy_sha256: str
    trust_bundle_sha256: str
    base: bytes = field(repr=False)
    parent: bytes | None = field(default=None, repr=False)
    candidate: bytes | None = field(default=None, repr=False)
    signer: ExpectedSigner | None = field(default=None, repr=False)
    previous_signers: tuple[ExpectedSigner, ...] = field(default=(), repr=False)

    def __post_init__(self):
        _require(isinstance(self.operation, str) and self.operation in TARGETS)
        for value in (self.request_id, self.tenant_id, self.envelope_id, self.document_id):
            _require(isinstance(value, UUID) and value.int != 0)
        _hash(self.policy_sha256)
        _hash(self.trust_bundle_sha256)
        _require(type(self.previous_signers) is tuple and len(self.previous_signers) <= 9)
        if self.operation == 'preflight':
            _require(self.parent is None and self.candidate is None and self.signer is None
                     and not self.previous_signers)
        else:
            people = (*self.previous_signers, self.signer)
            _require(all(isinstance(person, ExpectedSigner) for person in people))
            _require(len({person.participant_id for person in people}) == len(people)
                     and len({person.expected_cpf for person in people}) == len(people))
        for name in self.part_names:
            value = getattr(self, name)
            _require(isinstance(value, bytes) and 0 < len(value) <= PART_LIMITS[name])

    @property
    def part_names(self):
        return ('base',) if self.operation == 'preflight' else ('base', 'parent', 'candidate')


def _person(value):
    return None if value is None else {'participantId': str(value.participant_id),
                                      'expectedCpf': value.expected_cpf}


def encode_request(request: ValidationRequest) -> bytes:
    _require(isinstance(request, ValidationRequest))
    metadata = {
        'schemaVersion': 'avila-contract-request/1', 'operation': request.operation,
        'requestId': str(request.request_id), 'tenantId': str(request.tenant_id),
        'envelopeId': str(request.envelope_id), 'documentId': str(request.document_id),
        'policySha256': request.policy_sha256, 'trustBundleSha256': request.trust_bundle_sha256,
        'signer': _person(request.signer),
        'previousSigners': [_person(person) for person in request.previous_signers],
        'parts': [{'name': name, 'length': len(getattr(request, name)),
                   'sha256': hashlib.sha256(getattr(request, name)).hexdigest()}
                  for name in request.part_names],
    }
    raw = canonical_json(metadata)
    _require(len(raw) <= HEADER_MAX_BYTES)
    return b''.join((MAGIC, struct.pack('>I', len(raw)), raw,
                     *(getattr(request, name) for name in request.part_names)))


def _decode_person(value):
    _keys(value, ('participantId', 'expectedCpf'))
    return ExpectedSigner(_identifier(value['participantId']), value['expectedCpf'])


def decode_request(frame, *, operation, request_id, policy_sha256, trust_bundle_sha256):
    """Call only after authenticating HTTP headers AND the exact body digest/length."""
    try:
        _require(isinstance(frame, bytes) and len(MAGIC)+4 < len(frame) <= FRAME_MAX_BYTES
                 and frame.startswith(MAGIC))
        size = struct.unpack('>I', frame[len(MAGIC):len(MAGIC)+4])[0]
        start = len(MAGIC) + 4
        _require(0 < size <= HEADER_MAX_BYTES and start+size < len(frame))
        metadata = strict_json(frame[start:start+size], max_bytes=HEADER_MAX_BYTES)
        _keys(metadata, ('schemaVersion', 'operation', 'requestId', 'tenantId', 'envelopeId',
                         'documentId', 'policySha256', 'trustBundleSha256', 'signer',
                         'previousSigners', 'parts'))
        _require(metadata['schemaVersion'] == 'avila-contract-request/1'
                 and metadata['operation'] == operation and operation in TARGETS
                 and metadata['policySha256'] == policy_sha256
                 and metadata['trustBundleSha256'] == trust_bundle_sha256
                 and _identifier(metadata['requestId']) == request_id)
        names = ('base',) if operation == 'preflight' else ('base', 'parent', 'candidate')
        parts = metadata['parts']
        _require(type(parts) is list and len(parts) == len(names))
        offset, blobs = start+size, {}
        for part, name in zip(parts, names, strict=True):
            _keys(part, ('name', 'length', 'sha256'))
            _require(part['name'] == name and type(part['length']) is int
                     and 0 < part['length'] <= PART_LIMITS[name])
            _hash(part['sha256'])
            end = offset + part['length']
            _require(end <= len(frame))
            blob = frame[offset:end]
            _require(hashlib.sha256(blob).hexdigest() == part['sha256'])
            blobs[name], offset = blob, end
        _require(offset == len(frame))
        previous = metadata['previousSigners']
        _require(type(previous) is list and len(previous) <= 9)
        return ValidationRequest(operation=operation, request_id=request_id,
            tenant_id=_identifier(metadata['tenantId']), envelope_id=_identifier(metadata['envelopeId']),
            document_id=_identifier(metadata['documentId']), policy_sha256=policy_sha256,
            trust_bundle_sha256=trust_bundle_sha256, **blobs,
            signer=None if metadata['signer'] is None else _decode_person(metadata['signer']),
            previous_signers=tuple(_decode_person(person) for person in previous))
    except (ValueError, TypeError, KeyError, OverflowError, RecursionError):
        raise ProtocolError() from None

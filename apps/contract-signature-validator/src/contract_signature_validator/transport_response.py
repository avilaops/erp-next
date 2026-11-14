"""Authenticate and correlate internal results; no PDF parsing or advancement of state."""
from datetime import datetime
import hashlib
import hmac
import json
import re

from .model import (BaselineInventory, CheckResult, PreflightBinding, PreflightReport,
                    SignatureInventoryItem, ValidationBinding, ValidationReport, Verdict, _utc)
from .report import canonical_preflight_bytes, canonical_report_bytes
from .transport import (ProtocolError, _hash, _keys, _require, canonical_json, strict_json)
from .transport_auth import (AuthenticatedRequest, AuthenticationError, _headers,
                             _require as _authenticated)

RESPONSE_MAX_BYTES = 256 * 1024
CONTENT_TYPE = 'application/vnd.avila.contract-validation-result+json;version=1'


def _stamp(value):
    _utc(value)
    return value.isoformat().replace('+00:00', 'Z')


def _context(authenticated):
    request = authenticated.request
    return {'requestId': str(request.request_id), 'tenantId': str(request.tenant_id),
            'envelopeId': str(request.envelope_id), 'documentId': str(request.document_id),
            'operation': request.operation, 'requestSha256': authenticated.request_sha256}


def _checks(values):
    _require(type(values) is list and len(values) <= 32)
    result = []
    for value in values:
        _keys(value, ('name', 'verdict', 'reason', 'evidenceHashes'))
        hashes = value['evidenceHashes']
        _require(type(hashes) is list and len(hashes) <= 128)
        result.append(CheckResult(value['name'], Verdict(value['verdict']), value['reason'], tuple(hashes)))
    return tuple(result)


def _baseline(value, request):
    if value is None:
        return None
    _keys(value, ('documentId', 'baseSha256', 'baseSize', 'policySha256', 'trustBundleSha256', 'signatures'))
    digest = hashlib.sha256(request.base).hexdigest()
    _require(value['documentId'] == str(request.document_id) and value['baseSha256'] == digest
             and type(value['baseSize']) is int and value['baseSize'] == len(request.base)
             and value['policySha256'] == request.policy_sha256
             and value['trustBundleSha256'] == request.trust_bundle_sha256
             and type(value['signatures']) is list and len(value['signatures']) <= 32)
    signatures = []
    for item in value['signatures']:
        _keys(item, ('cmsSha256', 'certificateSha256', 'fieldSha256'))
        for digest_value in item.values():
            _hash(digest_value)
        # Private field names never cross the response boundary. This object is
        # only used to recompute the verdict, never passed into PDF validation.
        signatures.append(SignatureInventoryItem('', item['cmsSha256'],
                          item['certificateSha256'], item['fieldSha256']))
    return BaselineInventory(request.document_id, digest, value['baseSize'], request.policy_sha256,
                             request.trust_bundle_sha256, tuple(signatures))


def _verify_report(value, request, observed_at, trust_profile):
    common = ('schemaVersion', 'binding', 'verdict', 'trustProfile', 'engine', 'checks', 'longTermValidation')
    _keys(value, (*common, 'baseline') if request.operation == 'preflight' else (*common, 'timestampStatus'))
    _require(isinstance(trust_profile, str) and trust_profile in {'icp_brasil', 'synthetic_not_icp'}
             and value['trustProfile'] == trust_profile and value['longTermValidation'] == 'not_established')
    _keys(value['engine'], ('validator', 'pyHanko', 'certvalidator'))
    for version in value['engine'].values():
        _require(isinstance(version, str) and len(version) <= 64
                 and re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+[A-Za-z0-9.+-]*', version) is not None)
    binding = {'documentId': str(request.document_id), 'policySha256': request.policy_sha256,
               'trustBundleSha256': request.trust_bundle_sha256, 'checkedAt': _stamp(observed_at)}
    checks = _checks(value['checks'])
    if request.operation == 'preflight':
        digest = hashlib.sha256(request.base).hexdigest()
        binding['baseSha256'] = digest
        _require(value['schemaVersion'] == 'avila-contract-preflight/1' and value['binding'] == binding)
        typed = PreflightReport(PreflightBinding(request.document_id, digest, request.policy_sha256,
            request.trust_bundle_sha256, observed_at), checks, trust_profile, _baseline(value['baseline'], request))
    else:
        parent_hash, candidate_hash = (hashlib.sha256(request.parent).hexdigest(),
                                       hashlib.sha256(request.candidate).hexdigest())
        binding.update(participantId=str(request.signer.participant_id), parentSha256=parent_hash,
                       candidateSha256=candidate_hash)
        _require(value['schemaVersion'] == 'avila-contract-validation/1' and value['binding'] == binding)
        typed = ValidationReport(ValidationBinding(request.document_id, request.signer.participant_id,
            parent_hash, candidate_hash, request.policy_sha256, request.trust_bundle_sha256, observed_at),
            checks, trust_profile, value['timestampStatus'])
        _require(typed.verdict != Verdict.ACCEPTED or typed.timestamp_status == 'absent')
    _require(value['verdict'] == typed.verdict.value)


def _validated_body(body, authenticated, *, trust_profile, now):
    try:
        _require(isinstance(authenticated, AuthenticatedRequest))
        _utc(now)
        value = strict_json(body, max_bytes=RESPONSE_MAX_BYTES)
        _keys(value, ('schemaVersion', 'requestId', 'tenantId', 'envelopeId', 'documentId',
                      'operation', 'requestSha256', 'checkedAt', 'reportSha256', 'report'))
        _require(value['schemaVersion'] == 'avila-contract-response/1'
                 and all(value[name] == expected for name, expected in _context(authenticated).items()))
        stamp = value['checkedAt']
        _require(isinstance(stamp, str) and 0 < len(stamp) <= 32 and stamp.endswith('Z'))
        observed_at = datetime.fromisoformat(stamp.replace('Z', '+00:00'))
        _require(_stamp(observed_at) == stamp and -5 <= (now-observed_at).total_seconds() <= 60
                 and -5 <= (observed_at-authenticated.sent_at).total_seconds() <= 60)
        _hash(value['reportSha256'])
        _require(hashlib.sha256(canonical_json(value['report'])).hexdigest() == value['reportSha256'])
        _verify_report(value['report'], authenticated.request, observed_at, trust_profile)
        return value
    except (ValueError, TypeError, KeyError, AttributeError, OverflowError, RecursionError):
        raise ProtocolError() from None


def encode_response(authenticated, report, *, trust_profile):
    try:
        _require(isinstance(authenticated, AuthenticatedRequest))
        request = authenticated.request
        expected_type = PreflightReport if request.operation == 'preflight' else ValidationReport
        _require(isinstance(report, expected_type))
        raw = canonical_preflight_bytes(report) if request.operation == 'preflight' else canonical_report_bytes(report)
        value = {'schemaVersion': 'avila-contract-response/1', **_context(authenticated),
                 'checkedAt': _stamp(authenticated.observed_at),
                 'reportSha256': hashlib.sha256(raw).hexdigest(), 'report': json.loads(raw)}
        body = canonical_json(value)
        _validated_body(body, authenticated, trust_profile=trust_profile, now=authenticated.observed_at)
        return body
    except (ValueError, TypeError, KeyError, AttributeError, OverflowError, RecursionError):
        raise ProtocolError() from None


def seal_response(body, authenticated, authenticator, *, trust_profile):
    # Internal use only; the service supplies its configured profile again.
    # Never infer trust from a caller-supplied body, even one with a valid hash.
    value = strict_json(body, max_bytes=RESPONSE_MAX_BYTES)
    try:
        _validated_body(body, authenticated, trust_profile=trust_profile,
                        now=authenticated.observed_at)
        _require(value['checkedAt'] == _stamp(authenticated.observed_at))
    except (ValueError, TypeError, KeyError, AttributeError):
        raise ProtocolError() from None
    return {'content-type': CONTENT_TYPE, 'content-length': str(len(body)),
            'x-validation-response-sha256': hashlib.sha256(body).hexdigest(),
            'x-validation-response-mac': f'HMAC-SHA256 {authenticated.key_id}:'
                                       + authenticator.response_mac(body, authenticated)}


def verify_response(body, headers, authenticated, authenticator, *, trust_profile, now):
    try:
        _authenticated(isinstance(body, bytes) and 0 < len(body) <= RESPONSE_MAX_BYTES
                       and isinstance(authenticated, AuthenticatedRequest))
        values = _headers(headers)
        _authenticated(values['content-type'] == CONTENT_TYPE
                       and values['content-length'] == str(len(body))
                       and hmac.compare_digest(values['x-validation-response-sha256'], hashlib.sha256(body).hexdigest()))
        mac = re.fullmatch(r'HMAC-SHA256 ([a-z0-9][a-z0-9_-]{0,31}):([0-9a-f]{64})',
                           values['x-validation-response-mac'])
        _authenticated(mac is not None and mac[1] == authenticated.key_id
                       and hmac.compare_digest(mac[2], authenticator.response_mac(body, authenticated)))
    except (ValueError, TypeError, KeyError, AttributeError):
        raise AuthenticationError() from None
    return _validated_body(body, authenticated, trust_profile=trust_profile, now=now)

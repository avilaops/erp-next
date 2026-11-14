"""One approved query per independently supervised, credential-free subprocess."""
import base64
import math
import sys

from contract_signature_validator.transport import canonical_json, strict_json
from .egress import FetchTarget, LIMITS, NetworkPolicy
from .sandbox import run_bounded

JOB_MAX = 64*1024


def encode_fetch_job(target, policy):
    policy.approve(target)
    raw = canonical_json({'schemaVersion': 'avila-evidence-query/1', 'kind': target.kind,
        'url': target.url, 'body': base64.b64encode(target.body).decode('ascii'),
        'rules': {origin: list(prefixes) for origin, prefixes in policy.rules.items()}})
    if len(raw) > JOB_MAX: raise ValueError('invalid_evidence_query')
    return raw


def decode_fetch_job(raw):
    try:
        value = strict_json(raw, max_bytes=JOB_MAX)
        if (type(value) is not dict or set(value) != {'schemaVersion', 'kind', 'url', 'body', 'rules'}
            or value['schemaVersion'] != 'avila-evidence-query/1' or type(value['rules']) is not dict
            or any(type(prefixes) is not list for prefixes in value['rules'].values())
            or not isinstance(value['body'], str) or len(value['body']) > 5464):
            raise ValueError()
        target = FetchTarget(value['kind'], value['url'], base64.b64decode(value['body'], validate=True))
        policy = NetworkPolicy({origin: tuple(prefixes) for origin, prefixes in value['rules'].items()})
        policy.approve(target)
        return target, policy
    except (ValueError, TypeError, KeyError, OverflowError):
        raise ValueError('invalid_evidence_query') from None


class EvidenceCollector:
    def __init__(self, policy): self.policy = policy

    async def fetch(self, target, *, timeout):
        if (type(timeout) not in (int, float) or not math.isfinite(timeout) or not 0 < timeout <= 3):
            raise ValueError('invalid_evidence_query')
        job = encode_fetch_job(target, self.policy)
        return await run_bounded((sys.executable, '-I', '-m', 'contract_signature_service.network_child'),
            job, timeout=timeout, output_limit=LIMITS[target.kind], profile='network')

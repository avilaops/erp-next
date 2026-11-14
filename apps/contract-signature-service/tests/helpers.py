"""SYNTHETIC TEST ONLY • never packaged in the service image or wheel."""
from pathlib import Path
import importlib
import importlib.util
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'apps/contract-signature-service/src'))
sys.path.insert(0, str(ROOT / 'apps/contract-signature-validator/tests'))


def load(test, module):
    test.assertIsNotNone(importlib.util.find_spec('contract_signature_service'))
    test.assertIsNotNone(importlib.util.find_spec('contract_signature_service.'+module))
    return importlib.import_module('contract_signature_service.'+module)


def validation_fixture():
    import hashlib
    from dataclasses import replace
    from contract_signature_validator.model import EvidenceSet, PreflightBinding, ValidationBinding, ValidationPolicy
    from contract_signature_validator.pdf_policy import check_signatures, open_pdf
    from contract_signature_validator.transport_auth import TransportAuthenticator
    from contract_signature_validator.transport import encode_request
    from contract_signature_validator.trust import load_trust_bundle
    from contract_signature_validator.validation import _embedded_evidence, preflight, validate_increment
    from fixtures import NOW, chain_fixture, der, issued_crl, pem, sealed_pdf, sign_pdf
    import test_transport as wire_tests
    chain, base = chain_fixture(), sealed_pdf()
    trust = load_trust_bundle(pem(chain.root), pem(chain.intermediate), allow_synthetic=True)
    policy = ValidationPolicy()
    evidence = EvidenceSet(NOW, (der(chain.intermediate),), (
        issued_crl(chain.root, chain.root_key), issued_crl(chain.intermediate, chain.intermediate_key)))
    candidate = sign_pdf(base, der(chain.leaf), chain.leaf_key, 'Personal', issuer=chain.intermediate, root=chain.root)
    evidence = _embedded_evidence(evidence, check_signatures(open_pdf(candidate, policy), policy))
    helper = wire_tests.TransportTests()
    helper.api = importlib.import_module('contract_signature_validator.transport')
    request = replace(helper.request('increment'), base=base, parent=base, candidate=candidate,
                      policy_sha256=policy.sha256, trust_bundle_sha256=trust.sha256)
    digest = lambda value: hashlib.sha256(value).hexdigest()
    opened = preflight(base, PreflightBinding(request.document_id, digest(base), policy.sha256, trust.sha256, NOW),
                       policy, trust, evidence)
    report = validate_increment(base, candidate, ValidationBinding(request.document_id, request.signer.participant_id,
        digest(base), digest(candidate), policy.sha256, trust.sha256, NOW), request.signer, (), opened.baseline,
        policy, trust, evidence)
    authenticator = TransportAuthenticator({'test': b'SYNTHETIC-TRANSPORT-TEST-KEY-ONLY!!'})
    frame = encode_request(request)
    headers = authenticator.headers_for(frame, operation='increment', request_id=request.request_id,
                                        key_id='test', sent_at=NOW)
    authenticated = authenticator.decode_request(frame, list(headers.items()), method='POST', target='/internal/v1/increment',
        now=NOW, policy_sha256=policy.sha256, trust_bundle_sha256=trust.sha256)
    return authenticator, authenticated, report, evidence, trust

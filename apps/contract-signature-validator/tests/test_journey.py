"""Real synthetic CMS/PKIX journey. These identities are NOT ICP-Brasil."""
from dataclasses import replace
import hashlib
import unittest
from uuid import UUID
from cryptography.hazmat.primitives.asymmetric import ec

from contract_signature_validator.model import EvidenceSet, ExpectedSigner, PreflightBinding, ValidationBinding, ValidationPolicy, Verdict
from contract_signature_validator.report import canonical_report_bytes
from contract_signature_validator.trust import load_trust_bundle
from contract_signature_validator.validation import preflight, validate_increment
from fixtures import NOW, chain_fixture, der, issued_crl, pem, personal_fixture, sealed_pdf, sign_pdf


def digest(data):
    return hashlib.sha256(data).hexdigest()


class MultiDocumentJourneyTests(unittest.TestCase):
    def test_declared_rsa_pss_and_ec_hash_profiles_are_really_verified(self):
        chain = chain_fixture()
        trust = load_trust_bundle(pem(chain.root), allow_synthetic=True)
        policy = ValidationPolicy()
        evidence = EvidenceSet(observed_at=NOW, certificates=(der(chain.intermediate),), crls=(
            issued_crl(chain.root, chain.root_key), issued_crl(chain.intermediate, chain.intermediate_key)))
        base = sealed_pdf()
        document_id = UUID(int=40)
        person = ExpectedSigner(UUID(int=41), "52998224725")
        baseline = preflight(base, PreflightBinding(document_id, digest(base), policy.sha256, trust.sha256, NOW),
                             policy, trust, evidence).baseline
        profiles = [(None, True, algorithm) for algorithm in ('sha256', 'sha384', 'sha512')]
        profiles += [(ec.generate_private_key(curve()), False, algorithm) for curve, algorithm in
                     ((ec.SECP256R1, 'sha256'), (ec.SECP384R1, 'sha384'), (ec.SECP521R1, 'sha512'))]
        for index, (key, prefer_pss, algorithm) in enumerate(profiles):
            with self.subTest(key='rsa_pss' if prefer_pss else key.curve.name, hash=algorithm):
                cert, key = personal_fixture(chain, person.expected_cpf, index + 600, key=key)
                candidate = sign_pdf(base, der(cert), key, 'AlgorithmTest', issuer=chain.intermediate,
                                     root=chain.root, prefer_pss=prefer_pss, md_algorithm=algorithm)
                binding = ValidationBinding(document_id, person.participant_id, digest(base), digest(candidate),
                                            policy.sha256, trust.sha256, NOW)
                report = validate_increment(base, candidate, binding, person, (), baseline, policy, trust, evidence)
                self.assertEqual(report.verdict, Verdict.ACCEPTED, report)

    def test_three_distinct_people_sign_both_documents_and_replay_offline(self):
        chain = chain_fixture()
        trust = load_trust_bundle(pem(chain.root), allow_synthetic=True)
        policy = ValidationPolicy()
        evidence = EvidenceSet(observed_at=NOW, certificates=(der(chain.intermediate),), crls=(
            issued_crl(chain.root, chain.root_key), issued_crl(chain.intermediate, chain.intermediate_key)))
        people = tuple(ExpectedSigner(UUID(int=index + 100), cpf) for index, cpf in enumerate(
            ("52998224725", "01234567890", "12345678909")))
        credentials = tuple(personal_fixture(chain, person.expected_cpf, index + 400)
                            for index, person in enumerate(people))
        documents = {}
        for index in (1, 2):
            document_id = UUID(int=index)
            base = sealed_pdf(f"SYNTHETIC DOCUMENT {index} PRICE 100.00")
            opened = preflight(base, PreflightBinding(document_id, digest(base), policy.sha256, trust.sha256, NOW),
                               policy, trust, evidence)
            self.assertEqual(opened.verdict, Verdict.ACCEPTED, opened)
            documents[document_id] = {"base": base, "head": base, "baseline": opened.baseline, "reports": []}
        for index, (person, (cert, key)) in enumerate(zip(people, credentials, strict=True)):
            for document_id, document in documents.items():
                with self.subTest(participant=index, document=document_id):
                    parent = document["head"]
                    candidate = sign_pdf(parent, der(cert), key, f"Person{index}", issuer=chain.intermediate, root=chain.root)
                    binding = ValidationBinding(document_id, person.participant_id, digest(parent), digest(candidate),
                                                policy.sha256, trust.sha256, NOW)
                    args = (parent, candidate, binding, person, people[:index], document["baseline"], policy, trust, evidence)
                    result = validate_increment(*args)
                    self.assertEqual(result.verdict, Verdict.ACCEPTED, result)
                    self.assertTrue(candidate.startswith(parent))
                    self.assertEqual(canonical_report_bytes(result), canonical_report_bytes(validate_increment(*args)))
                    self.assertEqual(result.sha256, digest(canonical_report_bytes(result)))
                    self.assertEqual(result.trust_profile, "synthetic_not_icp")
                    for changes in ({"document_id": UUID(int=999)}, {"parent_sha256": "f" * 64},
                                    {"participant_id": UUID(int=998)}):
                        invalid = validate_increment(parent, candidate, replace(binding, **changes), person, people[:index],
                                                     document["baseline"], policy, trust, evidence)
                        self.assertEqual(invalid.verdict, Verdict.INVALID, invalid)
                        self.assertEqual(invalid.checks[0].reason, "binding_mismatch")
                    document["head"] = candidate
                    document["reports"].append(result.sha256)
        self.assertEqual(len({h for d in documents.values() for h in d["reports"]}), 6)
        self.assertTrue(all(len(d["reports"]) == 3 and d["head"].startswith(d["base"]) for d in documents.values()))

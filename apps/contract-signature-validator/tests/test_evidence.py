from dataclasses import replace
from datetime import timedelta
import asyncio
import hashlib
import socket
import unittest
from unittest.mock import patch

from cryptography.x509 import ocsp

from contract_signature_validator.evidence import validation_context, verify_certificate
from contract_signature_validator.model import EvidenceSet, Verdict
from contract_signature_validator.trust import load_trust_bundle
from fixtures import CPF, NOW, chain_fixture, der, issued_crl, issued_ocsp, pem

_native_run = asyncio.run


def _offline_run(coroutine):
    async def guarded():
        with patch.object(socket.socket, "connect", side_effect=AssertionError("network forbidden")) as connect:
            try:
                return await coroutine
            finally:
                connect.assert_not_called()
    # Windows Proactor creates a kernel loopback socketpair during startup.
    # Guard validation itself; preserve the real asyncio runner and PKIX engine.
    return _native_run(guarded())


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.chain = chain_fixture()
        self.trust = load_trust_bundle(pem(self.chain.root), allow_synthetic=True)
        self.root_crl = issued_crl(self.chain.root, self.chain.root_key)
        self.leaf_crl = issued_crl(self.chain.intermediate, self.chain.intermediate_key)
        self.network = patch.object(socket, "create_connection", side_effect=AssertionError("network forbidden"))
        self.connect = self.network.start()
        self.addCleanup(self.network.stop)
        self.addCleanup(self.connect.assert_not_called)
        self.dns = patch.object(socket, "getaddrinfo", side_effect=AssertionError("DNS forbidden"))
        self.resolve = self.dns.start()
        self.addCleanup(self.dns.stop)
        self.addCleanup(self.resolve.assert_not_called)
        self.runner = patch("contract_signature_validator.evidence.asyncio.run", side_effect=_offline_run)
        self.runner.start()
        self.addCleanup(self.runner.stop)

    def evidence(self, *, crls=None, ocsps=(), certificates=None):
        return EvidenceSet(observed_at=NOW,
            certificates=(der(self.chain.intermediate),) if certificates is None else certificates,
            crls=(self.root_crl, self.leaf_crl) if crls is None else crls, ocsps=ocsps)

    def checks(self, evidence, chain=None):
        return verify_certificate(der((chain or self.chain).leaf), self.trust, evidence, NOW)

    def assertAccepted(self, checks):
        self.assertEqual({check.name for check in checks}, {"chain", "revocation"})
        self.assertTrue(all(check.verdict == Verdict.ACCEPTED for check in checks), checks)

    def test_valid_chain_and_both_required_crls_validate_offline_and_replay_stably(self):
        evidence = self.evidence()
        context = validation_context(self.trust, evidence, NOW)
        self.assertFalse(context.fetching_allowed)
        first = self.checks(evidence)
        self.assertAccepted(first)
        self.assertEqual(first, self.checks(evidence))
        hashes = {hashlib.sha256(value).hexdigest() for value in evidence.crls}
        self.assertTrue(hashes <= set(next(c for c in first if c.name == "revocation").evidence_hashes))

    def test_missing_intermediate_or_unknown_chain_cannot_be_accepted(self):
        for evidence, chain in [(self.evidence(certificates=()), self.chain),
                                (self.evidence(), chain_fixture(other=True))]:
            with self.subTest(other=chain is not self.chain):
                checks = self.checks(evidence, chain)
                self.assertTrue(any(c.verdict != Verdict.ACCEPTED for c in checks))
                self.assertNotIn(CPF, repr(checks))

    def test_absent_stale_or_incomplete_revocation_is_indeterminate(self):
        for crls in [(), (self.root_crl,), (self.leaf_crl,),
                     (self.root_crl, issued_crl(self.chain.intermediate, self.chain.intermediate_key, stale=True)),
                     (self.root_crl, issued_crl(self.chain.intermediate, self.chain.intermediate_key, no_next=True))]:
            checks = self.checks(self.evidence(crls=crls))
            self.assertTrue(any(c.verdict == Verdict.INDETERMINATE for c in checks), checks)
            self.assertFalse(all(c.verdict == Verdict.ACCEPTED for c in checks))

    def test_root_supplied_as_untrusted_evidence_is_not_promoted_to_an_anchor(self):
        foreign = chain_fixture(other=True)
        evidence = self.evidence(certificates=(der(foreign.intermediate), der(foreign.root)), crls=(
            issued_crl(foreign.root, foreign.root_key), issued_crl(foreign.intermediate, foreign.intermediate_key)))
        checks = self.checks(evidence, foreign)
        self.assertTrue(any(c.verdict != Verdict.ACCEPTED for c in checks), checks)

    def test_valid_response_from_other_issuer_cannot_prove_our_leaf_status(self):
        foreign = chain_fixture(other=True)
        response = issued_ocsp(self.chain.leaf, foreign.intermediate, foreign.intermediate_key)
        checks = self.checks(self.evidence(crls=(self.root_crl,), ocsps=(response,)))
        self.assertTrue(any(c.verdict == Verdict.INDETERMINATE for c in checks), checks)

    def test_revoked_leaf_or_intermediate_is_invalid(self):
        for crls in [
            (self.root_crl, issued_crl(self.chain.intermediate, self.chain.intermediate_key, revoked=(300,))),
            (issued_crl(self.chain.root, self.chain.root_key, revoked=(200,)), self.leaf_crl),
        ]:
            checks = self.checks(self.evidence(crls=crls))
            self.assertTrue(any(c.verdict == Verdict.INVALID for c in checks), checks)

    def test_expired_future_or_wrong_usage_leaf_is_invalid(self):
        for chain in [chain_fixture(leaf_start=-10, leaf_end=-1),
                      chain_fixture(leaf_start=1, leaf_end=10), chain_fixture(digital=False)]:
            trust = load_trust_bundle(pem(chain.root), allow_synthetic=True)
            evidence = EvidenceSet(observed_at=NOW, certificates=(der(chain.intermediate),), crls=(
                issued_crl(chain.root, chain.root_key), issued_crl(chain.intermediate, chain.intermediate_key)))
            checks = verify_certificate(der(chain.leaf), trust, evidence, NOW)
            self.assertTrue(any(c.verdict == Verdict.INVALID for c in checks), checks)

    def test_bad_crl_signature_does_not_count_as_revocation_evidence(self):
        evidence = self.evidence(crls=(self.root_crl, issued_crl(self.chain.intermediate, self.chain.intermediate_key, wrong_key=True)))
        checks = self.checks(evidence)
        self.assertTrue(any(c.verdict == Verdict.INVALID for c in checks), checks)

    def test_ocsp_is_an_alternative_but_unknown_stale_or_bad_response_cannot_pass(self):
        good = issued_ocsp(self.chain.leaf, self.chain.intermediate, self.chain.intermediate_key)
        self.assertAccepted(self.checks(self.evidence(crls=(self.root_crl,), ocsps=(good,))))
        for options, verdict in [({"status": ocsp.OCSPCertStatus.REVOKED}, Verdict.INVALID),
                                 ({"status": ocsp.OCSPCertStatus.UNKNOWN}, Verdict.INDETERMINATE),
                                 ({"stale": True}, Verdict.INDETERMINATE),
                                 ({"wrong_key": True}, Verdict.INVALID)]:
            response = issued_ocsp(self.chain.leaf, self.chain.intermediate, self.chain.intermediate_key, **options)
            checks = self.checks(self.evidence(crls=(self.root_crl,), ocsps=(response,)))
            self.assertTrue(any(c.verdict == verdict for c in checks), (options, checks))

    def test_observation_and_validation_instants_cannot_be_relabelled(self):
        evidence = self.evidence()
        with self.assertRaises(ValueError):
            replace(evidence, observed_at=NOW.replace(tzinfo=None))
        with self.assertRaises(ValueError):
            validation_context(self.trust, evidence, NOW + timedelta(seconds=1))
        self.assertNotEqual(evidence.sha256, replace(evidence, observed_at=NOW+timedelta(seconds=1)).sha256)

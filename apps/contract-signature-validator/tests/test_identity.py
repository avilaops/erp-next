import unittest

from asn1crypto import core

from contract_signature_validator.identity import extract_personal_identity
from contract_signature_validator.model import Verdict
from fixtures import CPF, PERSON_OID, certificate


class IdentityTests(unittest.TestCase):
    def test_personal_cpf_is_structural_and_preserves_leading_zero(self):
        for cpf in [CPF, "01234567890"]:
            with self.subTest(cpf=cpf):
                value = extract_personal_identity(certificate(cpf=cpf))
                self.assertEqual((value.verdict, value.kind, value.cpf), (Verdict.ACCEPTED, "e_cpf", cpf))
                self.assertNotIn(cpf, repr(value))

    def test_company_responsible_cpf_cannot_satisfy_personal_certificate(self):
        attrs = [("2.16.76.1.3.3", core.UTF8String("11222333000181").dump()),
                 ("2.16.76.1.3.4", core.UTF8String("01011990" + CPF + "0" * 39).dump())]
        value = extract_personal_identity(certificate(attributes=attrs))
        self.assertEqual(value.verdict, Verdict.INVALID)
        self.assertEqual(value.reason, "personal_certificate_required")

    def test_seal_or_application_policy_is_rejected_even_with_personal_looking_san(self):
        for policy in ["2.16.76.1.2.202.999999", "2.16.76.1.2.401.999999"]:
            value = extract_personal_identity(certificate(policy=policy))
            self.assertEqual(value.verdict, Verdict.INVALID)

    def test_ambiguous_invalid_or_non_string_othername_is_not_a_person(self):
        raw = core.UTF8String("01011990" + CPF + "0" * 39).dump()
        for attrs in [[(PERSON_OID, raw), (PERSON_OID, raw)],
                      [(PERSON_OID, core.Integer(int(CPF)).dump())],
                      [(PERSON_OID, core.UTF8String("0101199011111111111").dump())]]:
            value = extract_personal_identity(certificate(attributes=attrs))
            self.assertEqual(value.verdict, Verdict.INVALID)

    def test_unknown_policy_remains_unsupported_and_reports_no_raw_identity(self):
        value = extract_personal_identity(certificate(policy="1.3.6.1.4.1.55555.1"))
        self.assertEqual(value.verdict, Verdict.UNSUPPORTED)
        self.assertNotIn(CPF, repr(value))

    def test_duplicate_policies_are_rejected_instead_of_relying_on_one_matching_arc(self):
        policy = "2.16.76.1.2.1.999999"
        value = extract_personal_identity(certificate(policies=[policy, policy]))
        self.assertEqual(value.verdict, Verdict.INVALID)

    def test_octet_string_identity_and_other_personal_signature_types_are_supported(self):
        for kind in (2, 3, 4):
            attrs = [(PERSON_OID, core.OctetString(("01011990" + CPF + "0" * 39).encode("ascii")).dump())]
            value = extract_personal_identity(certificate(policy=f"2.16.76.1.2.{kind}.999999", attributes=attrs))
            self.assertEqual((value.verdict, value.cpf), (Verdict.ACCEPTED, CPF))

    def test_bad_der_is_rejected_without_leaking_input_as_a_parser_message(self):
        value = extract_personal_identity(b"invalid " + CPF.encode())
        self.assertEqual(value.verdict, Verdict.INVALID)
        self.assertNotIn(CPF, repr(value))

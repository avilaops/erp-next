"""SYNTHETIC TEST ONLY. These certificates and keys are NOT ICP-Brasil."""
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from uuid import UUID

from asn1crypto import core
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.x509 import ocsp
from cryptography.x509.oid import NameOID, ObjectIdentifier

NOW = datetime(2026, 11, 13, 15, tzinfo=timezone.utc)
DOCUMENT = UUID("11111111-1111-4111-8111-111111111111")
PARTICIPANT = UUID("22222222-2222-4222-8222-222222222222")
CPF = "52998224725"
PERSON_OID = "2.16.76.1.3.1"


@lru_cache(maxsize=1)
def test_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def certificate(*, cpf=CPF, policy="2.16.76.1.2.1.999999", policies=None, attributes=None, ca=False):
    """Build only local test bytes. No real identity or trusted CA is represented."""
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "SYNTHETIC NOT ICP TEST")])
    builder = (
        x509.CertificateBuilder()
        .subject_name(subject).issuer_name(subject).public_key(test_key().public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime(2026, 1, 1, tzinfo=timezone.utc))
        .not_valid_after(datetime(2027, 1, 1, tzinfo=timezone.utc))
        .add_extension(x509.BasicConstraints(ca=ca, path_length=None), critical=True)
        .add_extension(x509.KeyUsage(
            digital_signature=True, content_commitment=not ca, key_encipherment=False,
            data_encipherment=False, key_agreement=False, key_cert_sign=ca,
            crl_sign=ca, encipher_only=None, decipher_only=None,
        ), critical=True)
        .add_extension(x509.CertificatePolicies([
            x509.PolicyInformation(ObjectIdentifier(value), None) for value in (policies or [policy])
        ]), critical=False)
    )
    if attributes is None:
        attributes = [(PERSON_OID, core.UTF8String("01011990" + cpf + "0" * 39).dump())]
    if attributes:
        builder = builder.add_extension(x509.SubjectAlternativeName([
            x509.OtherName(ObjectIdentifier(oid), value) for oid, value in attributes
        ]), critical=False)
    return builder.sign(test_key(), hashes.SHA256()).public_bytes(serialization.Encoding.DER)


def binding_values():
    return dict(document_id=DOCUMENT, participant_id=PARTICIPANT, parent_sha256="a" * 64,
                candidate_sha256="b" * 64, policy_sha256="c" * 64,
                trust_bundle_sha256="d" * 64, checked_at=NOW)


@dataclass(frozen=True)
class TestChain:
    root: x509.Certificate
    intermediate: x509.Certificate
    leaf: x509.Certificate
    root_key: object = field(repr=False)
    intermediate_key: object = field(repr=False)
    leaf_key: object = field(repr=False)


def _issued(subject, key, issuer, issuer_key, serial, *, ca, start, end, digital=True, cpf=CPF):
    builder = (x509.CertificateBuilder().subject_name(subject).issuer_name(issuer)
               .public_key(key.public_key()).serial_number(serial)
               .not_valid_before(start).not_valid_after(end)
               .add_extension(x509.BasicConstraints(ca=ca, path_length=None), critical=True)
               .add_extension(x509.KeyUsage(digital_signature=digital, content_commitment=not ca,
                    key_encipherment=False, data_encipherment=False, key_agreement=False,
                    key_cert_sign=ca, crl_sign=ca, encipher_only=None, decipher_only=None), critical=True)
               .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
               .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(issuer_key.public_key()), critical=False))
    if subject != issuer:
        builder = builder.add_extension(x509.CRLDistributionPoints([x509.DistributionPoint(
            full_name=[x509.UniformResourceIdentifier(f"http://revocation.invalid/{'root' if ca else 'leaf'}.crl")],
            relative_name=None, reasons=None, crl_issuer=None,
        )]), critical=False)
    if not ca:
        builder = (builder.add_extension(x509.CertificatePolicies([
                    x509.PolicyInformation(ObjectIdentifier("2.16.76.1.2.1.999999"), None)]), critical=False)
                   .add_extension(x509.SubjectAlternativeName([x509.OtherName(ObjectIdentifier(PERSON_OID),
                        core.UTF8String("01011990" + cpf + "0" * 39).dump())]), critical=False)
                   .add_extension(x509.AuthorityInformationAccess([x509.AccessDescription(
                        ObjectIdentifier("1.3.6.1.5.5.7.48.1"), x509.UniformResourceIdentifier("http://revocation.invalid/ocsp"))]), critical=False))
    return builder.sign(issuer_key, hashes.SHA256())


@lru_cache(maxsize=8)
def chain_fixture(*, leaf_start=-30, leaf_end=30, digital=True, other=False):
    keys = [rsa.generate_private_key(public_exponent=65537, key_size=2048) for _ in range(3)]
    label = "OTHER " if other else ""
    names = [x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, f"SYNTHETIC NOT ICP {label}{part}")])
             for part in ("ROOT", "INTERMEDIATE", "PERSON:" + CPF)]
    root = _issued(names[0], keys[0], names[0], keys[0], 100, ca=True,
                   start=NOW-timedelta(days=365), end=NOW+timedelta(days=365))
    intermediate = _issued(names[1], keys[1], names[0], keys[0], 200, ca=True,
                           start=NOW-timedelta(days=365), end=NOW+timedelta(days=365))
    leaf = _issued(names[2], keys[2], names[1], keys[1], 300, ca=False, digital=digital,
                   start=NOW+timedelta(days=leaf_start), end=NOW+timedelta(days=leaf_end))
    return TestChain(root, intermediate, leaf, *keys)


def personal_fixture(chain, cpf, serial, *, key=None):
    """A distinct synthetic holder under the existing synthetic test issuer."""
    key = key or rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "SYNTHETIC NOT ICP PERSON " + cpf)])
    cert = _issued(subject, key, chain.intermediate.subject, chain.intermediate_key, serial,
                   ca=False, start=NOW-timedelta(days=30), end=NOW+timedelta(days=30), cpf=cpf)
    return cert, key


def der(cert):
    return cert.public_bytes(serialization.Encoding.DER)


def pem(cert):
    return cert.public_bytes(serialization.Encoding.PEM)


def issued_crl(issuer, issuer_key, *, revoked=(), stale=False, wrong_key=False, no_next=False):
    builder = (x509.CertificateRevocationListBuilder().issuer_name(issuer.subject)
               .last_update(NOW-timedelta(days=3 if stale else 1)))
    builder = builder.next_update(NOW+timedelta(days=-1 if stale else 1))
    builder = builder.add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(issuer_key.public_key()), critical=False)
    for serial in revoked:
        builder = builder.add_revoked_certificate(x509.RevokedCertificateBuilder().serial_number(serial)
                    .revocation_date(NOW-timedelta(days=2)).build())
    key = test_key() if wrong_key else issuer_key
    result = builder.sign(key, hashes.SHA256()).public_bytes(serialization.Encoding.DER)
    if no_next:
        from asn1crypto import crl as asn1_crl
        value = asn1_crl.CertificateList.load(result)
        value["tbs_cert_list"]["next_update"] = None
        value["signature"] = key.sign(value["tbs_cert_list"].dump(), padding.PKCS1v15(), hashes.SHA256())
        result = value.dump()
    return result


def issued_ocsp(cert, issuer, issuer_key, *, status=ocsp.OCSPCertStatus.GOOD, stale=False, wrong_key=False):
    from asn1crypto import ocsp as asn1_ocsp
    builder = (ocsp.OCSPResponseBuilder().add_response(cert, issuer, hashes.SHA256(), status,
               this_update=NOW-timedelta(days=3 if stale else 1),
               next_update=NOW+timedelta(days=-1 if stale else 1),
               revocation_time=NOW-timedelta(days=2) if status == ocsp.OCSPCertStatus.REVOKED else None,
               revocation_reason=x509.ReasonFlags.key_compromise if status == ocsp.OCSPCertStatus.REVOKED else None)
               .responder_id(ocsp.OCSPResponderEncoding.HASH, issuer))
    response = asn1_ocsp.OCSPResponse.load(builder.sign(issuer_key, hashes.SHA256()).public_bytes(serialization.Encoding.DER))
    basic = response["response_bytes"]["response"].parsed
    basic["tbs_response_data"]["produced_at"] = core.GeneralizedTime(NOW)
    key = test_key() if wrong_key else issuer_key
    basic["signature"] = key.sign(basic["tbs_response_data"].dump(), padding.PKCS1v15(), hashes.SHA256())
    response["response_bytes"]["response"] = basic
    return response.dump()


def unsigned_pdf(text="SYNTHETIC CONTRACT PRICE 100.00", *, encrypted=False):
    from io import BytesIO
    from pyhanko.pdf_utils import generic as g, writer
    document = writer.PdfFileWriter()
    font = document.add_object(g.DictionaryObject({g.pdf_name("/Type"): g.pdf_name("/Font"),
        g.pdf_name("/Subtype"): g.pdf_name("/Type1"), g.pdf_name("/BaseFont"): g.pdf_name("/Helvetica")}))
    stream = document.add_object(g.StreamObject(stream_data=(f"BT /F1 12 Tf 24 720 Td ({text}) Tj ET").encode("ascii")))
    document.insert_page(writer.PageObject(contents=stream, media_box=(0, 0, 595, 842),
        resources=g.DictionaryObject({g.pdf_name("/Font"): g.DictionaryObject({g.pdf_name("/F1"): font})})))
    price = document.add_object(g.DictionaryObject({g.pdf_name("/FT"): g.pdf_name("/Tx"),
        g.pdf_name("/T"): g.pdf_string("Price"), g.pdf_name("/V"): g.pdf_string("100.00")}))
    document.root[g.pdf_name("/AcroForm")] = document.add_object(g.DictionaryObject({
        g.pdf_name("/Fields"): g.ArrayObject([price])}))
    if encrypted:
        document.encrypt("synthetic-test-only-password")
    output = BytesIO()
    document.write(output)
    return output.getvalue()


def sign_pdf(parent, cert_der, key, field_name, *, issuer=None, root=None, certify=False, locked=False, visible=False, lock_price=False,
             prefer_pss=False, md_algorithm="sha256", seed=None, ignore_seed=False, update_metadata=True):
    from io import BytesIO
    from asn1crypto import keys, x509 as asn1_x509
    from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
    from pyhanko.sign import fields, signers
    from pyhanko_certvalidator.registry import SimpleCertificateStore
    store = SimpleCertificateStore()
    for cert in (issuer, root):
        if cert is not None:
            store.register(asn1_x509.Certificate.load(der(cert)))
    signer = signers.SimpleSigner(asn1_x509.Certificate.load(cert_der), keys.PrivateKeyInfo.load(
        key.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())), store,
        prefer_pss=prefer_pss)
    metadata = signers.PdfSignatureMetadata(field_name=field_name, md_algorithm=md_algorithm, certify=certify,
        docmdp_permissions=fields.MDPPerm.NO_CHANGES if locked else fields.MDPPerm.FILL_FORMS)
    spec = fields.SigFieldSpec(field_name, box=(0, 0, 595, 842) if visible else None,
        field_mdp_spec=fields.FieldMDPSpec(fields.FieldMDPAction.INCLUDE, ["Price"]) if lock_price else None,
        seed_value_dict=seed)
    output = BytesIO()
    pdf_signer = signers.PdfSigner(metadata, signer, new_field_spec=spec)
    pdf_signer._ignore_sv = ignore_seed  # Tests may construct a deliberately nonconforming signer.
    document = IncrementalPdfFileWriter(BytesIO(parent))
    if not update_metadata:
        document._update_meta = lambda: None
    pdf_signer.sign_pdf(document, output=output)
    return output.getvalue()


@lru_cache(maxsize=8)
def sealed_pdf(text="SYNTHETIC CONTRACT PRICE 100.00", *, locked=False, lock_price=False):
    seal = certificate(policy="2.16.76.1.2.202.999999", attributes=[])
    return sign_pdf(unsigned_pdf(text), seal, test_key(), "DocuSealTechnicalSeal",
                    certify=locked, locked=locked, lock_price=lock_price)


def append_change(parent, kind):
    from io import BytesIO
    from pyhanko.pdf_utils import generic as g
    from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
    document = IncrementalPdfFileWriter(BytesIO(parent))
    if kind == "price":
        field = document.root["/AcroForm"]["/Fields"][0].get_object()
        field[g.pdf_name("/V")] = g.pdf_string("999999.00")
        document.update_container(field)
    elif kind == "remove_signature":
        form = document.root["/AcroForm"]
        form[g.pdf_name("/Fields")] = g.ArrayObject(list(form["/Fields"])[:1])
        document.update_container(form)
    elif kind in {"signature_contents", "signature_certificate", "remove_locks"}:
        from asn1crypto import cms, x509 as asn1_x509
        sig = document.prev.embedded_signatures[0]
        value = sig.sig_object
        if kind == "remove_locks":
            value.pop("/Reference", None)
            sig.sig_field.pop("/Lock", None)
            sig.sig_field.pop("/SV", None)
            document.update_container(sig.sig_field)
        else:
            content = cms.ContentInfo.load(bytes(value["/Contents"]))
            if kind == "signature_contents":
                old = content["content"]["signer_infos"][0]["signature"].native
                content["content"]["signer_infos"][0]["signature"] = old[:-1] + bytes([old[-1] ^ 1])
            else:
                content["content"]["certificates"] = cms.CertificateSet([
                    cms.CertificateChoices(name="certificate", value=asn1_x509.Certificate.load(certificate()))])
            value[g.pdf_name("/Contents")] = g.ByteStringObject(content.dump())
        document.update_container(value)
    else:
        page_ref, _ = document.find_page_for_modification(0)
        page = page_ref.get_object()
        if kind == "page":
            page[g.pdf_name("/MediaBox")] = g.ArrayObject([g.NumberObject(v) for v in (0, 0, 100, 100)])
        elif kind == "content":
            page[g.pdf_name("/Contents")] = document.add_object(g.StreamObject(stream_data=b"BT /F1 12 Tf 24 720 Td (PRICE 999999.00) Tj ET"))
        elif kind == "resources":
            page["/Resources"]["/Font"][g.pdf_name("/F1")] = document.add_object(g.DictionaryObject({
                g.pdf_name("/Type"): g.pdf_name("/Font"), g.pdf_name("/Subtype"): g.pdf_name("/Type1"),
                g.pdf_name("/BaseFont"): g.pdf_name("/Symbol")}))
        else:
            raise ValueError("unsupported synthetic mutation")
        document.mark_update(page_ref)
    output = BytesIO()
    document.write(output)
    return output.getvalue()


def add_unsupported_timestamp(candidate):
    from io import BytesIO
    from asn1crypto import cms
    from pyhanko.pdf_utils.reader import PdfFileReader
    sig = PdfFileReader(BytesIO(candidate)).embedded_signatures[-1]
    content = cms.ContentInfo.load(bytes(sig.sig_object["/Contents"]))
    content["content"]["signer_infos"][0]["unsigned_attrs"] = cms.CMSAttributes([
        cms.CMSAttribute({"type": "signature_time_stamp_token", "values": [cms.ContentInfo({
            "content_type": "data", "content": b"SYNTHETIC UNSUPPORTED TIMESTAMP"})]})])
    start, end = sig.byte_range[1], sig.byte_range[2]
    encoded = content.dump().hex().upper().encode("ascii")
    assert len(encoded) <= end-start-2
    gap = b"<" + encoded + b"0" * (end-start-2-len(encoded)) + b">"
    return candidate[:start] + gap + candidate[end:]


def resign_cms(candidate, algorithm, sign):
    """Preserve signed PDF bytes while forging a different synthetic CMS algorithm."""
    from io import BytesIO
    from asn1crypto import cms
    from pyhanko.pdf_utils.reader import PdfFileReader
    sig = PdfFileReader(BytesIO(candidate)).embedded_signatures[-1]
    content = cms.ContentInfo.load(bytes(sig.sig_object['/Contents']))
    signer_info = content['content']['signer_infos'][0]
    signer_info['signature_algorithm'] = algorithm
    for attr in signer_info['signed_attrs']:
        if attr['type'].native == 'cms_algorithm_protection':
            attr['values'][0]['signature_algorithm'] = algorithm
    signer_info['signature'] = sign(signer_info['signed_attrs'].untag().dump())
    start, end = sig.byte_range[1], sig.byte_range[2]
    encoded = content.dump().hex().upper().encode('ascii')
    assert len(encoded) <= end-start-2
    return candidate[:start] + b'<' + encoded + b'0'*(end-start-2-len(encoded)) + b'>' + candidate[end:]


def with_price_metadata(data, price, *, header_price=None):
    from io import BytesIO
    from pyhanko.pdf_utils import generic as g
    from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
    document = IncrementalPdfFileWriter(BytesIO(data))
    document._update_meta = lambda: None
    xml = ('<x:xmpmeta xmlns:x="adobe:ns:meta/">'
           '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
           f'<rdf:Description xmlns:biz="urn:test" biz:price="{price}" rdf:about=""/>'
           '</rdf:RDF></x:xmpmeta>').encode()
    metadata = g.StreamObject({g.pdf_name('/Type'): g.pdf_name('/Metadata'),
                              g.pdf_name('/Subtype'): g.pdf_name('/XML')}, stream_data=xml)
    if header_price is not None:
        metadata[g.pdf_name('/CommercialPrice')] = g.pdf_string(header_price)
    document.root[g.pdf_name('/Metadata')] = document.add_object(metadata)
    document.update_root()
    output = BytesIO()
    document.write(output)
    return output.getvalue()

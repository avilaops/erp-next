"""Restricted incremental PDF policy. Parser isolation remains a service gate."""
from io import BytesIO
import hashlib
import json
import logging

from pyhanko.pdf_utils import generic as g
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.sign.diff_analysis import DEFAULT_DIFF_POLICY, DiffResult, ModificationLevel, StandardDiffPolicy
from pyhanko.sign.diff_analysis.form_rules_api import FormUpdatingRule
from pyhanko.sign.diff_analysis.rules.form_field_rules import SigFieldCreationRule, SigFieldModificationRule
from pyhanko.sign.validation.generic_cms import validate_sig_integrity
from pyhanko.sign.validation.status import SignatureCoverageLevel

from .model import SignatureInventoryItem, Verdict

# This private validator returns structured reason codes. Third-party messages
# can contain certificate subjects or form values and must not reach app logs.
for _namespace in ("pyhanko", "pyhanko_certvalidator"):
    logging.getLogger(_namespace).setLevel(logging.CRITICAL + 1)


class PdfPolicyError(Exception):
    def __init__(self, reason, verdict=Verdict.INVALID, *, timestamp=False):
        super().__init__(reason)
        self.reason, self.verdict, self.timestamp = reason, verdict, timestamp


def sha256(value):
    return hashlib.sha256(value).hexdigest()


def open_pdf(data, policy, *, base=False):
    limit = policy.base_max_bytes if base else policy.candidate_max_bytes
    if not isinstance(data, bytes) or not 0 < len(data) <= limit:
        raise PdfPolicyError("pdf_size_unsupported", Verdict.UNSUPPORTED)
    reader = PdfFileReader(BytesIO(data), strict=True)
    if "/Encrypt" in reader.trailer:
        raise PdfPolicyError("encrypted_pdf_unsupported", Verdict.UNSUPPORTED)
    if reader.xrefs.total_revisions > policy.max_revisions or int(reader.trailer["/Size"]) > policy.max_objects:
        raise PdfPolicyError("pdf_complexity_unsupported", Verdict.UNSUPPORTED)
    pages = reader.root["/Pages"]
    if int(pages["/Count"]) > policy.max_pages:
        raise PdfPolicyError("pdf_complexity_unsupported", Verdict.UNSUPPORTED)
    return reader


def _canonical(value, *, link=False, depth=0, seen=frozenset(), budget=None):
    budget = [0] if budget is None else budget
    budget[0] += 1
    if depth > 40 or budget[0] > 10000:
        raise PdfPolicyError("pdf_object_graph_unsupported", Verdict.UNSUPPORTED)
    if isinstance(value, g.IndirectObject):
        ref = (value.idnum, value.generation)
        if link:
            return ["reference", *ref]
        if ref in seen:
            raise PdfPolicyError("pdf_object_cycle_unsupported", Verdict.UNSUPPORTED)
        return _canonical(value.get_object(), depth=depth+1, seen=seen | {ref}, budget=budget)
    if value is None:
        return ["absent"]
    if isinstance(value, g.DictionaryObject):
        if str(value.get("/S", "")) in {"/JavaScript", "/Launch", "/SubmitForm", "/ImportData", "/GoToR", "/GoToE", "/Rendition"}:
            raise PdfPolicyError("active_pdf_unsupported", Verdict.UNSUPPORTED)
        result = [[str(key), _canonical(value.raw_get(key), link=str(key) in {"/P", "/Parent", "/Data"},
                   depth=depth+1, seen=seen, budget=budget)] for key in sorted(value, key=str)]
        if isinstance(value, g.StreamObject):
            result.append(["encodedStreamSha256", sha256(value.encoded_data)])
        return ["dictionary", result]
    if isinstance(value, (g.ArrayObject, list, tuple)):
        return ["array", [_canonical(item, depth=depth+1, seen=seen, budget=budget) for item in value]]
    if isinstance(value, (g.NameObject, g.TextStringObject, g.ByteStringObject, g.NumberObject,
                          g.FloatObject, g.BooleanObject, g.NullObject)):
        stream = BytesIO()
        value.write_to_stream(stream)
        return [type(value).__name__, sha256(stream.getvalue())]
    raise PdfPolicyError("pdf_object_type_unsupported", Verdict.UNSUPPORTED)


def fingerprint(value):
    return sha256(json.dumps(_canonical(value), sort_keys=True, separators=(",", ":")).encode())


def fields(reader):
    form = reader.root.get("/AcroForm")
    result = {}
    if form is None:
        return result
    form = form.get_object()

    def walk(items, prefix="", depth=0):
        if depth > 20 or len(result) > 1000:
            raise PdfPolicyError("pdf_fields_unsupported", Verdict.UNSUPPORTED)
        for raw in items:
            value = raw.get_object()
            name = str(value.get("/T", ""))
            if not name:
                continue
            qualified = f"{prefix}.{name}" if prefix else name
            if qualified in result:
                raise PdfPolicyError("ambiguous_pdf_fields")
            result[qualified] = (fingerprint(value), value)
            walk(value.get("/Kids", []), qualified, depth+1)
    walk(form.get("/Fields", []))
    return result


def _dictionary_except(value, excluded):
    if value is None:
        return None
    value = value.get_object()
    return g.DictionaryObject({key: value.raw_get(key) for key in value if str(key) not in excluded})


def assert_frozen_fields(parent, candidate, new_signature):
    before, after = fields(parent), fields(candidate)
    if set(after) - set(before) != {new_signature.field_name} or not set(before) <= set(after):
        raise PdfPolicyError("unexpected_form_fields")
    if any(before[name][0] != after[name][0] for name in before):
        raise PdfPolicyError("existing_field_modified")
    original_form = _dictionary_except(parent.root.get("/AcroForm"), {"/Fields"})
    next_form = _dictionary_except(candidate.root.get("/AcroForm"), {"/Fields"})
    if fingerprint(original_form) != fingerprint(next_form):
        raise PdfPolicyError("acroform_configuration_modified")
    for key in ("/Perms", "/OpenAction", "/AA"):
        if fingerprint(parent.root.get(key)) != fingerprint(candidate.root.get(key)):
            raise PdfPolicyError("document_permissions_modified")
    old_info = _dictionary_except(parent.trailer["/Info"] if "/Info" in parent.trailer else None, {"/ModDate", "/Producer"})
    new_info = _dictionary_except(candidate.trailer["/Info"] if "/Info" in candidate.trailer else None, {"/ModDate", "/Producer"})
    if fingerprint(old_info) != fingerprint(new_info):
        raise PdfPolicyError("document_metadata_modified")
    field = new_signature.sig_field
    if field.get("/A") is not None or field.get("/AA") is not None:
        raise PdfPolicyError("active_pdf_unsupported", Verdict.UNSUPPORTED)

    def invisible(value):
        value = value.get_object()
        rect = value.get("/Rect")
        if rect is not None:
            if len(rect) != 4:
                raise PdfPolicyError("invalid_signature_rectangle")
            left, bottom, right, top = (float(item) for item in rect)
            if right != left and top != bottom:
                raise PdfPolicyError("visible_signature_unsupported", Verdict.UNSUPPORTED)
        for child in value.get("/Kids", []):
            invisible(child)
    invisible(field)
    fingerprint(field)  # Reject active/cyclic unsupported objects in the new field.


def signature_inventory(signatures):
    return tuple(SignatureInventoryItem(sig.field_name, sha256(bytes(sig.sig_object["/Contents"])),
        sha256(sig.signer_cert.dump()), fingerprint(sig.sig_field)) for sig in signatures)


def check_signatures(reader, policy):
    signatures = reader.embedded_signatures
    if not signatures or len(signatures) > policy.max_signatures:
        raise PdfPolicyError("signature_count_unsupported", Verdict.UNSUPPORTED)
    if len({sig.field_name for sig in signatures}) != len(signatures):
        raise PdfPolicyError("ambiguous_signature_fields")
    for sig in signatures:
        if str(sig.sig_object.get("/Type", "")) == "/DocTimeStamp" or any(
            attr["type"].native == "signature_time_stamp_token" for attr in sig.signer_info["unsigned_attrs"]):
            raise PdfPolicyError("timestamp_policy_unsupported", Verdict.UNSUPPORTED, timestamp=True)
        algorithm = sig.signer_info["signature_algorithm"].signature_algo
        public_key = sig.signer_cert.public_key
        if sig.md_algorithm not in policy.allowed_hashes or algorithm not in policy.allowed_signatures:
            raise PdfPolicyError("signature_algorithm_unsupported", Verdict.UNSUPPORTED)
        if public_key.algorithm in {"rsa", "rsassa_pss"}:
            if public_key.bit_size < policy.min_rsa_bits:
                raise PdfPolicyError("signature_algorithm_unsupported", Verdict.UNSUPPORTED)
        elif public_key.algorithm == "ec":
            if public_key["algorithm"]["parameters"].native not in policy.allowed_curves:
                raise PdfPolicyError("signature_algorithm_unsupported", Verdict.UNSUPPORTED)
        else:
            raise PdfPolicyError("signature_algorithm_unsupported", Verdict.UNSUPPORTED)
        if len(sig.byte_range) != 4 or int(sig.byte_range[0]) != 0:
            raise PdfPolicyError("invalid_signature_byte_range")
        intact, valid = validate_sig_integrity(sig.signer_info, sig.signer_cert,
            expected_content_type="data", actual_digest=sig.compute_digest())
        if not intact or not valid:
            raise PdfPolicyError("signature_integrity_invalid")
        sig.compute_integrity_info(diff_policy=DEFAULT_DIFF_POLICY)
        info = sig.summarise_integrity_info()
        if sig.coverage not in {SignatureCoverageLevel.ENTIRE_FILE, SignatureCoverageLevel.ENTIRE_REVISION}:
            raise PdfPolicyError("signature_coverage_invalid")
        if info.get("docmdp_ok") is not True:
            raise PdfPolicyError("signature_modifications_invalid")
    if signatures[-1].coverage != SignatureCoverageLevel.ENTIRE_FILE:
        raise PdfPolicyError("unsigned_pdf_tail")
    return signatures


def check_increment(parent, candidate):
    restricted = StandardDiffPolicy(DEFAULT_DIFF_POLICY.global_rules, FormUpdatingRule([
        SigFieldCreationRule(allow_new_visible_after_certify=False),
        SigFieldModificationRule(allow_in_place_appearance_stream_changes=False),
    ]), ignore_orphaned_objects=False, ignore_identical_objects=False)
    result = restricted.review_file(candidate, parent.xrefs.total_revisions-1)
    if not isinstance(result, DiffResult) or result.modification_level > ModificationLevel.FORM_FILLING:
        raise PdfPolicyError("unauthorized_pdf_increment")

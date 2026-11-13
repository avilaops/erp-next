"""Explicit immutable trust. Supplied certificates never select their anchors."""
from dataclasses import dataclass, field
from functools import lru_cache
import hashlib
from importlib.resources import files
import json
import re

from asn1crypto import x509 as asn1_x509
from cryptography import x509
from cryptography.hazmat.primitives import serialization


@lru_cache(maxsize=1)
def _registry():
    raw = files("contract_signature_validator").joinpath("trust_registry.json").read_bytes()
    data = json.loads(raw)
    return frozenset(root["sha256"] for root in data["roots"]), hashlib.sha256(raw).hexdigest()


def _certificates(pem: bytes) -> tuple[bytes, ...]:
    if not isinstance(pem, bytes) or len(pem) > 32 * 1024 * 1024:
        raise ValueError("invalid_trust_bundle")
    if not pem:
        return ()
    blocks = re.compile(rb"-----BEGIN CERTIFICATE-----[A-Za-z0-9+/=\t\r\n ]+-----END CERTIFICATE-----")
    if blocks.sub(b"", pem).strip():
        raise ValueError("unexpected_pem_material")
    certs = x509.load_pem_x509_certificates(pem)
    if not certs:
        raise ValueError("empty_trust_material")
    result = []
    for cert in certs:
        try:
            ca = cert.extensions.get_extension_for_class(x509.BasicConstraints).value.ca
        except x509.ExtensionNotFound:
            ca = False
        if not ca:
            raise ValueError("non_ca_trust_material")
        result.append(cert.public_bytes(serialization.Encoding.DER))
    return tuple(sorted(set(result)))


@dataclass(frozen=True)
class TrustBundle:
    root_der: tuple[bytes, ...] = field(repr=False)
    intermediate_der: tuple[bytes, ...] = field(repr=False)
    profile: str
    registry_sha256: str = field(init=False)

    def __post_init__(self):
        pinned, registry_hash = _registry()
        if not self.root_der or self.profile not in {"icp_brasil", "synthetic_not_icp"}:
            raise ValueError("invalid_trust_profile")
        if any(not isinstance(v, tuple) or any(not isinstance(c, bytes) for c in v)
               for v in (self.root_der, self.intermediate_der)):
            raise ValueError("invalid_trust_material")
        if self.profile == "icp_brasil" and not {hashlib.sha256(c).hexdigest() for c in self.root_der} <= pinned:
            raise ValueError("unapproved_trust_anchor")
        object.__setattr__(self, "registry_sha256", registry_hash)

    @property
    def roots(self):
        return tuple(asn1_x509.Certificate.load(c, strict=True) for c in self.root_der)

    @property
    def intermediates(self):
        return tuple(asn1_x509.Certificate.load(c, strict=True) for c in self.intermediate_der)

    @property
    def sha256(self):
        data = {"profile": self.profile, "registrySha256": self.registry_sha256,
                "roots": sorted(hashlib.sha256(c).hexdigest() for c in self.root_der),
                "intermediates": sorted(hashlib.sha256(c).hexdigest() for c in self.intermediate_der)}
        return hashlib.sha256(json.dumps(data, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def load_trust_bundle(roots_pem: bytes, intermediates_pem: bytes = b"", *, allow_synthetic=False) -> TrustBundle:
    if type(allow_synthetic) is not bool:
        raise ValueError("invalid_trust_profile")
    return TrustBundle(_certificates(roots_pem), _certificates(intermediates_pem),
                       "synthetic_not_icp" if allow_synthetic else "icp_brasil")

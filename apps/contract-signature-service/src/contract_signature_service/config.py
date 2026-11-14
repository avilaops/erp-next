"""Locally configured trust and policy. Requests never select trust anchors."""
from dataclasses import dataclass, field
import hashlib
import os
from pathlib import Path
import stat

from contract_signature_validator.model import ValidationPolicy
from contract_signature_validator.transport import strict_json
from contract_signature_validator.trust import TrustBundle, load_trust_bundle
from .egress import NetworkPolicy


@dataclass(frozen=True)
class ServiceConfig:
    trust: TrustBundle = field(repr=False)
    network_policy: NetworkPolicy = field(repr=False)
    policy: ValidationPolicy = field(default_factory=ValidationPolicy)

    def __post_init__(self):
        if (not isinstance(self.trust, TrustBundle) or not isinstance(self.network_policy, NetworkPolicy)
            or not isinstance(self.policy, ValidationPolicy)):
            raise ValueError('invalid_service_configuration')


class ConfigurationError(ValueError):
    def __init__(self):
        super().__init__('invalid_service_configuration')


def read_local_file(path, maximum):
    """Only fixed local regular files; do not follow a substituted final symlink."""
    path = Path(path)
    if not path.is_absolute() or path.is_symlink(): raise ConfigurationError()
    descriptor = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0))
    with os.fdopen(descriptor, 'rb') as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > maximum: raise ConfigurationError()
        raw = source.read(maximum+1)
        if len(raw) > maximum: raise ConfigurationError()
        return raw


def load_config(root):
    """Production loader never offers a synthetic trust flag or environment switch."""
    try:
        root = Path(root)
        if not root.is_absolute() or root.is_symlink(): raise ConfigurationError()
        roots = read_local_file(root / 'roots.pem', 4*1024*1024)
        intermediates = read_local_file(root / 'intermediates.pem', 4*1024*1024-len(roots))
        rules = strict_json(read_local_file(root / 'evidence-origins.json', 32768), max_bytes=32768)
        if (type(rules) is not dict or set(rules) != {'schemaVersion', 'rules', 'provenance'}
            or rules['schemaVersion'] != 'avila-evidence-origins/1'
            or rules['provenance'] != {'rootsPemSha256': hashlib.sha256(roots).hexdigest(),
                                      'intermediatesPemSha256': hashlib.sha256(intermediates).hexdigest()}
            or type(rules['rules']) is not dict
            or any(type(prefixes) is not list for prefixes in rules['rules'].values())):
            raise ConfigurationError()
        policy = NetworkPolicy({origin: tuple(prefixes) for origin, prefixes in rules['rules'].items()})
        return ServiceConfig(load_trust_bundle(roots, intermediates), policy)
    except (OSError, ValueError, TypeError, KeyError, OverflowError):
        raise ConfigurationError() from None

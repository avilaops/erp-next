"""Single-threaded resource-limit bootstrap, before exec of the trusted child command."""
import os
import sys


def main():
    if sys.platform != 'linux' or len(sys.argv) < 3:
        return 78
    import resource
    from .sandbox import PROFILES
    profile = PROFILES.get(sys.argv[1])
    if profile is None or not os.path.isabs(sys.argv[2]):
        return 78
    resource.setrlimit(resource.RLIMIT_CPU, profile.cpu)
    resource.setrlimit(resource.RLIMIT_AS, (profile.address_space, profile.address_space))
    resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    os.execve(sys.argv[2], sys.argv[2:], dict(os.environ))
    return 78


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        sys.exit(78)

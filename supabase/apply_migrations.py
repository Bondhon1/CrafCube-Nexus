"""Apply supabase/migrations/*.sql in filename order.

Reads SUPABASE_DB_URL from the environment, or from supabase/.env.local or
apps/desktop/.env.local (both gitignored) so the password never has to be typed
into a shell. The URL is split by hand rather than with urlparse: Supabase
passwords routinely contain '@' and ':', which urlparse mis-splits unless the
user percent-encodes them first.

Each file runs in its own transaction; a failure rolls that file back and stops.
"""
from __future__ import annotations

import os
import pathlib
import re
import socket
import sys

import psycopg2

ROOT = pathlib.Path(__file__).resolve().parent
CANDIDATES = [ROOT / ".env.local", ROOT.parent / "apps" / "desktop" / ".env.local"]


def raw_url() -> str:
    url = os.environ.get("SUPABASE_DB_URL")
    if url:
        return url.strip()
    for path in CANDIDATES:
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("SUPABASE_DB_URL="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit(
        "No connection string. Set SUPABASE_DB_URL, or add it to one of:\n  "
        + "\n  ".join(str(p) for p in CANDIDATES)
    )


def connection_params(url: str) -> dict[str, object]:
    """Split postgresql://user:pass@host:port/db without choking on '@' in pass."""
    for prefix in ("postgresql://", "postgres://"):
        if url.startswith(prefix):
            url = url[len(prefix) :]
            break
    else:
        sys.exit("Connection string must start with postgresql:// or postgres://")

    url = url.split("?", 1)[0]
    # The host is after the LAST '@'; everything before it is user:password.
    creds, _, hostpart = url.rpartition("@")
    if not creds:
        sys.exit("Connection string is missing user:password@")

    user, _, password = creds.partition(":")
    hostport, _, database = hostpart.partition("/")
    host, _, port = hostport.partition(":")

    return {
        "user": user,
        "password": password,
        "host": host,
        "port": int(port or 5432),
        "dbname": database or "postgres",
        "sslmode": "require",
        "connect_timeout": 20,
    }


def resolves_on_ipv4(host: str) -> bool:
    try:
        socket.getaddrinfo(host, None, socket.AF_INET)
        return True
    except OSError:
        return False


# Supabase direct hosts (db.<ref>.supabase.co) publish only AAAA records, so
# they are unreachable from an IPv4-only network. The session pooler is
# IPv4-capable; it is reached in the project's own region with the tenant-
# qualified username postgres.<ref>.
POOLER_REGIONS = [
    "ap-southeast-1", "ap-south-1", "us-east-1", "us-west-1",
    "eu-central-1", "eu-west-2", "ap-northeast-1", "ap-southeast-2", "sa-east-1",
]


def pooler_fallbacks(params: dict[str, object]) -> list[dict[str, object]]:
    match = re.fullmatch(r"db\.([a-z0-9]+)\.supabase\.co", str(params["host"]))
    if not match:
        return []
    ref = match.group(1)
    out = []
    for region in POOLER_REGIONS:
        for index in (0, 1):
            host = f"aws-{index}-{region}.pooler.supabase.com"
            if not resolves_on_ipv4(host):
                continue
            candidate = dict(params)
            candidate.update(host=host, port=5432, user=f"postgres.{ref}",
                             connect_timeout=8)
            out.append(candidate)
    return out


def connect(params: dict[str, object]):
    """Connect directly, falling back to the regional pooler on IPv4-only hosts."""
    attempts = [params]
    if not resolves_on_ipv4(str(params["host"])):
        print(f"{params['host']} has no IPv4 address; trying the session pooler…")
        attempts = pooler_fallbacks(params) or attempts

    last: Exception | None = None
    for candidate in attempts:
        try:
            conn = psycopg2.connect(**candidate)
            print(f"Connected to {candidate['host']}:{candidate['port']} "
                  f"as {candidate['user']}")
            return conn
        except psycopg2.OperationalError as exc:
            last = exc
    raise last if last else RuntimeError("no connection attempted")


def main() -> int:
    params = connection_params(raw_url())
    files = sorted((ROOT / "migrations").glob("*.sql"))
    if not files:
        sys.exit("No migration files found.")

    try:
        conn = connect(params)
    except Exception as exc:  # noqa: BLE001
        print(f"CONNECT FAILED: {exc}")
        return 2

    try:
        for path in files:
            sql = path.read_text(encoding="utf-8")
            try:
                with conn, conn.cursor() as cur:
                    cur.execute(sql)
            except Exception as exc:  # noqa: BLE001 - report and stop
                print(f"FAIL  {path.name}\n{exc}")
                return 1
            print(f"OK    {path.name}")
    finally:
        conn.close()

    print(f"\nApplied {len(files)} migration(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

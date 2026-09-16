"""Assemble the local engine as a self-contained folder the installer ships.

    python scripts/build-engine.py

Output: apps/desktop/engine-bundle/, copied by electron-builder into
resources/local-engine/ inside the installed app.

Why not ship services/local-engine/.venv? A virtual environment is not
relocatable: its pyvenv.cfg names the base interpreter by absolute path on the
build machine, so it breaks on every other computer. The official Python
*embeddable* distribution is designed for exactly this — a private interpreter
inside an application — so the bundle is that plus the engine's own packages.

The slicer is deliberately not in here. It is 164 MB, many users already have
one installed, and the desktop app downloads it in the background only when
they do not.
"""
from __future__ import annotations

import hashlib
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENGINE = ROOT / "services" / "local-engine"
OUT = ROOT / "apps" / "desktop" / "engine-bundle"
CACHE = ROOT / "tools" / "python-embed"

PYTHON_VERSION = "3.12.6"
PYTHON_TAG = "312"
EMBED_NAME = f"python-{PYTHON_VERSION}-embed-amd64.zip"
EMBED_URL = f"https://www.python.org/ftp/python/{PYTHON_VERSION}/{EMBED_NAME}"
# Pinned. Cross-checked against python.org's release API, which publishes the
# MD5 ae256f31ee4700eba679802233bff3e9 and size 11,061,146 for this file.
EMBED_SHA256 = "a86a2e28870967745d255cc597d1e4d19ae79e65e927cdc324baa0256202231c"

# Package test suites are never imported at runtime. numpy and networkx ship
# large ones.
PRUNE_DIRS = {"tests", "test", "testing", "__pycache__"}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fetch_embeddable() -> Path:
    CACHE.mkdir(parents=True, exist_ok=True)
    archive = CACHE / EMBED_NAME
    if not archive.exists():
        print(f"downloading {EMBED_URL}")
        partial = archive.with_suffix(".part")
        urllib.request.urlretrieve(EMBED_URL, partial)
        partial.replace(archive)

    actual = sha256(archive)
    if actual != EMBED_SHA256:
        archive.unlink()
        sys.exit(f"{EMBED_NAME} failed its checksum ({actual}); refusing to bundle it")
    return archive


def write_path_file(python_dir: Path) -> None:
    """Point the interpreter at its packages and at the engine's code.

    With a ._pth file present, Python ignores PYTHONPATH, PYTHONHOME and the
    registry entirely. That is what keeps a user's own Python installation, or
    an environment variable they set years ago, from leaking into the engine.
    """
    (python_dir / f"python{PYTHON_TAG}._pth").write_text(
        "\n".join([
            f"python{PYTHON_TAG}.zip",
            ".",
            r"Lib\site-packages",
            # The bundle root, where app/ lives, so `-m uvicorn app.main:app`
            # resolves regardless of the working directory.
            "..",
            "import site",
            "",
        ]),
        encoding="utf-8",
    )


def install_packages(python_dir: Path) -> None:
    target = python_dir / "Lib" / "site-packages"
    target.mkdir(parents=True, exist_ok=True)
    # Resolved for the bundle's platform and version, not the build machine's,
    # and wheels only: nothing is compiled during a build.
    subprocess.run(
        [
            sys.executable, "-m", "pip", "install",
            "--disable-pip-version-check", "--no-compile", "--quiet",
            # Conflict warnings would describe the build machine's own global
            # packages, not the bundle.
            "--no-warn-conflicts",
            "--target", str(target),
            "--platform", "win_amd64",
            "--python-version", PYTHON_VERSION,
            "--implementation", "cp",
            "--only-binary=:all:",
            "-r", str(ENGINE / "requirements.txt"),
        ],
        check=True,
    )


def copy_engine_code() -> None:
    shutil.copytree(
        ENGINE / "app", OUT / "app",
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )


def prune(root: Path) -> int:
    removed = 0
    for path in sorted(root.rglob("*"), key=lambda p: len(p.parts), reverse=True):
        if path.is_dir() and path.name in PRUNE_DIRS:
            shutil.rmtree(path, ignore_errors=True)
            removed += 1
    return removed


def folder_mb(path: Path) -> float:
    return sum(p.stat().st_size for p in path.rglob("*") if p.is_file()) / (1 << 20)


def main() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    python_dir = OUT / "python"
    python_dir.mkdir(parents=True)

    with zipfile.ZipFile(fetch_embeddable()) as archive:
        archive.extractall(python_dir)
    write_path_file(python_dir)
    install_packages(python_dir)
    copy_engine_code()
    pruned = prune(OUT)

    print(f"engine bundle: {OUT}")
    print(f"  interpreter + packages {folder_mb(python_dir):6.1f} MB")
    print(f"  engine code            {folder_mb(OUT / 'app'):6.1f} MB")
    print(f"  pruned {pruned} test/cache folders")


if __name__ == "__main__":
    main()

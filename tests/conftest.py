"""Pytest configuration for AegisArena direct-mode tests.

On Windows the gltest direct runner injects the transaction message context by
dup2-ing a temp file onto stdin (fd 0) and then calling os.unlink on that file
while fd 0 still holds it open. Windows raises PermissionError on unlink of an
open file, which crashes deployment. This shim defers those unlink calls until
interpreter exit (after stdin is restored), so direct tests run cleanly.
"""

from __future__ import annotations

import atexit
import os
import sys

import pytest

# --- Windows os.unlink stdin temp-file lock shim -----------------------------
_DEFERRED_UNLINKS: list[str] = []

if os.name == "nt":
    _original_unlink = os.unlink

    def _deferred_unlink(path, *args, **kwargs):  # pragma: no cover - env specific
        try:
            return _original_unlink(path, *args, **kwargs)
        except PermissionError:
            # fd 0 still references the temp file; retry at interpreter exit.
            try:
                _DEFERRED_UNLINKS.append(os.fspath(path))
            except (TypeError, ValueError):
                pass
            return None

    os.unlink = _deferred_unlink
    os.remove = _deferred_unlink

    def _flush_deferred_unlinks() -> None:  # pragma: no cover - env specific
        for stale in _DEFERRED_UNLINKS:
            try:
                _original_unlink(stale)
            except OSError:
                pass

    atexit.register(_flush_deferred_unlinks)


@pytest.fixture
def contract_path() -> str:
    return os.path.join(os.path.dirname(__file__), "..", "contracts", "aegis_arena.py")

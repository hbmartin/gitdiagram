"""Cross-language parity: the TS and Python pipelines share one contract.

The TS side is dumped with bun (scripts/parity/dump-contract.ts) and compared
section by section against the Python implementation. Any divergence in
prompts, pricing, limits, truncation behavior, or compiled Mermaid fails here
instead of drifting silently in production.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent

sys.path.insert(0, str(BACKEND_ROOT / "scripts"))

from dump_contract import build_contract  # noqa: E402


@pytest.fixture(scope="module")
def ts_contract() -> dict:
    bun = shutil.which("bun")
    if not bun:
        pytest.skip("bun is not available; TS contract cannot be dumped")
    result = subprocess.run(
        [bun, str(REPO_ROOT / "scripts" / "parity" / "dump-contract.ts")],
        capture_output=True,
        text=True,
        timeout=120,
        cwd=REPO_ROOT,
    )
    assert result.returncode == 0, f"contract dump failed: {result.stderr}"
    return json.loads(result.stdout)


@pytest.fixture(scope="module")
def py_contract() -> dict:
    return build_contract()


@pytest.mark.parametrize(
    "section",
    [
        "prompts",
        "pricing",
        "limits",
        "graph_limits",
        "tree_budget",
        "compiled_mermaid",
    ],
)
def test_contract_section_parity(ts_contract: dict, py_contract: dict, section: str):
    assert ts_contract[section] == py_contract[section]


def test_compiled_mermaid_matches_golden(py_contract: dict):
    golden = (REPO_ROOT / "shared" / "fixtures" / "expected-mermaid.mmd").read_text()
    assert py_contract["compiled_mermaid"] == golden.rstrip("\n")

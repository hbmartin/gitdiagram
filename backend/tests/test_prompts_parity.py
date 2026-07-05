"""Prompt parity without requiring bun: extract the TS template literals from
src/server/generate/prompts.ts and compare them to the Python prompts."""

from __future__ import annotations

import re
from pathlib import Path

from app.prompts import SYSTEM_FIRST_PROMPT, SYSTEM_GRAPH_PROMPT

PROMPTS_TS = (
    Path(__file__).resolve().parents[2] / "src" / "server" / "generate" / "prompts.ts"
)


def _extract_ts_template_literal(source: str, export_name: str) -> str:
    pattern = re.compile(
        rf"export const {re.escape(export_name)} = `(.*?)`;",
        re.DOTALL,
    )
    match = pattern.search(source)
    assert match, f"{export_name} not found in prompts.ts"
    return match.group(1)


def test_prompts_are_textually_identical():
    source = PROMPTS_TS.read_text()
    assert _extract_ts_template_literal(source, "SYSTEM_FIRST_PROMPT") == (
        SYSTEM_FIRST_PROMPT
    )
    assert _extract_ts_template_literal(source, "SYSTEM_GRAPH_PROMPT") == (
        SYSTEM_GRAPH_PROMPT
    )

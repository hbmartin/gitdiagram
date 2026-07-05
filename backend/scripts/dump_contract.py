"""Builds the Python side of the backend contract for parity testing.

Mirrors scripts/parity/dump-contract.ts — both must produce identical JSON.
Run standalone with:  python backend/scripts/dump_contract.py
"""

from __future__ import annotations

import json
import sys
from dataclasses import fields as dataclass_fields
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.prompts import SYSTEM_FIRST_PROMPT, SYSTEM_GRAPH_PROMPT  # noqa: E402
from app.routers.generate import (  # noqa: E402
    FREE_GENERATION_INPUT_TOKEN_LIMIT,
    HARD_GENERATION_INPUT_TOKEN_LIMIT,
)
from app.services.graph_service import (  # noqa: E402
    MAX_GRAPH_ATTEMPTS,
    MAX_GRAPH_EDGES,
    MAX_GRAPH_GROUPS,
    MAX_GRAPH_NODES,
    DiagramGraph,
    compile_diagram_graph,
)
from app.services.pricing import (  # noqa: E402
    EXPLANATION_MAX_OUTPUT_TOKENS,
    GRAPH_MAX_OUTPUT_TOKENS,
    MODEL_PRICING,
    resolve_pricing_model,
)
from app.services.tree_budget import (  # noqa: E402
    MIN_TREE_TOKEN_BUDGET,
    TRUNCATION_TOKEN_MARGIN,
    build_file_tree_sample_note,
    fit_file_tree_to_token_budget,
)

FIXTURES_DIR = REPO_ROOT / "shared" / "fixtures"

PRICING_SAMPLE_MODELS = [
    "gpt-5.4-mini",
    "openai/gpt-5.4",
    "gpt-5.2-2025-11-04",
    "unknown-model-id",
]

# The pydantic schema encodes these as Field max_lengths; they are asserted
# against the TS constants via the contract, so keep them explicit here.
MAX_GRAPH_LABEL_LENGTH = 72
MAX_GRAPH_TYPE_LENGTH = 72
MAX_GRAPH_DESCRIPTION_LENGTH = 240
MAX_GRAPH_PATH_LENGTH = 512


def build_contract() -> dict:
    graph_fixture = DiagramGraph.model_validate(
        json.loads((FIXTURES_DIR / "diagram-graph.json").read_text())
    )
    file_tree_fixture = (FIXTURES_DIR / "file-tree.txt").read_text().strip()
    truncated = fit_file_tree_to_token_budget(file_tree_fixture, 500)

    return {
        "prompts": {
            "system_first": SYSTEM_FIRST_PROMPT,
            "system_graph": SYSTEM_GRAPH_PROMPT,
        },
        "pricing": {
            "models": {
                model: {
                    "input_per_million_usd": pricing.input_per_million_usd,
                    "output_per_million_usd": pricing.output_per_million_usd,
                }
                for model, pricing in MODEL_PRICING.items()
            },
            "resolved_sample_models": {
                model: resolve_pricing_model(model)
                for model in PRICING_SAMPLE_MODELS
            },
            "explanation_max_output_tokens": EXPLANATION_MAX_OUTPUT_TOKENS,
            "graph_max_output_tokens": GRAPH_MAX_OUTPUT_TOKENS,
        },
        "limits": {
            "free_generation_input_token_limit": FREE_GENERATION_INPUT_TOKEN_LIMIT,
            "hard_generation_input_token_limit": HARD_GENERATION_INPUT_TOKEN_LIMIT,
        },
        "graph_limits": {
            "max_groups": MAX_GRAPH_GROUPS,
            "max_nodes": MAX_GRAPH_NODES,
            "max_edges": MAX_GRAPH_EDGES,
            "max_label_length": MAX_GRAPH_LABEL_LENGTH,
            "max_type_length": MAX_GRAPH_TYPE_LENGTH,
            "max_description_length": MAX_GRAPH_DESCRIPTION_LENGTH,
            "max_path_length": MAX_GRAPH_PATH_LENGTH,
            "max_attempts": MAX_GRAPH_ATTEMPTS,
        },
        "tree_budget": {
            "min_tree_token_budget": MIN_TREE_TOKEN_BUDGET,
            "truncation_token_margin": TRUNCATION_TOKEN_MARGIN,
            "fixture_truncated_tree": truncated.file_tree,
            "fixture_sample": (
                {
                    "included_paths": truncated.sample.included_paths,
                    "total_paths": truncated.sample.total_paths,
                    "tier": truncated.sample.tier,
                    "note": build_file_tree_sample_note(truncated.sample),
                }
                if truncated.sample is not None
                else None
            ),
        },
        "compiled_mermaid": compile_diagram_graph(
            graph_fixture,
            "acme",
            "demo",
            "main",
        ),
    }


if __name__ == "__main__":
    print(json.dumps(build_contract(), indent=2))

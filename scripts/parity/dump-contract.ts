/**
 * Dumps the language-neutral "backend contract" (prompts, pricing, limits,
 * and deterministic pipeline outputs) as JSON. The FastAPI test suite runs
 * this with bun and diffs it against the Python implementation, so the two
 * backends cannot silently drift apart.
 *
 *   bun scripts/parity/dump-contract.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { diagramGraphSchema } from "../../src/features/diagram/graph";
import {
  MAX_GRAPH_ATTEMPTS,
  MAX_GRAPH_DESCRIPTION_LENGTH,
  MAX_GRAPH_EDGES,
  MAX_GRAPH_GROUPS,
  MAX_GRAPH_LABEL_LENGTH,
  MAX_GRAPH_NODES,
  MAX_GRAPH_PATH_LENGTH,
  MAX_GRAPH_TYPE_LENGTH,
} from "../../src/features/diagram/graph";
import { compileDiagramGraph } from "../../src/server/generate/graph";
import {
  FREE_GENERATION_INPUT_TOKEN_LIMIT,
  HARD_GENERATION_INPUT_TOKEN_LIMIT,
} from "../../src/server/generate/limits";
import {
  EXPLANATION_MAX_OUTPUT_TOKENS,
  GRAPH_MAX_OUTPUT_TOKENS,
  MODEL_PRICING,
  resolvePricingModel,
} from "../../src/server/generate/pricing";
import {
  SYSTEM_FIRST_PROMPT,
  SYSTEM_GRAPH_PROMPT,
} from "../../src/server/generate/prompts";
import {
  buildFileTreeSampleNote,
  fitFileTreeToTokenBudget,
  MIN_TREE_TOKEN_BUDGET,
  TRUNCATION_TOKEN_MARGIN,
} from "../../src/server/generate/tree-budget";

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../shared/fixtures",
);

const graphFixture = diagramGraphSchema.parse(
  JSON.parse(readFileSync(join(fixturesDir, "diagram-graph.json"), "utf-8")),
);
const fileTreeFixture = readFileSync(
  join(fixturesDir, "file-tree.txt"),
  "utf-8",
).trim();

const PRICING_SAMPLE_MODELS = [
  "gpt-5.4-mini",
  "openai/gpt-5.4",
  "gpt-5.2-2025-11-04",
  "unknown-model-id",
];

const truncated = fitFileTreeToTokenBudget(fileTreeFixture, 500);

const contract = {
  prompts: {
    system_first: SYSTEM_FIRST_PROMPT,
    system_graph: SYSTEM_GRAPH_PROMPT,
  },
  pricing: {
    models: Object.fromEntries(
      Object.entries(MODEL_PRICING).map(([model, pricing]) => [
        model,
        {
          input_per_million_usd: pricing.inputPerMillionUsd,
          output_per_million_usd: pricing.outputPerMillionUsd,
        },
      ]),
    ),
    resolved_sample_models: Object.fromEntries(
      PRICING_SAMPLE_MODELS.map((model) => [model, resolvePricingModel(model)]),
    ),
    explanation_max_output_tokens: EXPLANATION_MAX_OUTPUT_TOKENS,
    graph_max_output_tokens: GRAPH_MAX_OUTPUT_TOKENS,
  },
  limits: {
    free_generation_input_token_limit: FREE_GENERATION_INPUT_TOKEN_LIMIT,
    hard_generation_input_token_limit: HARD_GENERATION_INPUT_TOKEN_LIMIT,
  },
  graph_limits: {
    max_groups: MAX_GRAPH_GROUPS,
    max_nodes: MAX_GRAPH_NODES,
    max_edges: MAX_GRAPH_EDGES,
    max_label_length: MAX_GRAPH_LABEL_LENGTH,
    max_type_length: MAX_GRAPH_TYPE_LENGTH,
    max_description_length: MAX_GRAPH_DESCRIPTION_LENGTH,
    max_path_length: MAX_GRAPH_PATH_LENGTH,
    max_attempts: MAX_GRAPH_ATTEMPTS,
  },
  tree_budget: {
    min_tree_token_budget: MIN_TREE_TOKEN_BUDGET,
    truncation_token_margin: TRUNCATION_TOKEN_MARGIN,
    fixture_truncated_tree: truncated.fileTree,
    fixture_sample: truncated.sample
      ? {
          included_paths: truncated.sample.includedPaths,
          total_paths: truncated.sample.totalPaths,
          tier: truncated.sample.tier,
          note: buildFileTreeSampleNote(truncated.sample),
        }
      : null,
  },
  compiled_mermaid: compileDiagramGraph({
    graph: graphFixture,
    username: "acme",
    repo: "demo",
    branch: "main",
  }),
};

console.log(JSON.stringify(contract, null, 2));

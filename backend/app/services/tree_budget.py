from __future__ import annotations

import math
from dataclasses import dataclass

MIN_TREE_TOKEN_BUDGET = 2_000
TRUNCATION_TOKEN_MARGIN = 2_000

_PER_DIRECTORY_CAPS = [20, 10, 5, 2, 1]


def _estimate_tokens(text: str) -> int:
    return 0 if len(text) == 0 else math.ceil(len(text) / 3) + 32


@dataclass(frozen=True)
class FileTreeSample:
    included_paths: int
    total_paths: int
    tier: str

    def to_wire(self) -> dict[str, int | str]:
        return {
            "includedPaths": self.included_paths,
            "totalPaths": self.total_paths,
            "tier": self.tier,
        }


@dataclass(frozen=True)
class TreeBudgetResult:
    file_tree: str
    sample: FileTreeSample | None


def _path_depth(path: str) -> int:
    return len(path.split("/"))


def _parent_directory(path: str) -> str:
    index = path.rfind("/")
    return "" if index == -1 else path[:index]


def _fits(lines: list[str], max_tokens: int) -> bool:
    return _estimate_tokens("\n".join(lines)) <= max_tokens


def _cap_per_directory(lines: list[str], cap: int) -> list[str]:
    counts: dict[str, int] = {}
    kept: list[str] = []
    for line in lines:
        parent = _parent_directory(line)
        count = counts.get(parent, 0)
        if count >= cap:
            continue
        counts[parent] = count + 1
        kept.append(line)
    return kept


def _shallowest_prefix(lines: list[str], max_tokens: int) -> list[str]:
    ordered = [
        line
        for _, _, line in sorted(
            (( _path_depth(line), index, line) for index, line in enumerate(lines)),
        )
    ]
    kept: list[str] = []
    tokens = 0
    for line in ordered:
        line_tokens = _estimate_tokens(line)
        if kept and tokens + line_tokens > max_tokens:
            break
        kept.append(line)
        tokens += line_tokens
    while len(kept) > 1 and not _fits(kept, max_tokens):
        kept.pop()
    return kept


def fit_file_tree_to_token_budget(file_tree: str, max_tokens: int) -> TreeBudgetResult:
    """Shrink a newline-separated file tree until it fits the token budget.

    Tiers, in order of preference (mirrors src/server/generate/tree-budget.ts):
    1. depth: drop the deepest paths first, keeping the shallow structure intact.
    2. per_directory: cap the number of entries per directory.
    3. prefix: keep the shallowest paths that fit, in original order.
    """
    lines = [line for line in file_tree.split("\n") if line.strip()]
    total_paths = len(lines)

    if _fits(lines, max_tokens):
        return TreeBudgetResult(file_tree="\n".join(lines), sample=None)

    def to_result(kept: list[str], tier: str) -> TreeBudgetResult:
        return TreeBudgetResult(
            file_tree="\n".join(kept),
            sample=FileTreeSample(
                included_paths=len(kept),
                total_paths=total_paths,
                tier=tier,
            ),
        )

    max_depth = max(_path_depth(line) for line in lines)
    for depth in range(max_depth - 1, 0, -1):
        kept = [line for line in lines if _path_depth(line) <= depth]
        if kept and _fits(kept, max_tokens):
            return to_result(kept, "depth")

    for cap in _PER_DIRECTORY_CAPS:
        kept = _cap_per_directory(lines, cap)
        if _fits(kept, max_tokens):
            return to_result(kept, "per_directory")

    return to_result(_shallowest_prefix(lines, max_tokens), "prefix")


def build_file_tree_sample_note(sample: FileTreeSample) -> str:
    return (
        f"Showing {sample.included_paths} of {sample.total_paths} repository paths. "
        "The repository is large, so the remaining paths were omitted from this listing."
    )

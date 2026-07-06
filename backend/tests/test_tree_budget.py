import math

from app.services.tree_budget import (
    build_file_tree_sample_note,
    fit_file_tree_to_token_budget,
)


def _estimate_tokens(text: str) -> int:
    return 0 if len(text) == 0 else math.ceil(len(text) / 3) + 32


def _make_tree(paths: list[str]) -> str:
    return "\n".join(paths)


def test_returns_tree_untouched_when_it_fits():
    tree = _make_tree(["src", "src/index.ts", "README.md"])
    result = fit_file_tree_to_token_budget(tree, 10_000)

    assert result.file_tree == tree
    assert result.sample is None


def test_drops_deepest_paths_first():
    paths = [
        "src",
        "src/app",
        "src/app/deep",
        "src/app/deep/nested",
        *[
            f"src/app/deep/nested/really/long/path/file-{i}.ts"
            for i in range(200)
        ],
    ]
    tree = _make_tree(paths)
    budget = _estimate_tokens(_make_tree(paths[:4])) + 50
    result = fit_file_tree_to_token_budget(tree, budget)

    assert result.sample is not None
    assert result.sample.tier == "depth"
    assert result.sample.total_paths == len(paths)
    assert "src/app" in result.file_tree.split("\n")
    assert "file-0.ts" not in result.file_tree
    assert _estimate_tokens(result.file_tree) <= budget


def test_caps_entries_per_directory():
    paths = [f"data/file-{i}.csv" for i in range(500)]
    tree = _make_tree(paths)
    budget = _estimate_tokens(_make_tree(paths[:40]))
    result = fit_file_tree_to_token_budget(tree, budget)

    assert result.sample is not None
    assert result.sample.tier == "per_directory"
    assert _estimate_tokens(result.file_tree) <= budget
    assert result.file_tree.split("\n")[0] == "data/file-0.csv"


def test_prefix_fallback():
    paths = [f"dir-{i}/file.txt" for i in range(400)]
    tree = _make_tree(paths)
    budget = _estimate_tokens(_make_tree(paths[:10]))
    result = fit_file_tree_to_token_budget(tree, budget)

    assert result.sample is not None
    assert result.sample.tier == "prefix"
    assert len(result.file_tree.split("\n")) > 0
    assert _estimate_tokens(result.file_tree) <= budget


def test_deterministic():
    paths = [f"pkg/mod-{i % 7}/file-{i}.go" for i in range(300)]
    tree = _make_tree(paths)
    first = fit_file_tree_to_token_budget(tree, 500)
    second = fit_file_tree_to_token_budget(tree, 500)

    assert first.file_tree == second.file_tree
    assert first.sample == second.sample


def test_sample_note_mentions_counts():
    result = fit_file_tree_to_token_budget(
        _make_tree([f"a/file-{i}.txt" for i in range(200)]), 300
    )
    assert result.sample is not None
    note = build_file_tree_sample_note(result.sample)
    assert str(result.sample.included_paths) in note
    assert str(result.sample.total_paths) in note

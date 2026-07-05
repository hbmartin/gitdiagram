from app.services.diagram_state_repository import (
    _ArtifactLocator,
    is_default_variant,
    normalize_repo_variant,
)
from app.services.github_service import normalize_subdir


def _locator() -> _ArtifactLocator:
    return _ArtifactLocator(
        public_bucket="public-bucket",
        private_bucket="private-bucket",
        cache_key_secret="secret",
    )


def test_normalize_repo_variant_defaults():
    assert normalize_repo_variant(None) == {"ref": None, "subdir": None}
    assert normalize_repo_variant({"ref": "  ", "subdir": ""}) == {
        "ref": None,
        "subdir": None,
    }
    assert normalize_repo_variant({"subdir": "/packages/next/"}) == {
        "ref": None,
        "subdir": "packages/next",
    }


def test_is_default_variant():
    assert is_default_variant(None)
    assert is_default_variant({"ref": None, "subdir": None})
    assert not is_default_variant({"ref": "main"})
    assert not is_default_variant({"subdir": "src"})


def test_default_variant_keeps_legacy_keys():
    bucket, artifact_key, status_key = _locator().resolve_location(
        username="Acme",
        repo="Demo",
        visibility="public",
    )
    assert bucket == "public-bucket"
    assert artifact_key == "public/v1/acme/demo.json"
    assert status_key == "status:v1:public:acme:demo"


def test_variant_keys_match_ts_scheme():
    _bucket, artifact_key, status_key = _locator().resolve_location(
        username="acme",
        repo="demo",
        visibility="public",
        variant={"ref": "Feature/X", "subdir": "packages/next"},
    )
    assert artifact_key == "public/v1/acme/demo/variants/Feature%2FX/packages%2Fnext.json"
    assert status_key == "status:v1:public:acme:demo:Feature%2FX:packages%2Fnext"


def test_variant_placeholder_segments():
    _bucket, ref_only_key, _ = _locator().resolve_location(
        username="acme",
        repo="demo",
        visibility="public",
        variant={"ref": "main"},
    )
    assert ref_only_key == "public/v1/acme/demo/variants/main/@root.json"

    _bucket, subdir_only_key, _ = _locator().resolve_location(
        username="acme",
        repo="demo",
        visibility="public",
        variant={"subdir": "src"},
    )
    assert subdir_only_key == "public/v1/acme/demo/variants/@default/src.json"


def test_normalize_subdir():
    assert normalize_subdir(None) is None
    assert normalize_subdir("  ") is None
    assert normalize_subdir("/src/app/") == "src/app"

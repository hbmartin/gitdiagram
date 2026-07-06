from __future__ import annotations

import base64
import os
import urllib.parse
from datetime import UTC, datetime, timedelta
from dataclasses import dataclass
from threading import Lock

import jwt
import requests

REPOSITORY_TOO_LARGE_ERROR = "Repository is too large (>195k tokens) for analysis. Try a smaller repo."


def _github_api_base() -> str:
    # GITHUB_API_BASE_URL supports GitHub Enterprise hosts and test mocks.
    return (os.getenv("GITHUB_API_BASE_URL") or "").strip().rstrip("/") or "https://api.github.com"
MAX_INCLUDED_FILE_TREE_CHARACTERS = 780_000
MAX_README_BYTES = 750_000

EXCLUDED_PATTERNS = [
    "node_modules/",
    "vendor/",
    "venv/",
    ".min.",
    ".pyc",
    ".pyo",
    ".pyd",
    ".so",
    ".dll",
    ".class",
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".ico",
    ".svg",
    ".ttf",
    ".woff",
    ".webp",
    "__pycache__/",
    ".cache/",
    ".tmp/",
    "yarn.lock",
    "poetry.lock",
    "*.log",
    ".vscode/",
    ".idea/",
]


@dataclass(frozen=True)
class GithubData:
    default_branch: str
    resolved_ref: str
    commit_sha: str | None
    subdir: str | None
    file_tree: str
    readme: str
    is_private: bool
    stargazer_count: int | None


def normalize_subdir(subdir: str | None) -> str | None:
    cleaned = (subdir or "").strip().strip("/")
    return cleaned or None


def _should_include_file(path: str) -> bool:
    lower_path = path.lower()
    return not any(pattern in lower_path for pattern in EXCLUDED_PATTERNS)


def _fetch_json(url: str, headers: dict[str, str], not_found_message: str) -> dict:
    response = requests.get(url, headers=headers, timeout=30)
    if response.status_code == 404:
        raise ValueError(not_found_message)
    if not response.ok:
        raise ValueError(f"GitHub request failed ({response.status_code}): {response.text}")
    return response.json()


class GitHubService:
    _shared_installation_token: str | None = None
    _shared_token_expires_at: datetime | None = None
    _shared_token_lock = Lock()

    def __init__(self, pat: str | None = None):
        # Request-provided PAT (or env PAT) has top priority.
        self.github_token = (pat or os.getenv("GITHUB_PAT") or "").strip() or None

        # GitHub App credentials are used when PAT is unavailable.
        self.client_id = (os.getenv("GITHUB_CLIENT_ID") or "").strip() or None
        self.private_key = (os.getenv("GITHUB_PRIVATE_KEY") or "").strip() or None
        self.installation_id = (os.getenv("GITHUB_INSTALLATION_ID") or "").strip() or None

    def _normalize_private_key(self) -> str:
        if not self.private_key:
            raise ValueError("Missing GITHUB_PRIVATE_KEY.")
        # Supports both literal newlines and escaped \\n forms.
        return self.private_key.replace("\\n", "\n")

    def _can_use_app_auth(self) -> bool:
        return bool(self.client_id and self.private_key and self.installation_id)

    def _generate_jwt(self) -> str:
        if not self.client_id:
            raise ValueError("Missing GITHUB_CLIENT_ID.")
        now = int(datetime.now(UTC).timestamp())
        payload = {
            "iat": now,
            "exp": now + (10 * 60),
            "iss": self.client_id,
        }
        return jwt.encode(payload, self._normalize_private_key(), algorithm="RS256")

    def _get_installation_token(self) -> str:
        cls = type(self)
        with cls._shared_token_lock:
            if (
                cls._shared_installation_token
                and cls._shared_token_expires_at
                and cls._shared_token_expires_at > datetime.now(UTC) + timedelta(minutes=1)
            ):
                return cls._shared_installation_token

            if not self.installation_id:
                raise ValueError("Missing GITHUB_INSTALLATION_ID.")

            jwt_token = self._generate_jwt()
            response = requests.post(
                f"https://api.github.com/app/installations/{self.installation_id}/access_tokens",
                headers={
                    "Authorization": f"Bearer {jwt_token}",
                    "Accept": "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                },
                timeout=30,
            )
            if not response.ok:
                raise ValueError(
                    f"GitHub app token request failed ({response.status_code}): {response.text}"
                )

            payload = response.json()
            token = payload.get("token")
            if not isinstance(token, str) or not token:
                raise ValueError("GitHub app token response missing token.")

            expires_at_raw = payload.get("expires_at")
            if isinstance(expires_at_raw, str):
                try:
                    expires_at = datetime.fromisoformat(expires_at_raw.replace("Z", "+00:00"))
                except ValueError:
                    expires_at = datetime.now(UTC) + timedelta(minutes=50)
            else:
                expires_at = datetime.now(UTC) + timedelta(minutes=50)

            cls._shared_installation_token = token
            cls._shared_token_expires_at = expires_at
            return token

    def _get_headers(self) -> dict[str, str]:
        if self.github_token:
            return {
                "Authorization": f"token {self.github_token}",
                "Accept": "application/vnd.github+json",
            }

        if self._can_use_app_auth():
            token = self._get_installation_token()
            return {
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            }

        return {"Accept": "application/vnd.github+json"}

    def get_repo_metadata(self, username: str, repo: str) -> tuple[str, bool, int | None]:
        data = _fetch_json(
            f"{_github_api_base()}/repos/{username}/{repo}",
            self._get_headers(),
            "Repository not found.",
        )
        stargazer_count = data.get("stargazers_count")
        if not isinstance(stargazer_count, int):
            stargazer_count = None
        return data.get("default_branch") or "main", bool(data.get("private")), stargazer_count

    def resolve_commit_sha(
        self, username: str, repo: str, ref: str, *, is_explicit_ref: bool
    ) -> str | None:
        try:
            data = _fetch_json(
                f"{_github_api_base()}/repos/{username}/{repo}/commits/{urllib.parse.quote(ref, safe='')}",
                self._get_headers(),
                f'Branch, tag, or commit "{ref}" was not found in the repository.',
            )
        except ValueError:
            if is_explicit_ref:
                raise
            # The default branch should always resolve; if it does not (e.g. an
            # empty repository), the tree fetch below produces the real error.
            return None
        sha = data.get("sha")
        return sha if isinstance(sha, str) and sha else None

    def get_github_file_paths_as_list(
        self, username: str, repo: str, branch: str, subdir: str | None = None
    ) -> str:
        data = _fetch_json(
            f"{_github_api_base()}/repos/{username}/{repo}/git/trees/{urllib.parse.quote(branch, safe='')}?recursive=1",
            self._get_headers(),
            "Could not fetch repository file tree.",
        )
        if data.get("truncated") is True:
            raise ValueError(REPOSITORY_TOO_LARGE_ERROR)

        paths = [
            item.get("path")
            for item in (data.get("tree") or [])
            if isinstance(item.get("path"), str) and _should_include_file(item["path"])
        ]
        if subdir:
            prefix = f"{subdir}/"
            paths = [path for path in paths if path == subdir or path.startswith(prefix)]
            if not paths:
                raise ValueError(
                    f'Subdirectory "{subdir}" was not found in the repository.'
                )
        if not paths:
            raise ValueError(
                "Could not fetch repository file tree. Repository might be empty or inaccessible."
            )
        file_tree = "\n".join(paths)
        if len(file_tree) > MAX_INCLUDED_FILE_TREE_CHARACTERS:
            raise ValueError(REPOSITORY_TOO_LARGE_ERROR)

        return file_tree

    def get_github_readme(
        self, username: str, repo: str, ref: str | None = None, subdir: str | None = None
    ) -> str:
        ref_query = f"?ref={urllib.parse.quote(ref, safe='')}" if ref else ""
        if subdir:
            subdir_path = "/".join(
                urllib.parse.quote(part, safe="") for part in subdir.split("/")
            )
            try:
                return self._read_readme_payload(
                    _fetch_json(
                        f"{_github_api_base()}/repos/{username}/{repo}/readme/{subdir_path}{ref_query}",
                        self._get_headers(),
                        "No README found for the specified repository.",
                    )
                )
            except ValueError:
                pass  # Fall back to the repository root README below.

        data = _fetch_json(
            f"{_github_api_base()}/repos/{username}/{repo}/readme{ref_query}",
            self._get_headers(),
            "No README found for the specified repository.",
        )
        return self._read_readme_payload(data)

    @staticmethod
    def _read_readme_payload(data: dict) -> str:
        size = data.get("size")
        if isinstance(size, int) and size > MAX_README_BYTES:
            raise ValueError(REPOSITORY_TOO_LARGE_ERROR)

        content = data.get("content")
        if not isinstance(content, str) or not content:
            raise ValueError("No README found for the specified repository.")
        if len(content) > MAX_README_BYTES * 2:
            raise ValueError(REPOSITORY_TOO_LARGE_ERROR)

        encoding = data.get("encoding")
        if encoding == "base64":
            readme = base64.b64decode(content).decode("utf-8")
        else:
            readme = content

        if len(readme.encode("utf-8")) > MAX_README_BYTES:
            raise ValueError(REPOSITORY_TOO_LARGE_ERROR)

        return readme

    def get_github_data(
        self,
        username: str,
        repo: str,
        ref: str | None = None,
        subdir: str | None = None,
    ) -> GithubData:
        requested_ref = (ref or "").strip() or None
        normalized_subdir = normalize_subdir(subdir)
        default_branch, is_private, stargazer_count = self.get_repo_metadata(username, repo)
        resolved_ref = requested_ref or default_branch
        commit_sha = self.resolve_commit_sha(
            username, repo, resolved_ref, is_explicit_ref=requested_ref is not None
        )
        file_tree = self.get_github_file_paths_as_list(
            username, repo, commit_sha or resolved_ref, normalized_subdir
        )
        readme = self.get_github_readme(username, repo, requested_ref, normalized_subdir)
        return GithubData(
            default_branch=default_branch,
            resolved_ref=resolved_ref,
            commit_sha=commit_sha,
            subdir=normalized_subdir,
            file_tree=file_tree,
            readme=readme,
            is_private=is_private,
            stargazer_count=stargazer_count,
        )

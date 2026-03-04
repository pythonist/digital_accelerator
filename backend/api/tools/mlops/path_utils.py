"""
Shared path resolution helpers for MLOps route blueprints/services.

These helpers make environment resolution robust regardless of the process
working directory (e.g., `AI_AML_tool/`, `AI_AML_tool/backend/`, or workspace).
"""

from __future__ import annotations

from pathlib import Path
from typing import Iterable, List


def _backend_root() -> Path:
    # .../AI_AML_tool/backend
    return Path(__file__).resolve().parents[3]


def _project_root() -> Path:
    # .../AI_AML_tool
    return Path(__file__).resolve().parents[4]


def _workspace_root() -> Path:
    # .../<workspace>
    return _project_root().parent


def _dedupe_paths(paths: Iterable[Path]) -> List[Path]:
    out: List[Path] = []
    seen = set()
    for p in paths:
        key = str(p).replace("\\", "/").lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(p)
    return out


def resolve_env_root(env_id: str, tenant_id: str, *, create_if_missing: bool = True) -> Path:
    env_id_s = str(env_id or "").strip()
    tenant_id_s = str(tenant_id or "").strip() or "default"

    backend_root = _backend_root()
    project_root = _project_root()
    workspace_root = _workspace_root()

    candidates = _dedupe_paths(
        [
            Path(f"data/environments/{env_id_s}"),
            Path(f"data/{tenant_id_s}/{env_id_s}"),
            Path(f"backend/data/environments/{env_id_s}"),
            Path(f"backend/data/{tenant_id_s}/{env_id_s}"),
            backend_root / "data" / "environments" / env_id_s,
            backend_root / "data" / tenant_id_s / env_id_s,
            project_root / "data" / "environments" / env_id_s,
            project_root / "data" / tenant_id_s / env_id_s,
            workspace_root / "data" / "environments" / env_id_s,
            workspace_root / "data" / tenant_id_s / env_id_s,
        ]
    )

    for candidate in candidates:
        if candidate.exists():
            return candidate

    fallback = backend_root / "data" / "environments" / env_id_s
    if create_if_missing:
        fallback.mkdir(parents=True, exist_ok=True)
    return fallback


def resolve_mlops_dir(env_root: str | Path, *, create_if_missing: bool = True) -> Path:
    path = Path(env_root) / "mlops"
    if create_if_missing:
        path.mkdir(parents=True, exist_ok=True)
    return path


def resolve_mlops_data_dir(env_root: str | Path, *, create_if_missing: bool = True) -> Path:
    path = resolve_mlops_dir(env_root, create_if_missing=create_if_missing) / "data"
    if create_if_missing:
        path.mkdir(parents=True, exist_ok=True)
    return path

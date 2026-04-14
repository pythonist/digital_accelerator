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
            project_root / "env" / tenant_id_s / env_id_s,
            workspace_root / "env" / tenant_id_s / env_id_s,
            project_root / "data" / "environments" / env_id_s,
            project_root / "data" / tenant_id_s / env_id_s,
            backend_root / "data" / "environments" / env_id_s,
            backend_root / "data" / tenant_id_s / env_id_s,
            workspace_root / "data" / "environments" / env_id_s,
            workspace_root / "data" / tenant_id_s / env_id_s,
            backend_root / "env" / tenant_id_s / env_id_s,
        ]
    )

    for candidate in candidates:
        if candidate.exists() and candidate.is_dir():
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


def _extract_env_id_from_path(path: Path) -> str:
    parts = list(path.parts)
    lowered = [str(part).strip().lower() for part in parts]
    if "environments" in lowered:
        idx = lowered.index("environments")
        if idx + 1 < len(parts):
            return str(parts[idx + 1])
    return ""


def resolve_data_file_path(file_path: str | Path, *, env_root: str | Path | None = None) -> Path:
    """
    Resolve a dataset/artifact path across legacy and current FCC layouts.

    This makes older registry rows like:
      data/environments/<env>/data/preprocessed_dataset.csv
    automatically resolve to the current location:
      backend/data/environments/<env>/mlops/data/preprocessed_dataset.csv
    """
    p = Path(file_path)
    if p.is_absolute() and p.exists():
        return p

    backend_root = _backend_root()
    project_root = _project_root()
    workspace_root = _workspace_root()
    env_root_path = Path(env_root) if env_root else None

    candidates: List[Path] = []
    if p.is_absolute():
        candidates.append(p)
    else:
        candidates.extend(
            [
                p,
                Path.cwd() / p,
                backend_root / p,
                project_root / p,
                workspace_root / p,
            ]
        )

    env_id = _extract_env_id_from_path(p)
    lowered = [str(part).strip().lower() for part in p.parts]
    last_data_idx = max((idx for idx, part in enumerate(lowered) if part == "data"), default=-1)
    tail_after_data = Path(*p.parts[last_data_idx + 1 :]) if last_data_idx >= 0 and last_data_idx + 1 < len(p.parts) else None

    if env_root_path is not None:
        candidates.extend(
            [
                env_root_path / p,
                env_root_path / "data" / p.name,
                resolve_mlops_data_dir(env_root_path, create_if_missing=False) / p.name,
            ]
        )
        if tail_after_data is not None:
            candidates.extend(
                [
                    env_root_path / "data" / tail_after_data,
                    resolve_mlops_data_dir(env_root_path, create_if_missing=False) / tail_after_data,
                ]
            )

    if env_id and tail_after_data is not None:
        inferred_env_root = resolve_env_root(env_id, "default", create_if_missing=False)
        candidates.extend(
            [
                inferred_env_root / "data" / tail_after_data,
                resolve_mlops_data_dir(inferred_env_root, create_if_missing=False) / tail_after_data,
                backend_root / "data" / "environments" / env_id / "data" / tail_after_data,
                backend_root / "data" / "environments" / env_id / "mlops" / "data" / tail_after_data,
                project_root / "backend" / "data" / "environments" / env_id / "mlops" / "data" / tail_after_data,
            ]
        )

    for candidate in _dedupe_paths(candidates):
        if candidate.exists():
            return candidate

    return p

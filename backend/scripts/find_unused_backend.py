import ast
import json
import os
import sys
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
ENTRY_FILES = [
    BACKEND_ROOT / "app.py",
]

SKIP_DIRS = {
    ".venv",
    "__pycache__",
    "data",
    "dist",
    "env",
    "audit",
    ".git",
}


def iter_py_files(root: Path):
    for p in root.rglob("*.py"):
        rel = p.relative_to(root)
        if any(part in SKIP_DIRS for part in rel.parts):
            continue
        yield p


def module_to_path_candidates(module: str):
    parts = module.split(".")
    file_candidate = BACKEND_ROOT.joinpath(*parts).with_suffix(".py")
    pkg_candidate = BACKEND_ROOT.joinpath(*parts, "__init__.py")
    return [file_candidate, pkg_candidate]


def resolve_relative(module: str | None, level: int, current_file: Path):
    rel = current_file.relative_to(BACKEND_ROOT)
    cur_parts = list(rel.parts[:-1])
    if level > 0:
        cur_parts = cur_parts[: max(0, len(cur_parts) - (level - 1))]
    if module:
        cur_parts.extend(module.split("."))
    return ".".join([p for p in cur_parts if p not in ("__init__.py", "")]).replace(".py", "")


def extract_imports(py_path: Path):
    try:
        code = py_path.read_text(encoding="utf-8")
    except Exception:
        return set()
    try:
        tree = ast.parse(code, filename=str(py_path))
    except Exception:
        return set()

    mods = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for n in node.names:
                if n.name:
                    mods.add(n.name)
        elif isinstance(node, ast.ImportFrom):
            mod = node.module
            if node.level and node.level > 0:
                mod = resolve_relative(mod, node.level, py_path)
            if mod:
                mods.add(mod)
    return mods


all_files = sorted({p.resolve() for p in iter_py_files(BACKEND_ROOT)})
all_set = {str(p) for p in all_files}

visited = set()
queue = [p.resolve() for p in ENTRY_FILES if p.exists()]

def enqueue_module(mod: str):
    for cand in module_to_path_candidates(mod):
        cand = cand.resolve()
        if str(cand) in all_set and cand not in visited:
            queue.append(cand)


while queue:
    f = queue.pop()
    if f in visited:
        continue
    if str(f) not in all_set:
        continue
    visited.add(f)
    for mod in extract_imports(f):
        if mod.startswith(("api", "services", "connectors", "calibration", "case_facts", "case_pack", "baseline")):
            enqueue_module(mod)
        if mod.startswith("backend."):
            enqueue_module(mod.replace("backend.", "", 1))

unused = sorted([str(Path(p).relative_to(BACKEND_ROOT)) for p in all_files if p not in visited])

out = {
    "backend_root": str(BACKEND_ROOT),
    "entry_files": [str(p.relative_to(BACKEND_ROOT)) for p in ENTRY_FILES if p.exists()],
    "total_py_files": len(all_files),
    "reachable_from_entries": len(visited),
    "unused_candidates": len(unused),
    "unused": unused,
    "note": "Best-effort static import scan. Dynamic imports, Flask discovery, or sys.path tweaks may cause false positives.",
}

json.dump(out, sys.stdout, indent=2)


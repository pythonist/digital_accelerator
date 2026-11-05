import os
import pickle
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from core.optional_imports import safe_import
from services.case_profile_builder import CaseProfileBuilder

np, _NUMPY_OK = safe_import("numpy")
faiss, _FAISS_OK = safe_import("faiss")

_PROGRESS_LOCK = threading.Lock()
_INDEX_PROGRESS: Dict[str, Any] = {
    "status": "idle",
    "total": 0,
    "current": 0,
    "current_case_id": "",
    "percentage": 0,
    "message": "Index ready",
    "error": None,
    "started_at": None,
    "completed_at": None,
}


DEFAULT_HYBRID_WEIGHTS = {
    "behavioral": 0.45,
    "typology": 0.25,
    "network": 0.20,
    "alert": 0.10,
}


class CaseVectorIndexService:
    def __init__(self, db_manager):
        self.db_manager = db_manager
        self.profile_builder = CaseProfileBuilder(db_manager)
        self.base_path = self._resolve_store_path()
        self.metadata_path = os.path.join(self.base_path, "case_retrieval_meta.pkl")
        self.index_paths = {
            "behavioral": os.path.join(self.base_path, "case_retrieval_behavioral.faiss"),
            "typology": os.path.join(self.base_path, "case_retrieval_typology.faiss"),
            "network": os.path.join(self.base_path, "case_retrieval_network.faiss"),
            "alert": os.path.join(self.base_path, "case_retrieval_alert.faiss"),
            "hybrid": os.path.join(self.base_path, "case_retrieval_hybrid.faiss"),
        }
        self._metadata = None
        self._indexes = {}

    @classmethod
    def get_progress(cls) -> Dict[str, Any]:
        with _PROGRESS_LOCK:
            return dict(_INDEX_PROGRESS)

    @classmethod
    def update_progress(cls, **kwargs: Any) -> None:
        with _PROGRESS_LOCK:
            _INDEX_PROGRESS.update(kwargs)

    def count_cases_to_index(self) -> int:
        try:
            case_rows = self.profile_builder.list_case_rows()
            return len([row for row in case_rows if row.get("case_id")])
        except Exception:
            return 0

    def _resolve_store_path(self) -> str:
        db_path = getattr(self.db_manager, "db_path", None) or "data/aml_database.db"
        env_root = Path(db_path).parent
        target = env_root / "case_retrieval"
        target.mkdir(parents=True, exist_ok=True)
        return str(target)

    def _l2_normalize(self, matrix):
        if not _NUMPY_OK:
            return matrix
        norms = np.linalg.norm(matrix, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        return matrix / norms

    def _standardize(self, matrix):
        if not _NUMPY_OK or matrix.size == 0:
            return matrix, [], []
        means = matrix.mean(axis=0)
        stds = matrix.std(axis=0)
        stds[stds == 0] = 1.0
        return (matrix - means) / stds, means.tolist(), stds.tolist()

    def _weighted_hybrid_matrix(self, components: Dict[str, "np.ndarray"], weights: Dict[str, float]):
        chunks = []
        for key in ("behavioral", "typology", "network", "alert"):
            matrix = components.get(key)
            if matrix is None:
                continue
            scale = float(weights.get(key, 0.0)) ** 0.5
            chunks.append(matrix * scale)
        if not chunks:
            return None
        return np.concatenate(chunks, axis=1)

    def _build_indexes(self, metadata: Dict) -> None:
        self._indexes = {}
        if not _NUMPY_OK:
            return
        for name, matrix in (metadata.get("normalized_components") or {}).items():
            if name == "hybrid":
                continue
            arr = np.array(matrix, dtype=np.float32)
            if not len(arr):
                continue
            if _FAISS_OK:
                index = faiss.IndexFlatIP(arr.shape[1])
                index.add(arr)
                self._indexes[name] = index
            else:
                self._indexes[name] = arr

        hybrid = np.array(metadata.get("normalized_components", {}).get("hybrid") or [], dtype=np.float32)
        if hybrid.size:
            if _FAISS_OK:
                index = faiss.IndexFlatIP(hybrid.shape[1])
                index.add(hybrid)
                self._indexes["hybrid"] = index
            else:
                self._indexes["hybrid"] = hybrid

    def build_index(self, force_rebuild: bool = False, progress_callback: Optional[Callable[[int, int, str], None]] = None) -> Dict:
        if not _NUMPY_OK:
            raise RuntimeError("NumPy is required for case retrieval indexing.")
        if self._metadata is not None and not force_rebuild:
            return self._metadata

        case_rows = self.profile_builder.list_case_rows()
        valid_rows = [row for row in case_rows if row.get("case_id")]
        total = len(valid_rows)

        self.update_progress(
            status="building",
            total=total,
            current=0,
            current_case_id="",
            percentage=0,
            message=f"Starting index build for {total} cases...",
            started_at=datetime.now(timezone.utc).isoformat(),
            completed_at=None,
            error=None,
        )

        if not valid_rows:
            metadata = {
                "case_ids": [],
                "profiles": {},
                "component_dimensions": {},
                "normalized_components": {},
                "last_rebuilt_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
                "backend": "faiss" if _FAISS_OK else "numpy_fallback",
                "hybrid_weights": DEFAULT_HYBRID_WEIGHTS,
            }
            self._metadata = metadata
            self._build_indexes(metadata)
            self.update_progress(
                status="completed",
                total=0,
                current=0,
                percentage=100,
                message="No cases found in current scope to index.",
                completed_at=datetime.now(timezone.utc).isoformat(),
            )
            return metadata

        profiles = []
        for idx, row in enumerate(valid_rows):
            cid = str(row.get("case_id"))
            current_num = idx + 1
            pct = int((current_num / max(1, total)) * 85)
            self.update_progress(
                current=current_num,
                current_case_id=cid,
                percentage=pct,
                message=f"Indexing case {current_num} of {total} ({cid})...",
            )
            if progress_callback:
                progress_callback(current_num, total, cid)
            profiles.append(self.profile_builder.build_case_profile(cid, row))

        self.update_progress(
            percentage=90,
            message="Calculating multi-vector matrices & FAISS index...",
        )

        component_names = ("behavioral", "typology", "network", "alert")
        component_matrices = {}
        component_stats = {}

        for name in component_names:
            matrix = np.array([profile["vectors"][name] for profile in profiles], dtype=np.float32)
            standardized, means, stds = self._standardize(matrix)
            component_matrices[name] = self._l2_normalize(standardized.astype(np.float32))
            component_stats[name] = {"means": means, "stds": stds, "dimension": int(matrix.shape[1])}

        hybrid_matrix = self._l2_normalize(self._weighted_hybrid_matrix(component_matrices, DEFAULT_HYBRID_WEIGHTS).astype(np.float32))

        now_iso = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
        metadata = {
            "case_ids": [profile["case_id"] for profile in profiles],
            "profiles": {profile["case_id"]: profile for profile in profiles},
            "component_dimensions": {name: int(component_matrices[name].shape[1]) for name in component_names},
            "component_stats": component_stats,
            "normalized_components": {
                **{name: component_matrices[name] for name in component_names},
                "hybrid": hybrid_matrix,
            },
            "last_rebuilt_at": now_iso,
            "backend": "faiss" if _FAISS_OK else "numpy_fallback",
            "hybrid_weights": DEFAULT_HYBRID_WEIGHTS,
        }

        serializable = {
            **metadata,
            "normalized_components": {name: value.tolist() for name, value in metadata["normalized_components"].items()},
        }
        with open(self.metadata_path, "wb") as handle:
            pickle.dump(serializable, handle)

        if _FAISS_OK:
            for name, matrix in metadata["normalized_components"].items():
                if matrix is None or not len(matrix):
                    continue
                index = faiss.IndexFlatIP(matrix.shape[1])
                index.add(matrix.astype(np.float32))
                faiss.write_index(index, self.index_paths[name])

        self._metadata = serializable
        self._build_indexes(serializable)

        self.update_progress(
            status="completed",
            total=total,
            current=total,
            percentage=100,
            message=f"Vector index successfully built for {total} cases.",
            completed_at=now_iso,
            last_rebuilt_at=now_iso,
            case_count=total,
            error=None,
        )
        return serializable

    def start_async_build(self, force_rebuild: bool = True) -> threading.Thread:
        def _run():
            try:
                self.build_index(force_rebuild=force_rebuild)
            except Exception as exc:
                self.update_progress(
                    status="error",
                    error=str(exc),
                    message=f"Index rebuild failed: {exc}",
                )

        thread = threading.Thread(target=_run, daemon=True)
        thread.start()
        return thread

    def _load_from_disk(self) -> Optional[Dict]:
        if not os.path.exists(self.metadata_path):
            return None
        with open(self.metadata_path, "rb") as handle:
            metadata = pickle.load(handle)
        self._metadata = metadata
        self._build_indexes(metadata)
        return metadata

    def ensure_index(self) -> Dict:
        if self._metadata is not None:
            return self._metadata
        metadata = self._load_from_disk()
        if metadata is not None:
            return metadata
        return self.build_index(force_rebuild=True)

    def get_profile(self, case_id: str) -> Optional[Dict]:
        metadata = self.ensure_index()
        return (metadata.get("profiles") or {}).get(str(case_id))

    def get_case_ids(self) -> List[str]:
        return list((self.ensure_index().get("case_ids") or []))

    def get_component_vector(self, case_id: str, component: str):
        metadata = self.ensure_index()
        case_ids = metadata.get("case_ids") or []
        if str(case_id) not in case_ids:
            return None
        idx = case_ids.index(str(case_id))
        matrix = metadata.get("normalized_components", {}).get(component)
        if matrix is None:
            return None
        arr = np.array(matrix, dtype=np.float32)
        return arr[idx:idx + 1]

    def get_component_similarity(self, case_id_a: str, case_id_b: str, component: str) -> float:
        left = self.get_component_vector(case_id_a, component)
        right = self.get_component_vector(case_id_b, component)
        if left is None or right is None or not _NUMPY_OK:
            return 0.0
        return float(np.dot(left[0], right[0]))

    def search_component(self, case_id: str, component: str, top_k: int = 10) -> List[Dict]:
        metadata = self.ensure_index()
        case_ids = metadata.get("case_ids") or []
        if str(case_id) not in case_ids:
            raise ValueError(f"Case {case_id} is not present in the retrieval index.")

        query = self.get_component_vector(case_id, component)
        if query is None:
          return []
        index_or_matrix = self._indexes.get(component)
        if index_or_matrix is None:
            return []

        limit = min(len(case_ids), max(int(top_k), 1) + 1)
        if _FAISS_OK and hasattr(index_or_matrix, "search"):
            scores, positions = index_or_matrix.search(query.astype(np.float32), limit)
            raw_scores = zip(scores[0].tolist(), positions[0].tolist())
        else:
            matrix = np.array(index_or_matrix, dtype=np.float32)
            sims = np.dot(matrix, query[0])
            ranked = np.argsort(-sims)[:limit]
            raw_scores = [(float(sims[pos]), int(pos)) for pos in ranked]

        results = []
        for score, pos in raw_scores:
            if pos < 0 or pos >= len(case_ids):
                continue
            candidate_id = case_ids[pos]
            if candidate_id == str(case_id):
                continue
            results.append({"case_id": candidate_id, "score": max(0.0, min(1.0, float(score)))})
        return results

    def index_status(self, build_if_missing: bool = False) -> Dict:
        try:
            metadata = self.ensure_index() if build_if_missing else (self._metadata or self._load_from_disk())
        except Exception:
            metadata = None
        if metadata is None:
            return {
                "case_count": 0,
                "component_dimensions": {},
                "hybrid_dimension": 0,
                "last_rebuilt_at": None,
                "backend": "faiss" if _FAISS_OK else "numpy_fallback",
                "hybrid_weights": DEFAULT_HYBRID_WEIGHTS,
                "index_ready": False,
            }
        component_dimensions = metadata.get("component_dimensions") or {}
        hybrid_component = (metadata.get("normalized_components") or {}).get("hybrid") or []
        hybrid_dimension = 0
        if hybrid_component is not None:
            try:
                first = hybrid_component[0] if len(hybrid_component) else None
                if first is not None and hasattr(first, '__len__'):
                    hybrid_dimension = len(first)
                elif first is not None and hasattr(first, 'shape'):
                    hybrid_dimension = int(first.shape[0]) if first.shape else 0
            except (TypeError, IndexError, AttributeError):
                hybrid_dimension = 0
        return {
            "case_count": len(metadata.get("case_ids") or []),
            "component_dimensions": component_dimensions,
            "hybrid_dimension": hybrid_dimension,
            "last_rebuilt_at": metadata.get("last_rebuilt_at"),
            "backend": metadata.get("backend") or ("faiss" if _FAISS_OK else "numpy_fallback"),
            "hybrid_weights": metadata.get("hybrid_weights") or DEFAULT_HYBRID_WEIGHTS,
            "index_ready": True,
        }

from __future__ import annotations

import json
from contextlib import nullcontext
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import joblib
import pandas as pd
from sklearn.ensemble import ExtraTreesClassifier, GradientBoostingClassifier, HistGradientBoostingClassifier, IsolationForest, RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, f1_score, precision_score, recall_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.svm import OneClassSVM

from api.tools.mlops.duckdb_manager import get_connection
from api.tools.mlops.mule_graph_service import MuleGraphService
from api.tools.mlops.mule_workspace_service import MuleWorkspaceService
from api.tools.mlops.path_utils import resolve_data_file_path, resolve_mlops_data_dir

try:
    from lightgbm import LGBMClassifier
except Exception:  # pragma: no cover - optional dependency
    LGBMClassifier = None

try:
    from xgboost import XGBClassifier
except Exception:  # pragma: no cover - optional dependency
    XGBClassifier = None


TYPOLOGY_CLASSES = [
    "pass_through_mule",
    "layering_mule",
    "cash_out_mule",
    "recruiter_mule",
]

MODEL_BUILD_SUBSTAGES = {
    "configure",
    "check",
    "train",
    "evaluate",
    "compare",
    "scoring_ledger",
    "run_report",
}


def _txt(value: Any) -> str:
    return str(value or "").strip()


def _low(value: Any) -> str:
    return _txt(value).lower()


def _loads(value: Any, fallback: Any):
    if not value:
        return fallback
    try:
        return json.loads(value)
    except Exception:
        return fallback


def _load_frame(path: Path) -> pd.DataFrame:
    suffix = path.suffix.lower()
    if suffix in {".parquet", ".pq"}:
        return pd.read_parquet(path)
    return pd.read_csv(path)


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _first(columns: Iterable[str], candidates: Iterable[str]) -> Optional[str]:
    lookup = {str(col).strip().lower(): str(col) for col in columns}
    for candidate in candidates:
        hit = lookup.get(str(candidate).strip().lower())
        if hit:
            return hit
    return None


class MuleModelBuildService:
    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()
        self.workspace = MuleWorkspaceService(self.db_path)

    def _conn_ctx(self, conn=None):
        return nullcontext(conn) if conn is not None else get_connection(self.db_path)

    def _ensure_schema(self) -> None:
        with get_connection(self.db_path) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS mule_model_build_config (
                  pipeline_id INTEGER PRIMARY KEY,
                  training_config_json TEXT,
                  approved_features_json TEXT,
                  blocked_features_json TEXT,
                  status TEXT DEFAULT 'draft',
                  metrics_json TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS mule_model_build_runs (
                  run_id BIGINT PRIMARY KEY,
                  pipeline_id INTEGER,
                  model_path TEXT,
                  output_path TEXT,
                  output_table_name TEXT,
                  approved_features_json TEXT,
                  metrics_json TEXT,
                  feature_importance_json TEXT,
                  risk_bands_json TEXT,
                  typology_enabled BOOLEAN DEFAULT FALSE,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )

    def _env_root(self) -> Path:
        return self.db_path.resolve().parents[2]

    def _artifacts_dir(self) -> Path:
        path = resolve_mlops_data_dir(self._env_root(), create_if_missing=True) / "mule_model_build"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _ensure_pipeline_exists(self, pipeline_id: int, expected_type: str = "mule") -> Dict[str, Any]:
        with get_connection(self.db_path) as conn:
            row = conn.execute(
                """
                SELECT pipeline_id, name, pipeline_type, model_family
                FROM mlops_pipelines
                WHERE pipeline_id = ?
                """,
                [int(pipeline_id)],
            ).fetchone()
        if not row:
            raise ValueError(
                f'Pipeline {int(pipeline_id)} is not available in backend persistence. '
                'Reopen a saved Mule run from Pipeline Hub or create a new run.'
            )
        pipeline_type = _low(row[2] or row[3] or "fcc") or "fcc"
        if expected_type and pipeline_type != _low(expected_type):
            raise ValueError(
                f'Pipeline {int(pipeline_id)} is saved as "{pipeline_type}", not "{_low(expected_type)}". '
                'Open the correct run from Pipeline Hub before continuing.'
            )
        return {
            "pipeline_id": int(row[0]),
            "name": _txt(row[1]) or f"Mule Pipeline {int(pipeline_id)}",
            "pipeline_type": pipeline_type,
        }

    def _workspace_stage_id(self, value: Any, fallback: str = "configure") -> str:
        raw = _low(value or fallback)
        legacy_map = {
            "supervised": "configure",
            "typology": "check",
            "anomaly": "evaluate",
            "graph": "compare",
        }
        normalized = legacy_map.get(raw, raw)
        return normalized if normalized in MODEL_BUILD_SUBSTAGES else fallback

    def _workspace_mark(
        self,
        tenant_id: str,
        pipeline_id: int,
        stage_status: str,
        substage: str,
        *,
        summary: Optional[Dict[str, Any]] = None,
        error: Optional[Dict[str, Any]] = None,
        current_stage: Optional[str] = None,
        current_substage: Optional[str] = None,
        conn=None,
    ) -> None:
        self.workspace.ensure_run(
            int(pipeline_id),
            user_id=_txt(tenant_id) or "system",
            status="in_progress",
            current_stage=_txt(current_stage) or "model_build",
            current_substage=_txt(current_substage or substage),
            conn=conn,
        )
        self.workspace.set_stage_state(
            int(pipeline_id),
            "model_build",
            stage_status,
            substage=_txt(substage),
            summary=summary or {},
            error=error or {},
            conn=conn,
        )
        if current_stage or current_substage:
            self.workspace.update_run(
                int(pipeline_id),
                status="failed" if stage_status == "failed" else "in_progress",
                current_stage=_txt(current_stage) or "model_build",
                current_substage=_txt(current_substage or substage),
                conn=conn,
            )

    def _default_config(self, pipeline_id: int) -> Dict[str, Any]:
        return {
            "pipeline_id": int(pipeline_id),
            "objective": "Detect Mule Accounts",
            "secondary_objective": "Predict Mule Typology",
            "supervised_algorithm": "lightgbm",
            "typology_algorithm": "gradient_boosting",
            "anomaly_enabled": True,
            "anomaly_algorithm": "isolation_forest",
            "graph_enabled": True,
            "graph_algorithms": [
                "connected_components",
                "cycle_detection",
                "shared_device_cluster_detection",
                "fan_in_fan_out_analysis",
            ],
            "class_imbalance": "balanced_class_weight",
            "scale_pos_weight": 1.0,
            "split_strategy": "time_based",
            "time_aware_split": True,
            "random_state": 42,
            "decision_threshold": 0.5,
            "workspace_stage": "configure",
            "hyperparameters": {
                "learning_rate": 0.05,
                "n_estimators": 160,
                "max_depth": 3,
            },
            "cross_validation_enabled": False,
            "risk_thresholds": {"high": 0.75, "medium": 0.45},
        }

    def _algorithm_estimator(self, algorithm: str):
        algo = _low(algorithm) or "lightgbm"
        params = {
            "n_estimators": 160,
            "max_depth": 4,
            "learning_rate": 0.05,
            "random_state": 42,
        }
        if algo == "random_forest":
            return RandomForestClassifier(
                n_estimators=180,
                random_state=42,
                class_weight="balanced",
            ), "random_forest", None
        if algo == "logistic_regression":
            return LogisticRegression(max_iter=700, class_weight="balanced"), "logistic_regression", None
        if algo == "extra_trees":
            return ExtraTreesClassifier(
                n_estimators=220,
                random_state=42,
                class_weight="balanced",
                n_jobs=-1,
            ), "extra_trees", None
        if algo in {"hist_gradient_boosting", "histgradientboosting"}:
            return HistGradientBoostingClassifier(
                max_depth=6,
                learning_rate=0.05,
                random_state=42,
            ), "hist_gradient_boosting", None
        if algo in {"xgboost", "xgb"} and XGBClassifier is not None:
            return XGBClassifier(
                n_estimators=params["n_estimators"],
                max_depth=params["max_depth"],
                learning_rate=params["learning_rate"],
                eval_metric="logloss",
                random_state=params["random_state"],
            ), "xgboost", None
        if algo in {"lightgbm", "lgbm"} and LGBMClassifier is not None:
            return LGBMClassifier(
                n_estimators=params["n_estimators"],
                max_depth=params["max_depth"],
                learning_rate=params["learning_rate"],
                random_state=params["random_state"],
                class_weight="balanced",
                verbose=-1,
            ), "lightgbm", None
        fallback_reason = None
        if algo in {"xgboost", "xgb"} and XGBClassifier is None:
            fallback_reason = "XGBoost is not installed, so HistGradientBoosting was used instead."
        elif algo in {"lightgbm", "lgbm"} and LGBMClassifier is None:
            fallback_reason = "LightGBM is not installed, so HistGradientBoosting was used instead."
        return HistGradientBoostingClassifier(
            max_depth=6,
            learning_rate=0.05,
            random_state=42,
        ), "hist_gradient_boosting", fallback_reason

    def _load_dataset_by_type(self, tenant_id: str, env_id: str, dataset_types: Iterable[str], pipeline_id: Optional[int] = None) -> Optional[pd.DataFrame]:
        type_list = [str(item).strip().lower() for item in dataset_types if str(item).strip()]
        with get_connection(self.db_path) as conn:
            if pipeline_id is not None:
                rows = conn.execute(
                    """
                    SELECT dataset_type, file_path
                    FROM mlops_dataset_registry
                    WHERE tenant_id = ? AND env_id = ? AND pipeline_type = 'mule' AND pipeline_id = ?
                    ORDER BY updated_at DESC, dataset_id DESC
                    """,
                    [tenant_id, env_id, int(pipeline_id)],
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT dataset_type, file_path
                    FROM mlops_dataset_registry
                    WHERE tenant_id = ? AND env_id = ? AND pipeline_type = 'mule'
                    ORDER BY updated_at DESC, dataset_id DESC
                    """,
                    [tenant_id, env_id],
                ).fetchall()
        for dataset_type, file_path in rows:
            if _low(dataset_type) not in type_list:
                continue
            path = resolve_data_file_path(Path(file_path), env_root=self._env_root())
            if not path.exists():
                continue
            try:
                frame = _load_frame(path)
            except Exception:
                continue
            if not frame.empty:
                return frame
        return None

    def _load_latest_preprocessed(self, tenant_id: str, env_id: str, pipeline_id: Optional[int] = None) -> pd.DataFrame:
        frame = self._load_dataset_by_type(tenant_id, env_id, ["preprocess_dataset", "preprocessed_dataset", "feature_store", "master_dataset"], pipeline_id)
        if frame is None:
            raise ValueError("Prepare the Mule feature dataset before model build.")
        return frame

    def load_config(self, pipeline_id: int) -> Dict[str, Any]:
        self._ensure_pipeline_exists(int(pipeline_id), expected_type="mule")
        with get_connection(self.db_path) as conn:
            row = conn.execute(
                """
                SELECT training_config_json, approved_features_json, blocked_features_json, status, metrics_json
                FROM mule_model_build_config
                WHERE pipeline_id = ?
                """,
                [int(pipeline_id)],
            ).fetchone()
        default = self._default_config(pipeline_id)
        if not row:
            return {
                "pipeline_id": int(pipeline_id),
                "config": default,
                "approved_features": [],
                "blocked_features": [],
                "status": "draft",
                "metrics": {},
            }
        return {
            "pipeline_id": int(pipeline_id),
            "config": {**default, **_loads(row[0], {})},
            "approved_features": _loads(row[1], []),
            "blocked_features": _loads(row[2], []),
            "status": _txt(row[3]) or "draft",
            "metrics": _loads(row[4], {}),
        }

    def save_config(
        self,
        tenant_id: str,
        pipeline_id: int,
        patch: Optional[Dict[str, Any]],
        approved_features: Iterable[str],
        blocked_features: Iterable[Dict[str, Any]],
    ) -> Dict[str, Any]:
        self._ensure_pipeline_exists(int(pipeline_id), expected_type="mule")
        current = self.load_config(pipeline_id)
        config = {**current["config"], **(patch or {})}
        config["workspace_stage"] = self._workspace_stage_id(config.get("workspace_stage"), fallback="configure")
        approved_list = list(approved_features)
        blocked_list = list(blocked_features)
        with get_connection(self.db_path) as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO mule_model_build_config (
                  pipeline_id, training_config_json, approved_features_json, blocked_features_json, status, metrics_json, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                [
                    int(pipeline_id),
                    json.dumps(config, default=str),
                    json.dumps(approved_list, default=str),
                    json.dumps(blocked_list, default=str),
                    current["status"],
                    json.dumps(current["metrics"], default=str),
                ],
            )
            stage_ready = _low(current.get("status") or "") in {"trained", "completed"}
            self._workspace_mark(
                tenant_id,
                int(pipeline_id),
                "completed" if stage_ready else "in_progress",
                "run_report" if stage_ready else config["workspace_stage"],
                summary={
                    "status": _txt(current.get("status") or "draft"),
                    "workspace_stage": config["workspace_stage"],
                    "approved_features_count": len(approved_list),
                    "blocked_features_count": len(blocked_list),
                    "graph_enabled": bool(config.get("graph_enabled", True)),
                    "typology_enabled": bool(_txt(config.get("typology_algorithm"))),
                },
                current_stage="model_output_validation" if stage_ready else "model_build",
                current_substage="validate" if stage_ready else config["workspace_stage"],
                conn=conn,
            )
        return self.load_config(pipeline_id)

    def train_mule_model(self, frame: pd.DataFrame, feature_cols: List[str], config: Dict[str, Any]) -> Dict[str, Any]:
        X = frame[feature_cols].copy()
        y = frame["mule_flag"].fillna(0).astype(int)
        if y.nunique() < 2:
            raise ValueError("mule_flag must contain at least two classes for model build.")

        random_state = _safe_int(config.get("random_state"), 42)
        X_train, X_test, y_train, y_test = train_test_split(
            X,
            y,
            test_size=0.2,
            random_state=random_state,
            stratify=y if y.nunique() > 1 else None,
        )

        estimator, resolved_algorithm, algorithm_warning = self._algorithm_estimator(
            config.get("supervised_algorithm") or config.get("algorithm") or "lightgbm"
        )
        pipeline = Pipeline([
            ("imputer", SimpleImputer(strategy="median")),
            ("model", estimator),
        ])
        pipeline.fit(X_train, y_train)
        probs = pipeline.predict_proba(X_test)[:, 1]
        threshold = _safe_float(config.get("decision_threshold"), 0.5)
        preds = (probs >= threshold).astype(int)
        top_n = max(25, int(len(probs) * 0.1))
        top_idx = pd.Series(probs).sort_values(ascending=False).head(top_n).index
        top_capture = float(y_test.iloc[top_idx].mean() if top_n > 0 else 0.0)
        metrics = {
            "precision": float(precision_score(y_test, preds, zero_division=0)),
            "recall": float(recall_score(y_test, preds, zero_division=0)),
            "f1": float(f1_score(y_test, preds, zero_division=0)),
            "pr_auc": float(average_precision_score(y_test, probs)),
            "top_n_capture": top_capture,
            "lift_top_decile": float(top_capture / max(float(y_test.mean()), 1e-6)),
            "business_view": f"Out of the top {top_n} flagged accounts, approximately {int(round(top_capture * top_n))} are expected to be true mules.",
            "decision_threshold": threshold,
            "algorithm_requested": _low(config.get("supervised_algorithm") or config.get("algorithm") or "lightgbm"),
            "algorithm_resolved": resolved_algorithm,
            "warnings": [algorithm_warning] if algorithm_warning else [],
        }

        model_obj = pipeline.named_steps["model"]
        if hasattr(model_obj, "feature_importances_"):
            importances = model_obj.feature_importances_
        elif hasattr(model_obj, "coef_"):
            importances = abs(model_obj.coef_[0])
        else:
            importances = [0.0] * len(feature_cols)
        feature_importance = [
            {"feature": feature, "importance": float(score)}
            for feature, score in sorted(zip(feature_cols, importances), key=lambda item: item[1], reverse=True)[:15]
        ]

        return {
            "model": pipeline,
            "metrics": metrics,
            "feature_importance": feature_importance,
            "risk_scores": pipeline.predict_proba(X)[:, 1],
        }

    def train_typology_model(self, frame: pd.DataFrame, feature_cols: List[str], config: Dict[str, Any]) -> Dict[str, Any]:
        if "mule_typology" not in frame.columns:
            return {"enabled": False, "reason": "mule_typology not available"}

        typology = frame["mule_typology"].fillna("").astype(str).str.strip()
        train_mask = typology.ne("")
        if train_mask.sum() < 20 or typology[train_mask].nunique() < 2:
            return {"enabled": False, "reason": "Not enough mule_typology coverage"}

        X = frame.loc[train_mask, feature_cols].copy()
        y = typology.loc[train_mask]
        estimator, resolved_algorithm, algorithm_warning = self._algorithm_estimator(
            config.get("typology_algorithm") or "gradient_boosting"
        )
        model = Pipeline([
            ("imputer", SimpleImputer(strategy="median")),
            ("model", estimator),
        ])
        model.fit(X, y)
        predictions = model.predict(frame[feature_cols])
        probabilities = []
        if hasattr(model, "predict_proba"):
            class_names = [str(item) for item in getattr(model.named_steps["model"], "classes_", [])]
            for row in model.predict_proba(frame[feature_cols]):
                probabilities.append({cls: float(score) for cls, score in zip(class_names, row)})
        return {
            "enabled": True,
            "model": model,
            "predictions": predictions,
            "probabilities": probabilities,
            "classes": [cls for cls in TYPOLOGY_CLASSES if cls in set(y.unique())] or sorted({str(item) for item in y.unique()}),
            "algorithm_resolved": resolved_algorithm,
            "warnings": [algorithm_warning] if algorithm_warning else [],
        }

    def run_anomaly_detection(self, frame: pd.DataFrame, feature_cols: List[str], config: Dict[str, Any]) -> Dict[str, Any]:
        if not bool(config.get("anomaly_enabled", True)):
            return {
                "enabled": False,
                "algorithm": None,
                "model": None,
                "scores": [0.0] * len(frame),
                "flags": [0] * len(frame),
                "summary": {"enabled": False},
            }

        algorithm = _low(config.get("anomaly_algorithm") or "isolation_forest")
        X = frame[feature_cols].fillna(0).copy()
        if algorithm == "one_class_svm":
            model = OneClassSVM(kernel="rbf", gamma="scale", nu=0.08)
            model.fit(X)
            raw_scores = -model.decision_function(X)
        elif algorithm == "statistical_outlier":
            centered = X.sub(X.mean()).abs()
            raw_scores = centered.sum(axis=1).to_numpy()
            model = None
        else:
            model = IsolationForest(random_state=_safe_int(config.get("random_state"), 42), contamination=0.08)
            model.fit(X)
            raw_scores = -model.score_samples(X)

        raw_series = pd.Series(raw_scores)
        scaled = (raw_series - raw_series.min()) / max(float(raw_series.max() - raw_series.min()), 1e-6)
        flags = (scaled >= float(scaled.quantile(0.92))).astype(int)
        return {
            "enabled": True,
            "algorithm": algorithm,
            "model": model,
            "scores": [float(value) for value in scaled.tolist()],
            "flags": [int(value) for value in flags.tolist()],
            "summary": {
                "enabled": True,
                "algorithm": algorithm,
                "flagged_accounts": int(flags.sum()),
                "mean_score": float(scaled.mean()),
            },
        }

    def run_graph_analysis(
        self,
        tenant_id: str,
        env_id: str,
        pipeline_id: int,
        frame: pd.DataFrame,
        config: Dict[str, Any],
    ) -> Dict[str, Any]:
        if not bool(config.get("graph_enabled", True)):
            return {
                "enabled": False,
                "summary": {
                    "enabled": False,
                    "reason": "Graph analysis disabled for this run",
                    "algorithms": list(config.get("graph_algorithms") or []),
                },
                "rows": pd.DataFrame(),
                "payload": {"nodes": [], "links": [], "clusters": [], "focus_cluster_id": "", "truncated": False},
            }
        result = MuleGraphService(self.db_path).analyze(
            tenant_id,
            env_id,
            frame,
            pipeline_id=int(pipeline_id),
        )
        summary = result.get("summary") or {}
        result["summary"] = {
            **summary,
            "algorithms": list(config.get("graph_algorithms") or []),
        }
        return result

    def _risk_band(self, score: float, thresholds: Dict[str, Any]) -> str:
        high = _safe_float((thresholds or {}).get("high"), 0.75)
        medium = _safe_float((thresholds or {}).get("medium"), 0.45)
        if score >= high:
            return "High Risk"
        if score >= medium:
            return "Medium Risk"
        return "Low Risk"

    def _build_supporting_signals(self, row: pd.Series, feature_importance: List[Dict[str, Any]]) -> Dict[str, str]:
        signal_labels = []
        for item in feature_importance[:8]:
            feature = _txt(item.get("feature"))
            if not feature or feature not in row.index:
                continue
            value = _safe_float(row.get(feature), 0.0)
            if abs(value) <= 0:
                continue
            if "ratio" in feature:
                label = f"High {feature.replace('_', ' ')}"
            elif "counterpart" in feature:
                label = "Large number of counterparties"
            elif "device" in feature:
                label = "Shared device with flagged accounts"
            elif "graph" in feature or "neighbor" in feature:
                label = "Dense graph or suspicious connections"
            else:
                label = feature.replace("_", " ")
            if label not in signal_labels:
                signal_labels.append(label)
            if len(signal_labels) >= 3:
                break
        explanation = (
            f"Why this account is risky: {', '.join(signal_labels)}."
            if signal_labels else
            "Why this account is risky: elevated approved Mule indicators across the selected feature set."
        )
        return {
            "top_drivers": ", ".join(signal_labels[:2]),
            "supporting_signals": " | ".join(signal_labels),
            "investigator_explanation": explanation,
        }

    def _persist_output_dataset(self, tenant_id: str, env_id: str, pipeline_id: int, output_path: Path, scored_output: pd.DataFrame) -> int:
        with get_connection(self.db_path) as conn:
            dataset_id = int(conn.execute("SELECT COALESCE(MAX(dataset_id), 0) + 1 FROM mlops_dataset_registry").fetchone()[0] or 1)
            conn.execute(
                """
                INSERT INTO mlops_dataset_registry (
                  dataset_id, tenant_id, env_id, pipeline_id, pipeline_type, dataset_type, filename,
                  file_path, row_count, columns_json, column_types_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    dataset_id,
                    tenant_id,
                    env_id,
                    int(pipeline_id),
                    "mule",
                    "model_output",
                    output_path.name,
                    str(output_path),
                    int(scored_output.shape[0]),
                    json.dumps(list(scored_output.columns), default=str),
                    json.dumps({col: str(dtype) for col, dtype in scored_output.dtypes.items()}, default=str),
                ],
            )
        return dataset_id

    def train(
        self,
        tenant_id: str,
        env_id: str,
        pipeline_id: int,
        patch: Optional[Dict[str, Any]],
        governance: Dict[str, Any],
    ) -> Dict[str, Any]:
        pipeline = self._ensure_pipeline_exists(int(pipeline_id), expected_type="mule")
        blocked = list(governance.get("blocked_features") or [])
        if blocked:
            raise ValueError("Blocked leakage-prone features are still in scope. Resolve feature governance before training.")

        approved = [str(feature).strip() for feature in (governance.get("approved_features") or []) if str(feature).strip()]
        if not approved:
            raise ValueError("No approved features are available for model training.")

        state = self.save_config(tenant_id, pipeline_id, patch, approved, blocked)
        config = state["config"]
        job_id = f"mule-model-build-{int(pipeline_id)}"
        self._workspace_mark(
            tenant_id,
            int(pipeline_id),
            "in_progress",
            "train",
            summary={
                "status": "running",
                "workspace_stage": self._workspace_stage_id(config.get("workspace_stage"), fallback="train"),
                "approved_features_count": len(approved),
                "graph_enabled": bool(config.get("graph_enabled", True)),
                "typology_enabled": bool(_txt(config.get("typology_algorithm"))),
            },
            current_stage="model_build",
            current_substage="train",
        )
        self.workspace.upsert_job(
            job_id,
            int(pipeline_id),
            "model_build",
            "model_training",
            "in_progress",
            progress_pct=8.0,
            logs={"event": "training_started", "pipeline_name": _txt(pipeline.get("name"))},
        )
        try:
            frame = self._load_latest_preprocessed(tenant_id, env_id, pipeline_id)
            if "mule_flag" not in frame.columns:
                raise ValueError("mule_flag is required for model build.")

            feature_cols = [col for col in approved if col in frame.columns and col not in {"mule_flag", "mule_typology"}]
            if not feature_cols:
                raise ValueError("Approved features are not present in the preprocessed dataset.")
        except Exception as exc:
            self.workspace.upsert_job(
                job_id,
                int(pipeline_id),
                "model_build",
                "model_training",
                "failed",
                progress_pct=100.0,
                logs={"event": "training_failed", "message": str(exc)},
            )
            self._workspace_mark(
                tenant_id,
                int(pipeline_id),
                "failed",
                "train",
                summary={
                    "status": "failed",
                    "workspace_stage": "train",
                    "approved_features_count": len(approved),
                },
                error={"message": str(exc)},
                current_stage="model_build",
                current_substage="train",
            )
            raise
        try:
            supervised = self.train_mule_model(frame, feature_cols, config)
            self.workspace.upsert_job(
                job_id,
                int(pipeline_id),
                "model_build",
                "model_training",
                "in_progress",
                progress_pct=42.0,
                logs={"event": "binary_model_trained", "algorithm": supervised["metrics"].get("algorithm_resolved")},
            )
            typology = self.train_typology_model(frame, feature_cols, config)
            anomaly = self.run_anomaly_detection(frame, feature_cols, config)
            graph = self.run_graph_analysis(tenant_id, env_id, int(pipeline_id), frame, config)

            scored_output = frame[["account_id"]].copy() if "account_id" in frame.columns else pd.DataFrame({"row_id": range(len(frame))})
            scored_output["mule_risk_score"] = supervised["risk_scores"]
            scored_output["predicted_mule_flag"] = (scored_output["mule_risk_score"] >= _safe_float(config.get("decision_threshold"), 0.5)).astype(int)
            scored_output["risk_band"] = scored_output["mule_risk_score"].apply(lambda score: self._risk_band(float(score), config.get("risk_thresholds") or {}))
            scored_output["model_confidence"] = scored_output["mule_risk_score"].apply(lambda score: float(max(score, 1 - score)))
            typology_predictions = list(typology["predictions"]) if typology.get("enabled") else [""] * len(frame)
            typology_probabilities = list(typology.get("probabilities") or []) if typology.get("enabled") else [{} for _ in range(len(frame))]
            if len(typology_probabilities) < len(frame):
                typology_probabilities.extend([{} for _ in range(len(frame) - len(typology_probabilities))])
            category_classes = list(typology.get("classes") or TYPOLOGY_CLASSES)

            scored_output["predicted_mule_typology"] = typology_predictions
            scored_output["predicted_mule_category"] = typology_predictions
            scored_output["category_probabilities_json"] = [
                json.dumps(item or {}, default=str)
                for item in typology_probabilities
            ]
            scored_output["typology_confidence"] = [
                max((item or {}).values()) if isinstance(item, dict) and item else 0.0
                for item in typology_probabilities
            ] if typology.get("enabled") else 0.0
            for class_name in category_classes:
                safe_name = _low(class_name).replace(" ", "_")
                scored_output[f"category_prob_{safe_name}"] = [
                    float((item or {}).get(class_name, 0.0)) if isinstance(item, dict) else 0.0
                    for item in typology_probabilities
                ]
            scored_output["anomaly_score"] = anomaly["scores"]
            scored_output["anomaly_flag"] = anomaly["flags"]

            graph_rows = graph["rows"] if isinstance(graph.get("rows"), pd.DataFrame) else pd.DataFrame()
            if not graph_rows.empty and "account_id" in scored_output.columns:
                scored_output = scored_output.merge(graph_rows, on="account_id", how="left")
            else:
                scored_output["graph_cluster_id"] = ""
                scored_output["cluster_size"] = 0
                scored_output["suspicious_neighbor_count"] = 0
                scored_output["shared_device_links"] = 0
                scored_output["graph_risk_score"] = 0.0

            explanations = scored_output.join(frame[feature_cols], how="left")
            top_drivers, supporting, investigator_explanations = [], [], []
            for _, row in explanations.iterrows():
                summary = self._build_supporting_signals(row, supervised["feature_importance"])
                top_drivers.append(summary["top_drivers"])
                supporting.append(summary["supporting_signals"])
                investigator_explanations.append(summary["investigator_explanation"])
            scored_output["top_drivers"] = top_drivers
            scored_output["supporting_signals"] = supporting
            scored_output["investigator_explanation"] = investigator_explanations

            artifacts_dir = self._artifacts_dir()
            output_table_name = f"mule_model_output_{int(pipeline_id)}"
            output_path = artifacts_dir / f"{output_table_name}.csv"
            model_path = artifacts_dir / f"mule_model_bundle_{int(pipeline_id)}.joblib"
            scored_output.sort_values(by="mule_risk_score", ascending=False).to_csv(output_path, index=False)
            joblib.dump(
                {
                    "supervised_model": supervised["model"],
                    "typology_model": typology.get("model"),
                    "anomaly_model": anomaly.get("model"),
                    "feature_columns": feature_cols,
                    "config": config,
                    "feature_importance": supervised["feature_importance"],
                    "typology_classes": typology.get("classes", []),
                    "graph_algorithms": list(config.get("graph_algorithms") or []),
                },
                model_path,
            )

            combined_metrics = {
                "supervised": supervised["metrics"],
                "typology": {
                    "enabled": bool(typology.get("enabled")),
                    "classes": typology.get("classes", []),
                    "model": config.get("typology_algorithm") or "gradient_boosting",
                    "algorithm_resolved": typology.get("algorithm_resolved"),
                    "warnings": typology.get("warnings") or [],
                },
                "anomaly": anomaly["summary"],
                "graph": graph["summary"],
                "risk_bands": config.get("risk_thresholds") or {"high": 0.75, "medium": 0.45},
            }

            with get_connection(self.db_path) as conn:
                conn.register("__mule_model_output_df", scored_output)
                conn.execute(f'CREATE OR REPLACE TABLE "{output_table_name}" AS SELECT * FROM __mule_model_output_df')
                try:
                    conn.unregister("__mule_model_output_df")
                except Exception:
                    pass
                run_id = int(conn.execute("SELECT COALESCE(MAX(run_id), 0) + 1 FROM mule_model_build_runs").fetchone()[0] or 1)
                conn.execute(
                    """
                    INSERT INTO mule_model_build_runs (
                      run_id, pipeline_id, model_path, output_path, output_table_name, approved_features_json,
                      metrics_json, feature_importance_json, risk_bands_json, typology_enabled
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        run_id,
                        int(pipeline_id),
                        str(model_path),
                        str(output_path),
                        output_table_name,
                        json.dumps(feature_cols, default=str),
                        json.dumps(combined_metrics, default=str),
                        json.dumps(supervised["feature_importance"], default=str),
                        json.dumps(config.get("risk_thresholds") or {"high": 0.75, "medium": 0.45}, default=str),
                        bool(typology.get("enabled")),
                    ],
                )
                conn.execute(
                    """
                    UPDATE mule_model_build_config
                    SET status = 'trained', metrics_json = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE pipeline_id = ?
                    """,
                    [json.dumps(combined_metrics, default=str), int(pipeline_id)],
                )
                output_dataset_id = self._persist_output_dataset(tenant_id, env_id, int(pipeline_id), output_path, scored_output)
                self.workspace.register_artifact(
                    int(pipeline_id),
                    "model_build",
                    "model_bundle_joblib",
                    str(model_path),
                    metadata={
                        "run_id": int(run_id),
                        "approved_features_count": len(feature_cols),
                        "algorithm": supervised["metrics"].get("algorithm_resolved"),
                    },
                    conn=conn,
                )
                self.workspace.register_artifact(
                    int(pipeline_id),
                    "model_build",
                    "model_output_csv",
                    str(output_path),
                    metadata={
                        "run_id": int(run_id),
                        "dataset_id": int(output_dataset_id),
                        "row_count": int(scored_output.shape[0]),
                        "column_count": int(scored_output.shape[1]),
                        "output_table_name": output_table_name,
                    },
                    conn=conn,
                )
                self.workspace.upsert_job(
                    job_id,
                    int(pipeline_id),
                    "model_build",
                    "model_training",
                    "completed",
                    progress_pct=100.0,
                    logs={
                        "event": "training_completed",
                        "run_id": int(run_id),
                        "dataset_id": int(output_dataset_id),
                        "output_table_name": output_table_name,
                    },
                    conn=conn,
                )
                self._workspace_mark(
                    tenant_id,
                    int(pipeline_id),
                    "completed",
                    "run_report",
                    summary={
                        "status": "trained",
                        "workspace_stage": "run_report",
                        "run_id": int(run_id),
                        "output_dataset_id": int(output_dataset_id),
                        "approved_features_count": len(feature_cols),
                        "graph_enabled": bool(config.get("graph_enabled", True)),
                        "typology_enabled": bool(typology.get("enabled")),
                        "warnings": [
                            *list(supervised["metrics"].get("warnings") or []),
                            *list(typology.get("warnings") or []),
                        ],
                        "latest_run": {
                            "run_id": int(run_id),
                            "output_table_name": output_table_name,
                            "output_path": str(output_path),
                        },
                    },
                    current_stage="model_output_validation",
                    current_substage="validate",
                    conn=conn,
                )

            preview_rows = scored_output.head(15).fillna("").to_dict(orient="records")
            return {
                "pipeline_id": int(pipeline_id),
                "run_id": run_id,
                "config": config,
                "metrics": combined_metrics,
                "feature_importance": supervised["feature_importance"],
                "risk_bands": config.get("risk_thresholds") or {"high": 0.75, "medium": 0.45},
                "typology_enabled": bool(typology.get("enabled")),
                "typology_classes": typology.get("classes", []),
                "model_path": str(model_path),
                "output_dataset_id": output_dataset_id,
                "output_table_name": output_table_name,
                "sample_outputs": preview_rows,
            }
        except Exception as exc:
            self.workspace.upsert_job(
                job_id,
                int(pipeline_id),
                "model_build",
                "model_training",
                "failed",
                progress_pct=100.0,
                logs={"event": "training_failed", "message": str(exc)},
            )
            self._workspace_mark(
                tenant_id,
                int(pipeline_id),
                "failed",
                "train",
                summary={
                    "status": "failed",
                    "workspace_stage": "train",
                    "approved_features_count": len(feature_cols),
                },
                error={"message": str(exc)},
                current_stage="model_build",
                current_substage="train",
            )
            raise

    def status(self, pipeline_id: int, *, tenant_id: str = "system") -> Dict[str, Any]:
        self._ensure_pipeline_exists(int(pipeline_id), expected_type="mule")
        current = self.load_config(pipeline_id)
        with get_connection(self.db_path) as conn:
            row = conn.execute(
                """
                SELECT run_id, model_path, output_path, output_table_name, approved_features_json,
                       metrics_json, feature_importance_json, risk_bands_json, typology_enabled, created_at
                FROM mule_model_build_runs
                WHERE pipeline_id = ?
                ORDER BY created_at DESC, run_id DESC
                LIMIT 1
                """,
                [int(pipeline_id)],
            ).fetchone()
            history_rows = conn.execute(
                """
                SELECT run_id, model_path, output_path, output_table_name, approved_features_json,
                       metrics_json, feature_importance_json, risk_bands_json, typology_enabled, created_at
                FROM mule_model_build_runs
                WHERE pipeline_id = ?
                ORDER BY created_at DESC, run_id DESC
                LIMIT 8
                """,
                [int(pipeline_id)],
            ).fetchall()

        latest_run = None
        sample_outputs: List[Dict[str, Any]] = []
        if row:
            output_path = _txt(row[2])
            latest_run = {
                "run_id": int(row[0]),
                "model_path": _txt(row[1]),
                "output_path": output_path,
                "output_table_name": _txt(row[3]),
                "approved_features": _loads(row[4], []),
                "metrics": _loads(row[5], {}),
                "feature_importance": _loads(row[6], []),
                "risk_bands": _loads(row[7], {"high": 0.75, "medium": 0.45}),
                "typology_enabled": bool(row[8]),
                "created_at": row[9].isoformat() if hasattr(row[9], "isoformat") else row[9],
            }
            with get_connection(self.db_path) as conn:
                dataset_row = conn.execute(
                    """
                    SELECT dataset_id
                    FROM mlops_dataset_registry
                    WHERE pipeline_type = 'mule' AND pipeline_id = ? AND dataset_type IN ('model_output', 'model_dataset', 'scored_dataset')
                    ORDER BY updated_at DESC, dataset_id DESC
                    LIMIT 1
                    """,
                    [int(pipeline_id)],
                ).fetchone()
            if dataset_row:
                latest_run["output_dataset_id"] = int(dataset_row[0])
            path = resolve_data_file_path(Path(output_path), env_root=self._env_root())
            if path.exists():
                try:
                    sample_outputs = _load_frame(path).head(15).fillna("").to_dict(orient="records")
                except Exception:
                    sample_outputs = []

        recent_runs = [
            {
                "run_id": int(hist_row[0]),
                "model_path": _txt(hist_row[1]),
                "output_path": _txt(hist_row[2]),
                "output_table_name": _txt(hist_row[3]),
                "approved_features": _loads(hist_row[4], []),
                "metrics": _loads(hist_row[5], {}),
                "feature_importance": _loads(hist_row[6], []),
                "risk_bands": _loads(hist_row[7], {"high": 0.75, "medium": 0.45}),
                "typology_enabled": bool(hist_row[8]),
                "created_at": hist_row[9].isoformat() if hasattr(hist_row[9], "isoformat") else hist_row[9],
            }
            for hist_row in (history_rows or [])
        ]

        result = {
            "pipeline_id": int(pipeline_id),
            "config": current["config"],
            "approved_features": current["approved_features"],
            "blocked_features": current["blocked_features"],
            "status": current["status"],
            "metrics": current["metrics"],
            "latest_run": latest_run,
            "recent_runs": recent_runs,
            "sample_outputs": sample_outputs,
        }
        workspace_stage = self._workspace_stage_id((result.get("config") or {}).get("workspace_stage"), fallback="configure")
        status_value = _low(result.get("status") or "")
        if latest_run and status_value in {"trained", "completed"}:
            stage_status = "completed"
            substage = "run_report"
        elif status_value in {"failed", "error"}:
            stage_status = "failed"
            substage = "train"
        elif (result.get("approved_features") or []) or (result.get("config") or {}).get("workspace_stage"):
            stage_status = "in_progress"
            substage = workspace_stage
        else:
            stage_status = "not_started"
            substage = "configure"
        self.workspace.ensure_run(int(pipeline_id), user_id=_txt(tenant_id) or "system")
        self.workspace.set_stage_state(
            int(pipeline_id),
            "model_build",
            stage_status,
            substage=substage,
            summary={
                "status": _txt(result.get("status") or "draft"),
                "workspace_stage": workspace_stage,
                "approved_features_count": len(result.get("approved_features") or []),
                "blocked_features_count": len(result.get("blocked_features") or []),
                "graph_enabled": bool((result.get("config") or {}).get("graph_enabled", True)),
                "typology_enabled": bool(_txt((result.get("config") or {}).get("typology_algorithm"))),
                "latest_run": latest_run or {},
            },
            error={},
        )
        return result

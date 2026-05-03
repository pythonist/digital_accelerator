"""
deployment_dashboard_service.py
────────────────────────────────────────────────────────────────────────────────
Post-deployment monitoring service for the AML MLOps Workbench.

Responsibilities
────────────────
  1. score_batch()       – Run a new batch of alerts/cases through the deployed
                           model and persist a suppression ledger to DuckDB.
  2. suppression_ledger() – Query the ledger with filters (date, entity, type).
  3. drift_stats()        – Compute suppression rate drift week-over-week.
  4. model_lineage()      – Return the full model build DAG (data → preprocessing
                           → training config → validation → deployment) so the
                           business user can understand what the model is doing.
  5. event_loss_trend()   – Rolling event-loss % over time (for MRM reporting).
  6. alert_vs_case_split() – Show suppression broken down by entity level
                             (alert level vs case level) — critical gap flagged
                             by the user.

Schema (DuckDB)
───────────────
  mlops_suppression_ledger
    record_id       UUID PK
    deployment_id   TEXT FK
    run_id          TEXT
    batch_id        TEXT
    scored_at       TIMESTAMP
    entity_id       TEXT          -- alert_id or case_id
    entity_type     TEXT          -- 'alert' | 'case'
    model_score     DOUBLE        -- raw P(SAR)
    decision        TEXT          -- 'suppressed' | 'escalated'
    threshold       DOUBLE
    top_features    TEXT          -- JSON list of {feature, shap_value}
    actual_label    INTEGER NULL  -- filled in later if ground-truth arrives
    reason_code     TEXT          -- business-readable decision reason
    reviewer        TEXT NULL

  mlops_drift_log
    drift_id        UUID PK
    deployment_id   TEXT
    computed_at     TIMESTAMP
    window_label    TEXT          -- e.g. 'W2026-07'
    suppression_rate DOUBLE
    event_loss_pct  DOUBLE
    alert_count     INTEGER
    case_count      INTEGER
    psi             DOUBLE NULL

Usage
─────
    from api.tools.mlops.deployment_dashboard_service import DeploymentDashboardService
    svc = DeploymentDashboardService(
        db_path=Path("data/environments/<env>/mlops/duckdb/deployment.duckdb"),
        model_dir=Path("data/environments/<env>/mlops/models"),
    )
"""

from __future__ import annotations

import json
import logging
import pickle
import re
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from api.tools.mlops.path_utils import resolve_mlops_data_dir
from api.tools.mlops.sklearn_pickle_compat import load_pickle_compat

import numpy as np
import pandas as pd
import duckdb

logger = logging.getLogger(__name__)

_REASON_THRESHOLDS = [
    (0.15, "Very low risk, score well below detection threshold"),
    (0.25, "Low risk, no strong SAR indicators present"),
    (0.40, "Below threshold, insufficient signal to escalate"),
    (0.50, "Borderline, suppressed under current threshold setting"),
]

_SYNTHETIC_DEMO_TARGETS = {
    "steady": {"suppression_rate_pct": 42.0, "event_loss_pct": 5.0, "positive_rate_pct": 12.0},
    "noisy": {"suppression_rate_pct": 38.0, "event_loss_pct": 6.0, "positive_rate_pct": 13.0},
    "drifted": {"suppression_rate_pct": 46.0, "event_loss_pct": 7.0, "positive_rate_pct": 11.0},
    "bad_data": {"suppression_rate_pct": 35.0, "event_loss_pct": 8.0, "positive_rate_pct": 10.0},
}


def _reason_code(score: float, threshold: float) -> str:
    """Derive a human-readable suppression reason from score bucket."""
    if score >= threshold:
        return "Escalated, score meets or exceeds alert threshold"
    gap = threshold - score
    if gap > 0.35:
        return "Very low risk, score well below detection threshold"
    if gap > 0.20:
        return "Low risk, no strong SAR indicators present"
    if gap > 0.10:
        return "Below threshold, insufficient signal to escalate"
    return "Borderline, suppressed under current threshold setting"


def _trapezoid_area(y_values: List[float], x_values: List[float]) -> float:
    """NumPy-version-safe trapezoid integration."""
    trapezoid_fn = getattr(np, "trapezoid", None)
    if callable(trapezoid_fn):
        return float(trapezoid_fn(y_values, x_values))
    trapz_fn = getattr(np, "trapz", None)
    if callable(trapz_fn):
        return float(trapz_fn(y_values, x_values))
    return 0.0


class DeploymentDashboardService:
    """Post-deployment scoring, suppression ledger, and monitoring."""

    # ── Construction ──────────────────────────────────────────────────────────

    def __init__(self, db_path: Path, model_dir: Path):
        self.db_path = Path(db_path)
        self.model_dir = Path(model_dir)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _conn(self):
        return duckdb.connect(str(self.db_path))

    def _env_root(self) -> Path:
        return self.db_path.parents[2]

    def _scored_batches_dir(self) -> Path:
        path = resolve_mlops_data_dir(self._env_root()) / "scored_batches"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _ensure_schema(self) -> None:
        with self._conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS mlops_suppression_ledger (
                    record_id       TEXT PRIMARY KEY,
                    deployment_id   TEXT,
                    run_id          TEXT,
                    batch_id        TEXT,
                    scored_at       TIMESTAMP,
                    entity_id       TEXT,
                    entity_type     TEXT,
                    model_score     DOUBLE,
                    decision        TEXT,
                    threshold       DOUBLE,
                    top_features    TEXT,
                    actual_label    INTEGER,
                    reason_code     TEXT,
                    reviewer        TEXT,
                    source          TEXT DEFAULT 'production'
                )
            """)
            conn.execute(
                "ALTER TABLE mlops_suppression_ledger ADD COLUMN IF NOT EXISTS source TEXT"
            )
            conn.execute("""
                CREATE TABLE IF NOT EXISTS mlops_drift_log (
                    drift_id          TEXT PRIMARY KEY,
                    deployment_id     TEXT,
                    computed_at       TIMESTAMP,
                    window_label      TEXT,
                    suppression_rate  DOUBLE,
                    event_loss_pct    DOUBLE,
                    alert_count       INTEGER,
                    case_count        INTEGER,
                    psi               DOUBLE
                )
            """)

    # ── Internal helpers ───────────────────────────────────────────────────────

    def _json_safe(self, value: Any) -> Any:
        if value is None:
            return None
        try:
            if pd.isna(value):
                return None
        except Exception:
            pass
        if isinstance(value, (pd.Timestamp, datetime)):
            return value.isoformat()
        if hasattr(value, "item"):
            try:
                return value.item()
            except Exception:
                pass
        return value

    @staticmethod
    def _detect_label_leakage_features(feature_columns: List[str]) -> List[str]:
        suspicious: List[str] = []
        exact_matches = {
            "label",
            "labels",
            "actual_label",
            "final_label",
            "is_true_pos",
            "target",
            "target_label",
            "str_label",
            "ground_truth",
        }
        token_pattern = re.compile(r"(?:^|_)(label|target|truth)(?:$|_)")

        for feat in feature_columns or []:
            feat_s = str(feat or "").strip()
            feat_l = feat_s.lower()
            if not feat_s:
                continue
            if feat_l in exact_matches or token_pattern.search(feat_l):
                suspicious.append(feat_s)
        return sorted(set(suspicious))

    @staticmethod
    def _first_existing_column(df: pd.DataFrame, candidates: List[str]) -> Optional[str]:
        """Return the first matching column name from a candidate list."""
        if df is None or df.empty:
            return None
        by_lower = {str(col).strip().lower(): str(col) for col in df.columns}
        for candidate in candidates or []:
            candidate_text = str(candidate or "").strip()
            if not candidate_text:
                continue
            if candidate_text in df.columns:
                return candidate_text
            matched = by_lower.get(candidate_text.lower())
            if matched:
                return matched
        return None

    def _coerce_binary_label_series(self, series: pd.Series) -> List[Optional[int]]:
        """Coerce mixed label representations into binary values with null preservation."""
        positive_values = {"1", "true", "yes", "sar_filed", "sar filed", "closed_sar_filed", "true_positive"}
        negative_values = {"0", "false", "no", "closed_false_positive", "false_positive", "closed_monitoring", "monitoring"}
        labels: List[Optional[int]] = []
        for value in series.tolist():
            if value is None:
                labels.append(None)
                continue
            try:
                if pd.isna(value):
                    labels.append(None)
                    continue
            except Exception:
                pass
            try:
                numeric_value = int(float(value))
            except Exception:
                text = str(value).strip().lower()
                if text in positive_values:
                    labels.append(1)
                elif text in negative_values:
                    labels.append(0)
                else:
                    labels.append(None)
                continue
            labels.append(numeric_value if numeric_value in (0, 1) else None)
        return labels

    def _resolve_live_labels(
        self,
        *,
        batch_df: pd.DataFrame,
        bundle: Dict[str, Any],
        model_grain: str,
    ) -> Tuple[List[Optional[int]], str, Optional[str]]:
        """
        Resolve evaluation labels for live simulation.

        Preference order:
          1. The model's trained target column when present in the batch.
          2. Known AML label aliases (FINAL_LABEL / str_label / CASE_LABEL / IS_TRUE_POS).
          3. CASE_STATUS-derived labels for case-outcome monitoring.
        """
        target_column = str(bundle.get("target_column") or "").strip()
        candidate_columns: List[str] = []
        if target_column:
            candidate_columns.append(target_column)
        if model_grain == "case":
            candidate_columns.extend(["CASE_LABEL", "CASE_STATUS", "FINAL_LABEL", "str_label", "IS_TRUE_POS"])
        else:
            candidate_columns.extend(["FINAL_LABEL", "str_label", "CASE_LABEL", "IS_TRUE_POS", "CASE_STATUS"])

        label_column = self._first_existing_column(batch_df, candidate_columns)
        if not label_column:
            return [], "estimated_labels", None

        if str(label_column).strip().lower() == "case_status":
            labels = self._derive_is_true_pos_from_case_status(batch_df[label_column]).tolist()
            return labels, "case_outcome_labels", label_column

        labels = self._coerce_binary_label_series(batch_df[label_column])
        label_basis = "target_column_labels" if target_column and str(label_column).strip().lower() == target_column.lower() else "derived_label_column"
        return labels, label_basis, label_column

    @staticmethod
    def _sample_without_replacement(
        rng: np.random.Generator,
        indices: List[int],
        count: int,
    ) -> List[int]:
        if count <= 0 or not indices:
            return []
        take = min(int(count), len(indices))
        if take <= 0:
            return []
        return rng.choice(np.asarray(indices, dtype=int), size=take, replace=False).tolist()

    def _build_label_summary(
        self,
        *,
        labels: List[Optional[int]],
        label_basis: str,
        label_column: Optional[str],
        strategy: str,
    ) -> Dict[str, Any]:
        labelled = [int(label) for label in labels if label in (0, 1)]
        positives = int(sum(1 for label in labelled if label == 1))
        negatives = int(sum(1 for label in labelled if label == 0))
        labelled_rows = int(len(labelled))
        total_rows = int(len(labels))
        return {
            "label_source": label_column or label_basis,
            "strategy": strategy,
            "n_total": total_rows,
            "labelled_rows": labelled_rows,
            "excluded_rows": int(max(total_rows - labelled_rows, 0)),
            "n_positive": positives,
            "n_negative": negatives,
            "str_rate_overall": round(positives / max(total_rows, 1), 4),
            "str_rate_labelled": round(positives / max(labelled_rows, 1), 4) if labelled_rows else 0.0,
        }

    def _build_seeded_demo_batch(
        self,
        *,
        bundle: Dict[str, Any],
        model_grain: str,
        threshold: float,
        scenario: str,
        batch_size: int,
        seed: int,
    ) -> Optional[Dict[str, Any]]:
        """
        Build a realistic demo batch from the environment master dataset when available.

        Synthetic live simulation is client-demo oriented, so we seed the batch from
        scored historical rows and sample a plausible TP/FP/TN/FN mix instead of
        letting random batch composition swing the suppression metrics wildly.
        """
        data_dir = resolve_mlops_data_dir(self._env_root(), create_if_missing=False)
        candidate_path = data_dir / "master_dataset.csv"
        if not candidate_path.exists():
            return None
        try:
            candidate_df = pd.read_csv(candidate_path)
        except Exception:
            return None
        if candidate_df.empty:
            return None

        bundle_features: List[str] = bundle.get("feature_columns", []) or []
        if not bundle_features:
            return None

        if model_grain == "case":
            case_col = self._first_existing_column(candidate_df, ["CASE_ID", "case_id"])
            if not case_col:
                return None
            case_values = candidate_df[case_col].astype(str).str.strip()
            candidate_df = candidate_df[case_values.ne("") & case_values.str.lower().ne("nan")].copy()
            if candidate_df.empty:
                return None
            candidate_df["entity_type"] = "case"
            candidate_df["entity_id"] = candidate_df[case_col].astype(str).str.strip()
            candidate_df = candidate_df.drop_duplicates(subset=["entity_id"]).reset_index(drop=True)
        else:
            alert_col = self._first_existing_column(candidate_df, ["ALERT_ID", "alert_id"])
            if not alert_col:
                return None
            alert_values = candidate_df[alert_col].astype(str).str.strip()
            candidate_df = candidate_df[alert_values.ne("") & alert_values.str.lower().ne("nan")].copy()
            if candidate_df.empty:
                return None
            candidate_df["entity_type"] = "alert"
            candidate_df["entity_id"] = candidate_df[alert_col].astype(str).str.strip()
            candidate_df = candidate_df.drop_duplicates(subset=["entity_id"]).reset_index(drop=True)

        labels, label_basis, label_column = self._resolve_live_labels(
            batch_df=candidate_df,
            bundle=bundle,
            model_grain=model_grain,
        )
        labelled_rows = int(sum(1 for label in labels if label in (0, 1)))
        positive_rows = int(sum(1 for label in labels if label == 1))
        negative_rows = int(sum(1 for label in labels if label == 0))
        if labelled_rows < max(40, int(batch_size * 0.3)) or positive_rows < 8 or negative_rows < 20:
            return None

        X_pool, _ = self._build_feature_matrix(candidate_df, bundle_features)
        scores_pool = self._predict_scores(bundle, X_pool)
        decisions_pool = [
            "escalated" if float(score) >= float(threshold) else "suppressed"
            for score in scores_pool
        ]

        pools: Dict[str, List[int]] = {
            "tp": [],
            "tn": [],
            "fp": [],
            "fn": [],
            "escalated_unknown": [],
            "suppressed_unknown": [],
        }
        for idx, (label, decision) in enumerate(zip(labels, decisions_pool)):
            decision_text = str(decision).lower()
            if label == 1:
                pools["tp" if decision_text == "escalated" else "fn"].append(idx)
            elif label == 0:
                pools["fp" if decision_text == "escalated" else "tn"].append(idx)
            else:
                pools["escalated_unknown" if decision_text == "escalated" else "suppressed_unknown"].append(idx)

        targets = _SYNTHETIC_DEMO_TARGETS.get(str(scenario or "steady").lower(), _SYNTHETIC_DEMO_TARGETS["steady"])
        target_suppressed = int(round(batch_size * float(targets["suppression_rate_pct"]) / 100.0))
        target_positive = int(round(batch_size * float(targets["positive_rate_pct"]) / 100.0))
        target_positive = max(12, min(target_positive, positive_rows))
        target_fn = min(int(round(target_positive * float(targets["event_loss_pct"]) / 100.0)), max(len(pools["fn"]), 0))
        target_tp = min(max(target_positive - target_fn, 0), len(pools["tp"]))
        realized_positive = target_tp + target_fn
        if realized_positive <= 0:
            return None
        target_fn = min(target_fn, max(realized_positive - target_tp, 0))
        target_tn = min(max(target_suppressed - target_fn, 0), len(pools["tn"]))
        target_fp = min(max(batch_size - target_tn - realized_positive, 0), len(pools["fp"]))

        rng = np.random.default_rng(seed)
        selected_indices = (
            self._sample_without_replacement(rng, pools["tp"], target_tp)
            + self._sample_without_replacement(rng, pools["fn"], target_fn)
            + self._sample_without_replacement(rng, pools["tn"], target_tn)
            + self._sample_without_replacement(rng, pools["fp"], target_fp)
        )

        current_suppressed = target_tn + target_fn
        while len(selected_indices) < batch_size:
            remaining = batch_size - len(selected_indices)
            prefer_suppressed = current_suppressed < target_suppressed
            fill_pools = (
                ["suppressed_unknown", "tn", "escalated_unknown", "fp", "tp", "fn"]
                if prefer_suppressed
                else ["escalated_unknown", "fp", "suppressed_unknown", "tn", "tp", "fn"]
            )
            added_any = False
            selected_set = set(selected_indices)
            for pool_name in fill_pools:
                available = [idx for idx in pools[pool_name] if idx not in selected_set]
                if not available:
                    continue
                take = self._sample_without_replacement(rng, available, remaining)
                if not take:
                    continue
                selected_indices.extend(take)
                selected_set.update(take)
                if pool_name in {"tn", "fn", "suppressed_unknown"}:
                    current_suppressed += len(take)
                remaining -= len(take)
                added_any = True
                if remaining <= 0:
                    break
            if not added_any:
                break

        if len(selected_indices) < max(32, int(batch_size * 0.5)):
            return None

        rng.shuffle(selected_indices)
        sampled_df = candidate_df.iloc[selected_indices].copy().reset_index(drop=True)

        protected_cols: Dict[str, pd.Series] = {}
        for protected in ("IS_TRUE_POS", "CASE_STATUS", "CASE_LABEL", "FINAL_LABEL", "str_label", "alert_id", "case_id", "entity_id", "entity_type", "ALERT_ID", "CASE_ID"):
            if protected in sampled_df.columns:
                protected_cols[protected] = sampled_df[protected].copy()
        sampled_df, _ = self._apply_simulation_scenario(sampled_df, str(scenario or "steady"), seed=seed + 17)
        for protected, values in protected_cols.items():
            sampled_df[protected] = values
        sampled_df = sampled_df.reset_index(drop=True)

        sampled_labels, sampled_basis, sampled_label_column = self._resolve_live_labels(
            batch_df=sampled_df,
            bundle=bundle,
            model_grain=model_grain,
        )
        sampled_summary = self._build_label_summary(
            labels=sampled_labels,
            label_basis=sampled_basis,
            label_column=sampled_label_column,
            strategy="seeded_master_demo_batch",
        )
        sampled_summary["sampling_targets"] = dict(targets)
        return {
            "batch_df": sampled_df,
            "label_summary": sampled_summary,
            "source_name": "seeded_master_demo_batch",
        }

    def _preview_rows(
        self,
        df: pd.DataFrame,
        preferred_columns: List[str],
        *,
        limit: int = 25,
    ) -> Dict[str, Any]:
        if df is None or df.empty:
            return {"row_count": 0, "columns": [], "rows": []}

        selected: List[str] = []
        seen = set()
        for col in preferred_columns or []:
            col_s = str(col)
            if col_s in df.columns and col_s not in seen:
                selected.append(col_s)
                seen.add(col_s)

        if not selected:
            selected = [str(c) for c in list(df.columns)[:10]]
        elif len(selected) < 10:
            for col in df.columns:
                col_s = str(col)
                if col_s in seen:
                    continue
                selected.append(col_s)
                seen.add(col_s)
                if len(selected) >= 10:
                    break

        records: List[Dict[str, Any]] = []
        for raw in df.loc[:, selected].head(int(max(limit, 1))).to_dict(orient="records"):
            records.append({str(k): self._json_safe(v) for k, v in raw.items()})
        return {
            "row_count": int(len(df)),
            "columns": selected,
            "rows": records,
        }

    def _build_scored_batch_records(
        self,
        *,
        records: List[Dict[str, Any]],
        persisted_rows: List[Dict[str, Any]],
        run_id: str,
        deployment_id: str,
        feature_coverage: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        scored_records: List[Dict[str, Any]] = []
        for idx, raw_record in enumerate(records):
            payload = {str(k): self._json_safe(v) for k, v in dict(raw_record).items()}
            persisted = persisted_rows[idx] if idx < len(persisted_rows) else {}
            payload.update(
                {
                    "record_id": persisted.get("record_id"),
                    "entity_id": persisted.get("entity_id"),
                    "entity_type": persisted.get("entity_type"),
                    "model_score": persisted.get("model_score"),
                    "decision": persisted.get("decision"),
                    "threshold": persisted.get("threshold"),
                    "reason_code": persisted.get("reason_code"),
                    "top_features": persisted.get("top_features") or [],
                    "actual_label": persisted.get("actual_label"),
                    "scored_at": persisted.get("scored_at"),
                    "source": persisted.get("source") or "production",
                    "run_id": str(run_id),
                    "deployment_id": str(deployment_id),
                    "feature_coverage": feature_coverage or {},
                }
            )
            scored_records.append(payload)
        return scored_records

    def _persist_scored_batch_package(
        self,
        *,
        batch_id: str,
        run_id: str,
        deployment_id: str,
        model_grain: str,
        threshold: float,
        persisted: Dict[str, Any],
        scored_records: List[Dict[str, Any]],
        feature_coverage: Optional[Dict[str, Any]] = None,
        pipeline_id: Optional[str] = None,
        pipeline_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        batch_dir = self._scored_batches_dir() / str(batch_id)
        batch_dir.mkdir(parents=True, exist_ok=True)
        manifest = {
            "batch_id": str(batch_id),
            "run_id": str(run_id),
            "deployment_id": str(deployment_id),
            "model_grain": str(model_grain),
            "threshold": float(threshold),
            "pipeline_id": str(pipeline_id) if pipeline_id not in (None, "") else None,
            "pipeline_name": str(pipeline_name) if pipeline_name not in (None, "") else None,
            "scored_at": persisted.get("scored_at"),
            "created_at": datetime.utcnow().isoformat() + "Z",
            "total": int(persisted.get("total") or 0),
            "suppressed": int(persisted.get("suppressed") or 0),
            "escalated": int(persisted.get("escalated") or 0),
            "suppression_rate": persisted.get("suppression_rate"),
            "feature_coverage": feature_coverage or {},
            "package_version": 1,
        }
        (batch_dir / "manifest.json").write_text(
            json.dumps(manifest, indent=2, default=self._json_safe),
            encoding="utf-8",
        )
        (batch_dir / "scored_records.json").write_text(
            json.dumps(scored_records, indent=2, default=self._json_safe),
            encoding="utf-8",
        )
        return manifest

    def _load_bundle(self, run_id: str) -> Dict:
        """Load the pickled model bundle from model_dir."""
        candidates = list(self.model_dir.glob(f"*{run_id}*.pkl"))
        if not candidates:
            raise FileNotFoundError(
                f"No model artifact for run_id={run_id} in {self.model_dir}"
            )
        return load_pickle_compat(candidates[0])

    @staticmethod
    def _normalize_grain(value: Any) -> str:
        """Normalize model grain to 'alert' or 'case'."""
        text = str(value or "").strip().lower()
        return "case" if text == "case" else "alert"

    def _resolve_model_grain(
        self,
        *,
        run_id: Optional[str] = None,
        run_meta: Optional[Dict[str, Any]] = None,
        default: str = "alert",
    ) -> str:
        """
        Resolve scoring grain for a run.
        Priority:
          1) explicit run_meta grain keys
          2) bundle grain (if run_id provided)
          3) default
        """
        meta = run_meta or {}
        for key in ("grain", "model_grain", "entity_grain", "entity_type"):
            if key in meta and str(meta.get(key) or "").strip():
                return self._normalize_grain(meta.get(key))

        if run_id:
            try:
                bundle = self._load_bundle(str(run_id))
                for key in ("grain", "model_grain", "entity_grain", "entity_type"):
                    if key in bundle and str(bundle.get(key) or "").strip():
                        return self._normalize_grain(bundle.get(key))
            except Exception:
                pass

        return self._normalize_grain(default)

    def _infer_entity_ids(
        self,
        df: pd.DataFrame,
        default_entity_type: str = "alert",
    ) -> Tuple[List[str], List[str]]:
        """Infer entity_type and entity_id per row from common AML source keys."""
        default_type = "case" if str(default_entity_type).lower() == "case" else "alert"
        entity_types: List[str] = []
        entity_ids: List[str] = []

        for i, row in df.reset_index(drop=True).iterrows():
            etype = str(row.get("entity_type") or default_type).strip().lower()
            if etype not in {"alert", "case"}:
                etype = default_type

            if etype == "case":
                eid = (
                    row.get("entity_id")
                    or row.get("case_id")
                    or row.get("caseid")
                    or row.get("CASE_ID")
                )
                if eid is None or str(eid).strip() == "":
                    eid = row.get("alert_id") or row.get("transaction_id")
                if eid is None or str(eid).strip() == "":
                    eid = f"CSE-{i + 1:06d}"
            else:
                eid = (
                    row.get("entity_id")
                    or row.get("alert_id")
                    or row.get("transaction_id")
                    or row.get("txn_id")
                    or row.get("ALERT_ID")
                )
                if eid is None or str(eid).strip() == "":
                    eid = row.get("case_id")
                if eid is None or str(eid).strip() == "":
                    eid = f"ALT-{i + 1:06d}"

            entity_types.append(etype)
            entity_ids.append(str(eid))

        return entity_types, entity_ids

    def _build_feature_matrix(
        self,
        df_raw: pd.DataFrame,
        feature_columns: List[str],
    ) -> Tuple[pd.DataFrame, Dict[str, Any]]:
        """
        Build model feature matrix from raw source records.

        Supports:
        - direct numeric column matches
        - datetime derived features (<col>_year/_month/_day/_dow/_hour)
        - frequency features (<col>_freq)
        - one-hot-like columns inferred from <raw_col>_<category>
        """
        if df_raw.empty:
            return pd.DataFrame(columns=feature_columns), {
                "matched_direct": 0,
                "matched_datetime": 0,
                "matched_frequency": 0,
                "matched_onehot": 0,
                "zero_filled": len(feature_columns),
                "matched_feature_ratio": 0.0,
            }

        raw_cols = [str(c) for c in df_raw.columns]
        by_lower = {str(c).lower(): str(c) for c in df_raw.columns}
        sorted_candidates = sorted(raw_cols, key=len, reverse=True)

        dt_cache: Dict[str, pd.Series] = {}
        freq_cache: Dict[str, pd.Series] = {}
        cat_cache: Dict[str, pd.Series] = {}

        out = pd.DataFrame(index=df_raw.index)
        stats = {
            "matched_direct": 0,
            "matched_datetime": 0,
            "matched_frequency": 0,
            "matched_onehot": 0,
            "zero_filled": 0,
        }

        def _find_source_col(base: str) -> Optional[str]:
            if base in df_raw.columns:
                return base
            return by_lower.get(str(base).lower())

        for feat in feature_columns:
            col = str(feat)
            found = False

            src_direct = _find_source_col(col)
            if src_direct is not None:
                out[col] = pd.to_numeric(df_raw[src_direct], errors="coerce").fillna(0.0).astype(float)
                stats["matched_direct"] += 1
                continue

            for suffix, extractor in (
                ("_year", lambda s: s.dt.year),
                ("_month", lambda s: s.dt.month),
                ("_day", lambda s: s.dt.day),
                ("_dow", lambda s: s.dt.dayofweek),
                ("_hour", lambda s: s.dt.hour),
            ):
                if col.endswith(suffix):
                    base = col[: -len(suffix)]
                    src_dt = _find_source_col(base)
                    if src_dt is not None:
                        if src_dt not in dt_cache:
                            dt_cache[src_dt] = pd.to_datetime(df_raw[src_dt], errors="coerce")
                        vals = extractor(dt_cache[src_dt])
                        out[col] = pd.to_numeric(vals, errors="coerce").fillna(0.0).astype(float)
                        stats["matched_datetime"] += 1
                        found = True
                    break
            if found:
                continue

            if col.endswith("_freq"):
                base = col[:-5]
                src_freq = _find_source_col(base)
                if src_freq is not None:
                    if src_freq not in freq_cache:
                        s = (
                            df_raw[src_freq]
                            .astype(str)
                            .str.strip()
                            .replace({"": "UNKNOWN", "nan": "UNKNOWN", "None": "UNKNOWN"})
                            .fillna("UNKNOWN")
                        )
                        mapping = s.value_counts(normalize=True).to_dict()
                        freq_cache[src_freq] = s.map(mapping).fillna(0.0).astype(float)
                    out[col] = freq_cache[src_freq]
                    stats["matched_frequency"] += 1
                    continue

            for base in sorted_candidates:
                if col.startswith(f"{base}_"):
                    cat_value = col[len(base) + 1 :]
                    cat_value_norm = str(cat_value).strip()
                    if base not in cat_cache:
                        cat_cache[base] = (
                            df_raw[base]
                            .astype(str)
                            .str.strip()
                            .replace({"": "UNKNOWN", "nan": "UNKNOWN", "None": "UNKNOWN"})
                            .fillna("UNKNOWN")
                        )
                    out[col] = (cat_cache[base] == cat_value_norm).astype(float)
                    stats["matched_onehot"] += 1
                    found = True
                    break
                base_l = base.lower()
                if col.lower().startswith(f"{base_l}_"):
                    cat_value = col[len(base) + 1 :]
                    cat_value_norm = str(cat_value).strip().lower()
                    if base not in cat_cache:
                        cat_cache[base] = (
                            df_raw[base]
                            .astype(str)
                            .str.strip()
                            .replace({"": "UNKNOWN", "nan": "UNKNOWN", "None": "UNKNOWN"})
                            .fillna("UNKNOWN")
                        )
                    out[col] = (cat_cache[base].str.lower() == cat_value_norm).astype(float)
                    stats["matched_onehot"] += 1
                    found = True
                    break

            if not found:
                out[col] = 0.0
                stats["zero_filled"] += 1

        out = out.replace([np.inf, -np.inf], np.nan).fillna(0.0).astype(float)
        matched_total = (
            stats["matched_direct"]
            + stats["matched_datetime"]
            + stats["matched_frequency"]
            + stats["matched_onehot"]
        )
        stats["matched_feature_ratio"] = round(float(matched_total / max(len(feature_columns), 1)), 4)
        stats["feature_count"] = int(len(feature_columns))
        return out, stats

    @staticmethod
    def _normalize_scores(values: np.ndarray, floor: Optional[float] = None, ceiling: Optional[float] = None) -> np.ndarray:
        arr = np.asarray(values, dtype=float).reshape(-1)
        if arr.size == 0:
            return arr
        lo = float(np.min(arr) if floor is None else floor)
        hi = float(np.max(arr) if ceiling is None else ceiling)
        if not np.isfinite(lo):
            lo = float(np.min(arr))
        if not np.isfinite(hi):
            hi = float(np.max(arr))
        if hi <= lo:
            return np.zeros(arr.shape[0], dtype=float)
        out = (arr - lo) / (hi - lo)
        return np.clip(out.astype(float), 0.0, 1.0)

    def _prepare_model_input(
        self,
        bundle: Dict[str, Any],
        X: pd.DataFrame,
    ) -> Tuple[pd.DataFrame, np.ndarray]:
        feature_columns = [str(col) for col in (bundle.get("feature_columns") or list(X.columns))]
        X_df = X.loc[:, feature_columns].copy() if feature_columns else X.copy()
        scaler = bundle.get("scaler")
        if scaler is None:
            return X_df, X_df.values.astype(float)
        scaled = scaler.transform(X_df.values.astype(float))
        scaled_df = pd.DataFrame(scaled, columns=feature_columns or list(X_df.columns), index=X_df.index)
        return scaled_df, np.asarray(scaled, dtype=float)

    def _predict_scores(
        self,
        bundle: Dict[str, Any],
        X: pd.DataFrame,
    ) -> np.ndarray:
        model = bundle["model"]
        algorithm = str(bundle.get("algorithm") or "").strip().lower()
        X_model_df, X_model_arr = self._prepare_model_input(bundle, X)

        if hasattr(model, "predict_proba"):
            prob = np.asarray(model.predict_proba(X_model_df), dtype=float)
            if prob.ndim == 1:
                return self._normalize_scores(prob)
            if prob.shape[1] >= 2:
                return np.clip(prob[:, 1].astype(float), 0.0, 1.0)
            return self._normalize_scores(prob[:, 0])

        if hasattr(model, "decision_function"):
            logits = np.asarray(model.decision_function(X_model_df), dtype=float).reshape(-1)
            return 1.0 / (1.0 + np.exp(-logits))

        if algorithm == "tabular_autoencoder" and hasattr(model, "predict"):
            recon = np.asarray(model.predict(X_model_df), dtype=float)
            if recon.ndim == 1:
                recon = recon.reshape(-1, 1)
            errors = np.mean(np.square(recon - X_model_arr), axis=1)
            calibration = bundle.get("score_calibration") or {}
            lower = calibration.get("reconstruction_error_min")
            upper = calibration.get("reconstruction_error_max")
            return self._normalize_scores(errors, lower, upper)

        if hasattr(model, "predict"):
            pred = np.asarray(model.predict(X_model_df), dtype=float).reshape(-1)
            if pred.size and set(np.unique(np.round(pred, 6)).tolist()).issubset({0.0, 1.0}):
                return np.clip(pred, 0.0, 1.0)
            return self._normalize_scores(pred)

        raise ValueError("Model artifact does not expose a supported scoring interface.")

    def _persist_scored_rows(
        self,
        model,
        deployment_id: str,
        run_id: str,
        entity_types: List[str],
        entity_ids: List[str],
        scores: np.ndarray,
        decisions: List[str],
        threshold: float,
        feature_columns: List[str],
        X_arr: np.ndarray,
        batch_id: Optional[str] = None,
        actual_labels: Optional[List[Optional[int]]] = None,
        source: str = "production",
    ) -> Dict[str, Any]:
        """Persist scored rows in ledger and return payload-ready row objects."""
        scored_at = datetime.utcnow()
        batch_ref = batch_id or str(uuid.uuid4())
        source_tag = str(source or "production").strip().lower() or "production"
        ledger_rows: List[Dict[str, Any]] = []

        if actual_labels is None:
            actual_labels = [None] * len(scores)
        if len(actual_labels) < len(scores):
            actual_labels = list(actual_labels) + [None] * (len(scores) - len(actual_labels))

        with self._conn() as conn:
            for i, (etype, eid, score, decision) in enumerate(
                zip(entity_types, entity_ids, scores, decisions)
            ):
                record_id = str(uuid.uuid4())
                top_feat = self._top_features(
                    model=model,
                    feature_columns=feature_columns,
                    row=X_arr[i],
                )
                reason = _reason_code(float(score), threshold)
                actual = actual_labels[i]
                actual_int = None if actual is None else int(actual)
                conn.execute(
                    """
                    INSERT INTO mlops_suppression_ledger
                      (record_id, deployment_id, run_id, batch_id, scored_at,
                       entity_id, entity_type, model_score, decision, threshold,
                       top_features, actual_label, reason_code, reviewer, source)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?)
                    """,
                    [
                        record_id,
                        deployment_id,
                        run_id,
                        batch_ref,
                        scored_at,
                        str(eid),
                        str(etype),
                        float(score),
                        str(decision),
                        float(threshold),
                        json.dumps(top_feat),
                        actual_int,
                        reason,
                        source_tag,
                    ],
                )
                ledger_rows.append(
                    {
                        "record_id": record_id,
                        "entity_id": str(eid),
                        "entity_type": str(etype),
                        "model_score": round(float(score), 6),
                        "decision": str(decision),
                        "threshold": float(threshold),
                        "reason_code": reason,
                        "top_features": top_feat,
                        "actual_label": actual_int,
                        "scored_at": scored_at.isoformat(),
                        "source": source_tag,
                    }
                )

        suppressed = sum(1 for d in decisions if d == "suppressed")
        escalated = len(decisions) - suppressed
        return {
            "batch_id": batch_ref,
            "scored_at": scored_at.isoformat(),
            "total": len(decisions),
            "suppressed": suppressed,
            "escalated": escalated,
            "suppression_rate": round(100.0 * suppressed / max(len(decisions), 1), 2),
            "ledger_rows": ledger_rows,
        }

    def _load_source_batch(self, batch_size: int, seed: int) -> Tuple[pd.DataFrame, str]:
        """Load source-system like data for live simulation."""
        env_root = self.model_dir.parent.parent
        data_dir = resolve_mlops_data_dir(env_root, create_if_missing=False)
        candidates = [
            data_dir / "transactions.csv",
            data_dir / "master_dataset.csv",
            data_dir / "preprocessed_dataset.csv",
        ]
        if data_dir.exists():
            candidates.extend(sorted(data_dir.glob("*.csv")))

        chosen = None
        for p in candidates:
            if p.exists() and p.stat().st_size > 0:
                chosen = p
                break

        if chosen is None:
            # Synthetic fallback if no source files exist yet.
            rng = np.random.default_rng(seed)
            n = int(max(batch_size, 32))
            df = pd.DataFrame(
                {
                    "alert_id": [f"ALT-{i+1:06d}" for i in range(n)],
                    "case_id": [f"CSE-{(i//3)+1:06d}" for i in range(n)],
                    "txn_amount": rng.lognormal(mean=8.4, sigma=0.9, size=n),
                    "velocity_7d": rng.integers(1, 30, size=n),
                    "cross_border": rng.integers(0, 2, size=n),
                    "txn_date": pd.date_range(datetime.utcnow() - timedelta(days=45), periods=n, freq="H"),
                    "country": rng.choice(["IN", "AE", "SG", "US", "GB"], size=n, p=[0.45, 0.20, 0.15, 0.12, 0.08]),
                    "risk_band": rng.choice(["low", "medium", "high"], size=n, p=[0.6, 0.3, 0.1]),
                }
            )
            return df.head(batch_size).copy(), "synthetic_source"

        df = pd.read_csv(chosen)
        if df.empty:
            raise ValueError(f"Source file {chosen} is empty")

        n = min(int(batch_size), len(df))
        sampled = df.sample(n=n, random_state=seed, replace=(len(df) < batch_size)).reset_index(drop=True)
        return sampled.copy(), chosen.name

    @staticmethod
    def _derive_is_true_pos_from_case_status(series: pd.Series) -> pd.Series:
        status_map = {
            "CLOSED_SAR_FILED": 1.0,
            "SAR_FILED": 1.0,
            "SAR FILED": 1.0,
            "TRUE_POSITIVE": 1.0,
            "CLOSED_FALSE_POSITIVE": 0.0,
            "FALSE_POSITIVE": 0.0,
            "CLOSED_MONITORING": 0.0,
            "MONITORING": 0.0,
            # OPEN / missing -> NaN (excluded)
        }
        text = series.astype(str).str.strip().str.upper()
        return text.map(status_map).astype("float64")

    @staticmethod
    def _event_loss_from_known_labels(
        labels: List[Optional[int]],
        decisions: List[str],
    ) -> Tuple[Optional[float], Dict[str, int]]:
        known: List[Tuple[int, str]] = []
        for y, d in zip(labels, decisions):
            if y is None:
                continue
            try:
                yi = int(y)
            except Exception:
                continue
            if yi not in (0, 1):
                continue
            known.append((yi, str(d).lower()))

        labelled_rows = int(len(known))
        positives = int(sum(1 for y, _ in known if y == 1))
        missed = int(sum(1 for y, d in known if y == 1 and d == "suppressed"))
        captured = int(max(positives - missed, 0))
        negatives = int(max(labelled_rows - positives, 0))

        event_loss_pct = round(100.0 * missed / positives, 2) if positives > 0 else None
        stats = {
            "labelled_rows": labelled_rows,
            "positive_rows": positives,
            "negative_rows": negatives,
            "missed_positive_rows": missed,
            "captured_positive_rows": captured,
            "event_loss_defined": bool(positives > 0),
        }
        return event_loss_pct, stats

    @staticmethod
    def _pairwise_auc(y_true: np.ndarray, y_score: np.ndarray) -> Optional[float]:
        """Compute ROC-AUC without sklearn using pairwise ranking."""
        pos_scores = y_score[y_true == 1]
        neg_scores = y_score[y_true == 0]
        n_pos = int(pos_scores.size)
        n_neg = int(neg_scores.size)
        if n_pos == 0 or n_neg == 0:
            return None
        wins = 0.0
        for s in pos_scores:
            wins += float(np.sum(s > neg_scores))
            wins += 0.5 * float(np.sum(s == neg_scores))
        return float(wins / max(n_pos * n_neg, 1))

    @staticmethod
    def _binary_metrics_from_threshold(
        y_true: np.ndarray,
        y_score: np.ndarray,
        threshold: float,
    ) -> Dict[str, Any]:
        pred = (y_score >= float(threshold)).astype(int)
        tp = int(((pred == 1) & (y_true == 1)).sum())
        tn = int(((pred == 0) & (y_true == 0)).sum())
        fp = int(((pred == 1) & (y_true == 0)).sum())
        fn = int(((pred == 0) & (y_true == 1)).sum())
        positives = int((y_true == 1).sum())
        negatives = int((y_true == 0).sum())
        total = int(y_true.size)
        precision = float(tp / max(tp + fp, 1))
        recall = float(tp / max(tp + fn, 1))
        f1 = float((2 * tp) / max((2 * tp) + fp + fn, 1))
        specificity = float(tn / max(tn + fp, 1))
        accuracy = float((tp + tn) / max(total, 1))
        suppression_rate_pct = float(((tn + fn) / max(total, 1)) * 100.0)
        event_loss_pct = float((fn / max(positives, 1)) * 100.0) if positives > 0 else None
        return {
            "tp": tp,
            "tn": tn,
            "fp": fp,
            "fn": fn,
            "precision": precision,
            "recall": recall,
            "f1": f1,
            "specificity": specificity,
            "accuracy": accuracy,
            "suppression_rate_pct": suppression_rate_pct,
            "event_loss_pct": event_loss_pct,
            "positives": positives,
            "negatives": negatives,
        }

    def _compute_oot_validation(
        self,
        *,
        scores: np.ndarray,
        labels: List[Optional[int]],
        threshold: float,
    ) -> Dict[str, Any]:
        """Compute OOT validation metrics from known labels in simulation batch."""
        known: List[Tuple[float, int]] = []
        for s, y in zip(scores.tolist(), labels):
            if y is None:
                continue
            try:
                yi = int(y)
                si = float(s)
            except Exception:
                continue
            if yi in (0, 1):
                known.append((si, yi))

        if not known:
            return {
                "defined": False,
                "known_rows": 0,
                "known_positive_rows": 0,
                "known_negative_rows": 0,
                "threshold": float(threshold),
                "note": "No known binary labels available for OOT validation metrics.",
            }

        y_score = np.array([k[0] for k in known], dtype=float)
        y_true = np.array([k[1] for k in known], dtype=int)
        base = self._binary_metrics_from_threshold(y_true, y_score, float(threshold))

        roc_points: List[Dict[str, float]] = []
        pr_points: List[Dict[str, float]] = []
        for t in np.linspace(1.0, 0.0, 81):
            m = self._binary_metrics_from_threshold(y_true, y_score, float(t))
            tpr = float(m["recall"])
            fpr = float(m["fp"] / max(m["fp"] + m["tn"], 1))
            precision = float(m["precision"])
            recall = float(m["recall"])
            roc_points.append({"threshold": round(float(t), 4), "fpr": round(fpr, 4), "tpr": round(tpr, 4)})
            pr_points.append({"threshold": round(float(t), 4), "recall": round(recall, 4), "precision": round(precision, 4)})

        roc_points = sorted(roc_points, key=lambda r: (r["fpr"], r["tpr"]))
        pr_points = sorted(pr_points, key=lambda r: r["recall"])
        if len(roc_points) > 1:
            roc_auc = _trapezoid_area([p["tpr"] for p in roc_points], [p["fpr"] for p in roc_points])
            roc_auc = max(0.0, min(1.0, roc_auc))
        else:
            roc_auc = self._pairwise_auc(y_true, y_score)
        if len(pr_points) > 1:
            pr_auc = _trapezoid_area([p["precision"] for p in pr_points], [p["recall"] for p in pr_points])
            pr_auc = max(0.0, min(1.0, pr_auc))
        else:
            pr_auc = None

        threshold_table: List[Dict[str, Any]] = []
        table_thresholds = sorted(
            set([round(float(threshold), 2)] + [round(float(t), 2) for t in np.arange(0.10, 0.91, 0.05)]),
        )
        for t in table_thresholds:
            m = self._binary_metrics_from_threshold(y_true, y_score, float(t))
            threshold_table.append(
                {
                    "threshold": round(float(t), 2),
                    "suppressed": int(m["tn"] + m["fn"]),
                    "escalated": int(m["tp"] + m["fp"]),
                    "tp": int(m["tp"]),
                    "tn": int(m["tn"]),
                    "fp": int(m["fp"]),
                    "fn": int(m["fn"]),
                    "suppression_rate_pct": round(float(m["suppression_rate_pct"]), 2),
                    "event_loss_pct": None if m["event_loss_pct"] is None else round(float(m["event_loss_pct"]), 2),
                    "precision": round(float(m["precision"]), 4),
                    "recall": round(float(m["recall"]), 4),
                    "f1": round(float(m["f1"]), 4),
                    "specificity": round(float(m["specificity"]), 4),
                    "accuracy": round(float(m["accuracy"]), 4),
                    "is_selected": abs(float(t) - float(threshold)) < 1e-9,
                }
            )

        return {
            "defined": True,
            "known_rows": int(y_true.size),
            "known_positive_rows": int(base["positives"]),
            "known_negative_rows": int(base["negatives"]),
            "threshold": float(threshold),
            "confusion_matrix": [
                [int(base["tn"]), int(base["fp"])],
                [int(base["fn"]), int(base["tp"])],
            ],
            "suppression_rate_pct": round(float(base["suppression_rate_pct"]), 2),
            "event_loss_pct": None if base["event_loss_pct"] is None else round(float(base["event_loss_pct"]), 2),
            "precision": round(float(base["precision"]), 4),
            "recall": round(float(base["recall"]), 4),
            "f1": round(float(base["f1"]), 4),
            "specificity": round(float(base["specificity"]), 4),
            "accuracy": round(float(base["accuracy"]), 4),
            "roc_auc": None if roc_auc is None else round(float(roc_auc), 4),
            "pr_auc": None if pr_auc is None else round(float(pr_auc), 4),
            "roc_curve": roc_points,
            "pr_curve": pr_points,
            "threshold_table": threshold_table,
        }

    @staticmethod
    def _optimize_threshold_with_event_loss_cap(
        scores: np.ndarray,
        labels: List[Optional[int]],
        *,
        max_event_loss_pct: float = 5.0,
    ) -> Optional[Dict[str, Any]]:
        """
        Choose threshold that maximizes suppression while respecting Event Loss cap.
        Uses only rows with known binary labels.
        """
        known: List[Tuple[float, int]] = []
        for s, y in zip(scores.tolist(), labels):
            if y is None:
                continue
            try:
                yi = int(y)
                si = float(s)
            except Exception:
                continue
            if yi not in (0, 1):
                continue
            known.append((si, yi))
        if not known:
            return None

        known_scores = np.array([k[0] for k in known], dtype=float)
        known_labels = np.array([k[1] for k in known], dtype=int)
        positives = int((known_labels == 1).sum())
        if positives <= 0:
            return None

        rows: List[Dict[str, Any]] = []
        best: Optional[Dict[str, Any]] = None
        # 0.10 .. 0.90 step 0.01 for stable but precise selection.
        for t in np.arange(0.10, 0.901, 0.01):
            decisions = known_scores >= float(t)
            tp = int(((decisions == 1) & (known_labels == 1)).sum())
            fn = int(((decisions == 0) & (known_labels == 1)).sum())
            tn = int(((decisions == 0) & (known_labels == 0)).sum())
            fp = int(((decisions == 1) & (known_labels == 0)).sum())

            suppression_pct = round(100.0 * (tn + fn) / max(len(known_labels), 1), 2)
            event_loss_pct = round(100.0 * fn / max(positives, 1), 2)
            recall = round(tp / max(positives, 1), 4)
            precision = round(tp / max(tp + fp, 1), 4)
            row = {
                "threshold": round(float(t), 2),
                "suppression_pct": suppression_pct,
                "event_loss_pct": event_loss_pct,
                "recall": recall,
                "precision": precision,
            }
            rows.append(row)
            if event_loss_pct <= float(max_event_loss_pct):
                if best is None:
                    best = row
                else:
                    # Primary: maximize suppression. Secondary: maximize recall.
                    if (
                        row["suppression_pct"] > best["suppression_pct"]
                        or (
                            row["suppression_pct"] == best["suppression_pct"]
                            and row["recall"] > best["recall"]
                        )
                    ):
                        best = row

        if best is None:
            # No feasible threshold under cap: keep minimum event loss row as diagnostic fallback.
            best = min(rows, key=lambda r: (r["event_loss_pct"], -r["suppression_pct"]))
            feasible = False
        else:
            feasible = True

        return {
            "max_event_loss_pct": float(max_event_loss_pct),
            "feasible": bool(feasible),
            "recommended_threshold": float(best["threshold"]),
            "recommended_suppression_pct": float(best["suppression_pct"]),
            "recommended_event_loss_pct": float(best["event_loss_pct"]),
            "recommended_recall": float(best["recall"]),
            "recommended_precision": float(best["precision"]),
            "known_labelled_rows": int(len(known_labels)),
            "known_positive_rows": int(positives),
            "table": rows,
        }

    def _generate_synthetic_pipeline_batch(
        self,
        batch_size: int,
        seed: int,
    ) -> Dict[str, Any]:
        """
        Generate a realistic AML simulation set:
        customers + accounts + transactions + alerts + cases -> master table.

        Labels are derived from CASE_STATUS (not from model scores):
          CLOSED_SAR_FILED=1, CLOSED_FALSE_POSITIVE/CLOSED_MONITORING=0, OPEN/no-case=NaN.
        """
        rng = np.random.default_rng(seed)
        n_alerts = int(max(batch_size, 64))
        n_customers = int(max(220, n_alerts * 0.55))
        n_accounts = int(max(320, n_alerts * 0.85))
        n_txns = int(max(1800, n_alerts * 12))

        high_risk_countries = np.array(["KY", "VG", "NG", "IR", "PK"])
        countries = np.array(["IN", "US", "AE", "SG", "GB", "CN", "MY", "KY", "VG", "NG"])
        country_p = np.array([0.38, 0.15, 0.10, 0.08, 0.07, 0.06, 0.04, 0.04, 0.04, 0.04])
        occupations = np.array(
            ["SALARIED", "SELF_EMPLOYED", "BUSINESS_OWNER", "RETIRED", "STUDENT", "POLITICIAN", "SHELL_CO"]
        )
        occ_p = np.array([0.36, 0.22, 0.19, 0.08, 0.05, 0.06, 0.04])
        account_types = np.array(["SAVINGS", "CURRENT", "SALARY", "NRE", "NRO", "TRUST", "SHELL"])
        account_type_p = np.array([0.30, 0.24, 0.19, 0.10, 0.08, 0.05, 0.04])

        customers_df = pd.DataFrame(
            {
                "CUSTOMER_ID": [f"CUST{i:07d}" for i in range(1, n_customers + 1)],
                "NATIONALITY": rng.choice(countries, size=n_customers, p=country_p),
                "OCCUPATION": rng.choice(occupations, size=n_customers, p=occ_p),
                "INCOME_BRACKET": rng.choice(
                    ["0-50k", "50k-100k", "100k-250k", "250k+"],
                    size=n_customers,
                    p=[0.34, 0.31, 0.22, 0.13],
                ),
                "CUSTOMER_RISK_RATING": rng.choice(
                    np.arange(1, 11),
                    size=n_customers,
                    p=[0.18, 0.17, 0.15, 0.12, 0.10, 0.09, 0.07, 0.05, 0.04, 0.03],
                ),
                "ONBOARDING_CHANNEL": rng.choice(
                    ["BRANCH", "MOBILE", "WEB", "THIRD_PARTY"],
                    size=n_customers,
                    p=[0.30, 0.35, 0.25, 0.10],
                ),
            }
        )
        pep_prob = np.where(
            customers_df["OCCUPATION"].eq("POLITICIAN"),
            0.90,
            np.where(customers_df["NATIONALITY"].isin(["KY", "VG"]), 0.22, 0.02),
        )
        base_risk = customers_df["CUSTOMER_RISK_RATING"].to_numpy()
        sanction_prob = np.where(base_risk >= 9, 0.08, np.where(base_risk >= 7, 0.02, 0.004))
        customers_df["PEP_FLAG"] = (rng.random(n_customers) < pep_prob).astype(int)
        customers_df["SANCTION_HIT"] = (rng.random(n_customers) < sanction_prob).astype(int)
        customers_df["ADVERSE_MEDIA_FLAG"] = (rng.random(n_customers) < ((base_risk / 100.0) + 0.01)).astype(int)
        customers_df["KYC_COMPLETENESS_PCT"] = np.clip(
            rng.normal(loc=100 - (base_risk * 4), scale=8, size=n_customers),
            30,
            100,
        ).round(1)
        customers_df["DAYS_SINCE_KYC"] = np.clip(rng.exponential(scale=190, size=n_customers).astype(int), 1, 2200)
        customers_df["IS_ACTIVE"] = rng.choice([1, 0], size=n_customers, p=[0.94, 0.06])

        accounts_df = pd.DataFrame(
            {
                "ACCOUNT_ID": [f"ACCT{100000000 + i}" for i in range(1, n_accounts + 1)],
                "CUSTOMER_ID": rng.choice(customers_df["CUSTOMER_ID"].to_numpy(), size=n_accounts),
                "ACCOUNT_TYPE": rng.choice(account_types, size=n_accounts, p=account_type_p),
                "CURRENCY": rng.choice(["INR", "USD", "AED", "SGD", "GBP"], size=n_accounts, p=[0.54, 0.20, 0.12, 0.08, 0.06]),
                "NUM_SIGNATORIES": rng.choice([1, 2, 3], size=n_accounts, p=[0.70, 0.22, 0.08]),
            }
        )
        mean_balance = {
            "SAVINGS": 50_000,
            "CURRENT": 150_000,
            "SALARY": 35_000,
            "NRE": 500_000,
            "NRO": 300_000,
            "TRUST": 1_000_000,
            "SHELL": 2_000_000,
        }
        sigma = 1.35
        mu_vals = np.log(np.array([mean_balance[t] for t in accounts_df["ACCOUNT_TYPE"]])) - (0.5 * sigma * sigma)
        accounts_df["CURRENT_BALANCE"] = np.round(rng.lognormal(mean=mu_vals, sigma=sigma), 2)
        dormant_prob = np.where(accounts_df["ACCOUNT_TYPE"].isin(["SHELL", "TRUST"]), 0.40, 0.08)
        accounts_df["ACCOUNT_STATUS"] = np.where(
            rng.random(n_accounts) < dormant_prob,
            "DORMANT",
            rng.choice(["ACTIVE", "BLOCKED", "CLOSED"], size=n_accounts, p=[0.92, 0.05, 0.03]),
        )

        tx_types = np.array(
            [
                "UPI",
                "NEFT",
                "RTGS",
                "IMPS",
                "SWIFT",
                "CASH_DEPOSIT",
                "CASH_WITHDRAWAL",
                "POS",
                "CHEQUE",
                "INTERNAL_TRANSFER",
            ]
        )
        tx_type_p = np.array([0.28, 0.20, 0.10, 0.12, 0.05, 0.08, 0.06, 0.04, 0.04, 0.03])
        tx_amount = np.round(rng.lognormal(mean=np.log(15_000) - 0.5 * 1.25 * 1.25, sigma=1.25, size=n_txns), 2)
        start = datetime.utcnow() - timedelta(days=720)
        ts_offsets = rng.integers(0, 720 * 24, size=n_txns)
        tx_ts = pd.to_datetime(start) + pd.to_timedelta(ts_offsets, unit="h")

        transactions_df = pd.DataFrame(
            {
                "TRANSACTION_ID": [f"TXN{i:09d}" for i in range(1, n_txns + 1)],
                "ACCOUNT_ID": rng.choice(accounts_df["ACCOUNT_ID"].to_numpy(), size=n_txns),
                "TXN_TIMESTAMP": tx_ts,
                "TXN_TYPE": rng.choice(tx_types, size=n_txns, p=tx_type_p),
                "TXN_AMOUNT": tx_amount,
                "BENEFICIARY_COUNTRY": rng.choice(countries, size=n_txns, p=country_p),
                "CHANNEL": rng.choice(["MOBILE", "WEB", "BRANCH", "ATM"], size=n_txns, p=[0.43, 0.27, 0.20, 0.10]),
                "NARRATIVE": rng.choice(
                    [
                        "SALARY",
                        "RENT",
                        "VENDOR_PAYMENT",
                        "LOAN_EMI",
                        "GROCERY",
                        "INSURANCE",
                        "UTILITY",
                        "TRANSFER",
                        "INVESTMENT",
                        "DIVIDEND",
                        "REF_LAYERING",
                        "REF_STRUCTURING",
                        "REF_MULE",
                    ],
                    size=n_txns,
                ),
            }
        )

        tx_type_upper = transactions_df["TXN_TYPE"].astype(str).str.upper()
        amount_s = pd.to_numeric(transactions_df["TXN_AMOUNT"], errors="coerce").fillna(0.0)
        bene_s = transactions_df["BENEFICIARY_COUNTRY"].astype(str).str.upper()
        narrative_s = transactions_df["NARRATIVE"].astype(str).str.upper()

        is_structuring = tx_type_upper.isin(["CASH_DEPOSIT", "CASH_WITHDRAWAL"]) & amount_s.between(8_500, 11_000)
        is_layering = tx_type_upper.eq("SWIFT") | narrative_s.str.contains("LAYER", regex=False, na=False)
        is_mule = tx_type_upper.eq("UPI") & amount_s.between(4_000, 55_000)
        is_rapid = tx_type_upper.isin(["IMPS", "RTGS"]) & bene_s.isin(high_risk_countries)
        is_high_value = amount_s >= float(np.nanpercentile(amount_s.to_numpy(), 85))

        rule_series = pd.Series("R001_HIGH_VALUE_CASH", index=transactions_df.index)
        rule_series = np.where(is_structuring, "R002_STRUCTURING_SIGNAL", rule_series)
        rule_series = np.where(is_layering, "R003_LAYERING_SIGNAL", rule_series)
        rule_series = np.where(is_mule, "R004_MULE_SIGNAL", rule_series)
        rule_series = np.where(is_rapid, "R005_RAPID_MVT", rule_series)
        rule_series = np.where((bene_s.isin(high_risk_countries)) & (~is_rapid), "R006_HIGH_RISK_DEST", rule_series)
        rule_series = pd.Series(rule_series, index=transactions_df.index)

        base_risk = (
            42.0
            + (is_high_value.astype(float) * 12.0)
            + (is_structuring.astype(float) * 14.0)
            + (is_layering.astype(float) * 18.0)
            + (is_mule.astype(float) * 10.0)
            + (is_rapid.astype(float) * 17.0)
            + (bene_s.isin(high_risk_countries).astype(float) * 11.0)
            + rng.normal(0.0, 6.0, size=n_txns)
        )
        risk_score_tx = np.clip(np.round(base_risk), 8, 99).astype(int)

        alert_idx = np.argsort(risk_score_tx)[-n_alerts:]
        alerts_df = transactions_df.iloc[alert_idx].copy().reset_index(drop=True)
        alerts_df["ALERT_ID"] = [f"ALT{i:08d}" for i in range(1, len(alerts_df) + 1)]
        alerts_df["RULE_TRIGGERED"] = rule_series.iloc[alert_idx].to_numpy()
        # Preserve the top-alert scores positionally. Using a Series with the
        # original transaction index would align by label after reset_index()
        # and wipe most simulated scores to NaN/0.
        alerts_df["RISK_SCORE"] = pd.Series(risk_score_tx).iloc[alert_idx].to_numpy()
        alerts_df["ALERT_DATE"] = pd.to_datetime(alerts_df["TXN_TIMESTAMP"])
        alerts_df = alerts_df[
            [
                "ALERT_ID",
                "TRANSACTION_ID",
                "ACCOUNT_ID",
                "RULE_TRIGGERED",
                "RISK_SCORE",
                "ALERT_DATE",
                "TXN_TYPE",
                "TXN_AMOUNT",
                "BENEFICIARY_COUNTRY",
                "CHANNEL",
                "NARRATIVE",
            ]
        ]

        escalated_mask = rng.random(len(alerts_df)) < 0.30
        case_alerts = alerts_df.loc[escalated_mask].copy().reset_index(drop=True)
        risk_norm = np.clip((pd.to_numeric(case_alerts["RISK_SCORE"], errors="coerce").fillna(40) - 30.0) / 70.0, 0.02, 0.85)
        is_real = rng.random(len(case_alerts)) < risk_norm
        statuses: List[str] = []
        for real in is_real:
            if bool(real):
                statuses.append(
                    rng.choice(
                        ["CLOSED_SAR_FILED", "CLOSED_FALSE_POSITIVE", "CLOSED_MONITORING", "OPEN"],
                        p=[0.42, 0.36, 0.12, 0.10],
                    )
                )
            else:
                statuses.append(
                    rng.choice(
                        ["CLOSED_SAR_FILED", "CLOSED_FALSE_POSITIVE", "CLOSED_MONITORING", "OPEN"],
                        p=[0.03, 0.82, 0.09, 0.06],
                    )
                )
        case_priority = np.where(
            case_alerts["RISK_SCORE"] >= 80,
            "HIGH",
            np.where(case_alerts["RISK_SCORE"] >= 60, "MEDIUM", "LOW"),
        )
        cases_df = pd.DataFrame(
            {
                "CASE_ID": [f"CASE{i:07d}" for i in range(1, len(case_alerts) + 1)],
                "ALERT_ID": case_alerts["ALERT_ID"].to_numpy(),
                "INVESTIGATOR_ID": rng.choice(["INV_01", "INV_02", "INV_03", "INV_04", "AUTO_SYS"], size=len(case_alerts)),
                "PRIORITY": case_priority,
                "CASE_STATUS": statuses,
                "RESOLUTION_DAYS": rng.integers(1, 45, size=len(case_alerts)),
                "CASE_OPEN_DATE": pd.to_datetime(case_alerts["ALERT_DATE"]),
            }
        )

        master = alerts_df.merge(
            cases_df[["ALERT_ID", "CASE_ID", "PRIORITY", "CASE_STATUS", "RESOLUTION_DAYS", "INVESTIGATOR_ID", "CASE_OPEN_DATE"]],
            on="ALERT_ID",
            how="left",
        )
        master = master.merge(
            accounts_df[
                [
                    "ACCOUNT_ID",
                    "CUSTOMER_ID",
                    "ACCOUNT_TYPE",
                    "ACCOUNT_STATUS",
                    "CURRENT_BALANCE",
                    "CURRENCY",
                    "NUM_SIGNATORIES",
                ]
            ],
            on="ACCOUNT_ID",
            how="left",
        )
        master = master.merge(
            customers_df[
                [
                    "CUSTOMER_ID",
                    "NATIONALITY",
                    "OCCUPATION",
                    "INCOME_BRACKET",
                    "CUSTOMER_RISK_RATING",
                    "PEP_FLAG",
                    "SANCTION_HIT",
                    "ADVERSE_MEDIA_FLAG",
                    "KYC_COMPLETENESS_PCT",
                    "DAYS_SINCE_KYC",
                    "ONBOARDING_CHANNEL",
                    "IS_ACTIVE",
                ]
            ],
            on="CUSTOMER_ID",
            how="left",
        )

        tx_for_agg = transactions_df.copy()
        tx_for_agg["TXN_AMOUNT"] = pd.to_numeric(tx_for_agg["TXN_AMOUNT"], errors="coerce")
        tx_for_agg["TXN_TYPE_UP"] = tx_for_agg["TXN_TYPE"].astype(str).str.upper()
        tx_for_agg["BENE_UP"] = tx_for_agg["BENEFICIARY_COUNTRY"].astype(str).str.upper()
        txn_agg = tx_for_agg.groupby("ACCOUNT_ID").agg(
            total_txn_volume=("TXN_AMOUNT", "sum"),
            txn_count=("TRANSACTION_ID", "count"),
            avg_txn_amount=("TXN_AMOUNT", "mean"),
            max_txn_amount=("TXN_AMOUNT", "max"),
            std_txn_amount=("TXN_AMOUNT", "std"),
            unique_channels=("CHANNEL", "nunique"),
            unique_beneficiary_countries=("BENEFICIARY_COUNTRY", "nunique"),
            cash_txn_count=("TXN_TYPE_UP", lambda s: int(s.isin(["CASH_DEPOSIT", "CASH_WITHDRAWAL"]).sum())),
            swift_txn_count=("TXN_TYPE_UP", lambda s: int((s == "SWIFT").sum())),
            pct_high_risk_dest=("BENE_UP", lambda s: float(s.isin(high_risk_countries).mean() * 100.0)),
        ).reset_index()
        txn_agg["std_txn_amount"] = txn_agg["std_txn_amount"].fillna(0.0)
        txn_agg["velocity_ratio"] = txn_agg["max_txn_amount"] / (txn_agg["avg_txn_amount"] + 1.0)

        master = master.merge(txn_agg, on="ACCOUNT_ID", how="left")

        master["CASE_OPEN_DATE"] = pd.to_datetime(master.get("CASE_OPEN_DATE"), errors="coerce")
        master["OPEN_DATE"] = master["CASE_OPEN_DATE"].copy()

        master["CASE_ID"] = master.get("CASE_ID", pd.Series(index=master.index, dtype="object")).astype("object")
        master["CASE_STATUS"] = master.get("CASE_STATUS", pd.Series(index=master.index, dtype="object")).astype("object")
        master["PRIORITY"] = master.get("PRIORITY", pd.Series(index=master.index, dtype="object")).astype("object")
        master["INVESTIGATOR_ID"] = master.get("INVESTIGATOR_ID", pd.Series(index=master.index, dtype="object")).astype("object")

        next_case_num = int(len(cases_df) + 1)

        def _priority_from_risk(score: Any) -> str:
            try:
                score_f = float(score)
            except Exception:
                score_f = 0.0
            if score_f >= 82:
                return "HIGH"
            if score_f >= 62:
                return "MEDIUM"
            return "LOW"

        def _assign_case_rows(indices: List[int], statuses_to_apply: List[str]) -> None:
            nonlocal next_case_num
            if not indices:
                return
            for idx, status in zip(indices, statuses_to_apply):
                case_id_val = str(master.at[idx, "CASE_ID"] or "").strip()
                if not case_id_val or case_id_val.lower() == "nan":
                    case_id_val = f"CASE{next_case_num:07d}"
                    next_case_num += 1
                    master.at[idx, "CASE_ID"] = case_id_val
                master.at[idx, "CASE_STATUS"] = str(status)
                master.at[idx, "PRIORITY"] = _priority_from_risk(master.at[idx, "RISK_SCORE"])
                investigator_val = master.at[idx, "INVESTIGATOR_ID"]
                if pd.isna(investigator_val) or not str(investigator_val).strip():
                    investigator_val = rng.choice(["INV_01", "INV_02", "INV_03", "INV_04", "AUTO_SYS"])
                master.at[idx, "INVESTIGATOR_ID"] = str(investigator_val)
                resolution_val = master.at[idx, "RESOLUTION_DAYS"]
                if pd.isna(resolution_val):
                    resolution_val = int(rng.integers(2, 45))
                master.at[idx, "RESOLUTION_DAYS"] = int(resolution_val)
                open_date = pd.to_datetime(master.at[idx, "CASE_OPEN_DATE"], errors="coerce")
                if pd.isna(open_date):
                    open_date = pd.to_datetime(master.at[idx, "ALERT_DATE"], errors="coerce")
                master.at[idx, "CASE_OPEN_DATE"] = open_date
                master.at[idx, "OPEN_DATE"] = open_date

        case_status_upper = master["CASE_STATUS"].astype(str).str.strip().str.upper()
        positive_mask = case_status_upper.isin(["CLOSED_SAR_FILED", "SAR_FILED", "SAR FILED", "TRUE_POSITIVE"])
        negative_mask = case_status_upper.isin(["CLOSED_FALSE_POSITIVE", "FALSE_POSITIVE", "CLOSED_MONITORING", "MONITORING"])

        target_positive = max(6, int(round(len(master) * 0.10)))
        target_negative = max(12, int(round(len(master) * 0.18)))
        target_labelled = max(target_positive + target_negative, int(round(len(master) * 0.35)))

        if int(positive_mask.sum()) < target_positive:
            positive_candidates = (
                master.assign(_risk_rank=pd.to_numeric(master["RISK_SCORE"], errors="coerce").fillna(0.0))
                .loc[~positive_mask]
                .sort_values("_risk_rank", ascending=False)
                .index
                .tolist()
            )
            needed = max(target_positive - int(positive_mask.sum()), 0)
            _assign_case_rows(positive_candidates[:needed], ["CLOSED_SAR_FILED"] * needed)

        case_status_upper = master["CASE_STATUS"].astype(str).str.strip().str.upper()
        positive_mask = case_status_upper.isin(["CLOSED_SAR_FILED", "SAR_FILED", "SAR FILED", "TRUE_POSITIVE"])
        negative_mask = case_status_upper.isin(["CLOSED_FALSE_POSITIVE", "FALSE_POSITIVE", "CLOSED_MONITORING", "MONITORING"])

        if int(negative_mask.sum()) < target_negative:
            negative_candidates = (
                master.assign(_risk_rank=pd.to_numeric(master["RISK_SCORE"], errors="coerce").fillna(0.0))
                .loc[~positive_mask & ~negative_mask]
                .sort_values("_risk_rank", ascending=True)
                .index
                .tolist()
            )
            needed = max(target_negative - int(negative_mask.sum()), 0)
            neg_statuses = [
                "CLOSED_FALSE_POSITIVE" if i % 3 else "CLOSED_MONITORING"
                for i in range(needed)
            ]
            _assign_case_rows(negative_candidates[:needed], neg_statuses)

        case_status_upper = master["CASE_STATUS"].astype(str).str.strip().str.upper()
        labelled_mask = case_status_upper.isin(
            ["CLOSED_SAR_FILED", "SAR_FILED", "SAR FILED", "TRUE_POSITIVE", "CLOSED_FALSE_POSITIVE", "FALSE_POSITIVE", "CLOSED_MONITORING", "MONITORING"]
        )
        if int(labelled_mask.sum()) < target_labelled:
            remaining_needed = max(target_labelled - int(labelled_mask.sum()), 0)
            additional_candidates = (
                master.assign(_risk_rank=pd.to_numeric(master["RISK_SCORE"], errors="coerce").fillna(0.0))
                .loc[~labelled_mask]
                .sort_values("_risk_rank", ascending=False)
                .index
                .tolist()
            )
            additional_statuses = [
                "CLOSED_SAR_FILED" if i % 5 == 0 else ("CLOSED_MONITORING" if i % 2 == 0 else "CLOSED_FALSE_POSITIVE")
                for i in range(remaining_needed)
            ]
            _assign_case_rows(additional_candidates[:remaining_needed], additional_statuses)

        alert_date_series = pd.to_datetime(master["ALERT_DATE"], errors="coerce")
        account_alert_counts = master.groupby("ACCOUNT_ID")["ALERT_ID"].transform("count").fillna(0).astype(int)
        customer_linked_accounts = master.groupby("CUSTOMER_ID")["ACCOUNT_ID"].transform("nunique").fillna(1).astype(int)
        customer_case_counts = master["CASE_ID"].astype(str).str.strip().replace({"nan": ""})
        customer_case_counts = customer_case_counts.ne("").groupby(master["CUSTOMER_ID"]).transform("sum").fillna(0).astype(int)
        account_type_upper = master["ACCOUNT_TYPE"].astype(str).str.upper()
        nationality_upper = master["NATIONALITY"].astype(str).str.upper()
        onboarding_upper = master["ONBOARDING_CHANNEL"].astype(str).str.upper()
        risk_score_num = pd.to_numeric(master["RISK_SCORE"], errors="coerce").fillna(0.0)
        customer_risk_num = pd.to_numeric(master["CUSTOMER_RISK_RATING"], errors="coerce").fillna(0.0)
        current_balance_num = pd.to_numeric(master["CURRENT_BALANCE"], errors="coerce").fillna(0.0)
        total_volume_num = pd.to_numeric(master["total_txn_volume"], errors="coerce").fillna(0.0)
        kyc_days_num = pd.to_numeric(master["DAYS_SINCE_KYC"], errors="coerce").fillna(0.0)
        kyc_pct_num = pd.to_numeric(master["KYC_COMPLETENESS_PCT"], errors="coerce").fillna(0.0)
        is_shell = account_type_upper.eq("SHELL") | master["OCCUPATION"].astype(str).str.upper().eq("SHELL_CO")
        is_high_risk_nat = nationality_upper.isin(high_risk_countries)

        master["ACCT_ALERT_COUNT"] = account_alert_counts
        master["ALERT_HOUR"] = alert_date_series.dt.hour.fillna(0).astype(int)
        master["ALERT_IS_WEEKEND"] = alert_date_series.dt.dayofweek.fillna(0).astype(int).isin([5, 6]).astype(int)
        master["ANALYST_RISK_SCORE"] = np.clip(
            (risk_score_num * 0.52)
            + (customer_risk_num * 4.0)
            + (master["PEP_FLAG"].astype(float) * 10.0)
            + (master["SANCTION_HIT"].astype(float) * 18.0)
            + (master["ADVERSE_MEDIA_FLAG"].astype(float) * 7.0)
            + rng.normal(0.0, 4.0, size=len(master)),
            5.0,
            99.0,
        ).round(1)
        master["DOCS_REQUESTED"] = ((risk_score_num >= 78) | (master["PEP_FLAG"] == 1) | (master["SANCTION_HIT"] == 1)).astype(int)
        master["CUSTOMER_CONTACTED"] = ((master["DOCS_REQUESTED"] == 1) | (risk_score_num >= 72)).astype(int)
        master["EDD_TRIGGERED"] = ((risk_score_num >= 82) | is_high_risk_nat | is_shell).astype(int)
        master["LINKED_CASES_COUNT"] = customer_case_counts
        master["EXPECTED_MONTHLY_TXN"] = np.clip((total_volume_num / 24.0) + rng.normal(0.0, 3500.0, size=len(master)), 500.0, None).round(2)
        master["ACCOUNT_RISK_RATING"] = np.clip(
            np.round(
                (customer_risk_num * 0.75)
                + np.where(account_type_upper.isin(["SHELL", "TRUST"]), 2.0, 0.0)
                + np.where(master["ACCOUNT_STATUS"].astype(str).str.upper().eq("DORMANT"), 1.0, 0.0)
            ),
            1,
            10,
        ).astype(int)
        master["NUM_LINKED_ACCOUNTS"] = customer_linked_accounts
        master["DEBIT_CARD_ISSUED"] = account_type_upper.isin(["SAVINGS", "CURRENT", "SALARY", "NRO"]).astype(int)
        master["INTERNET_BANKING"] = onboarding_upper.isin(["WEB", "MOBILE"]).astype(int)
        master["YEARS_AS_CUSTOMER"] = np.clip((kyc_days_num / 365.0) + rng.normal(1.4, 0.45, size=len(master)), 0.25, 25.0).round(1)
        master["NUM_PRODUCTS_HELD"] = np.clip(customer_linked_accounts + rng.integers(0, 3, size=len(master)), 1, 8).astype(int)
        master["FATF_HIGH_RISK_NATIONALITY"] = is_high_risk_nat.astype(int)
        master["KYC_REVIEW_OVERDUE"] = ((kyc_days_num > 365) | (kyc_pct_num < 70.0)).astype(int)
        master["LAST_TRANSACTION_DAYS_AGO"] = np.clip(
            (pd.Timestamp(datetime.utcnow()) - alert_date_series).dt.days.fillna(0),
            0,
            None,
        ).astype(int)
        master["CORRESPONDENT_BANK_FLAG"] = (
            master["TXN_TYPE"].astype(str).str.upper().eq("SWIFT") & master["BENEFICIARY_COUNTRY"].astype(str).str.upper().isin(high_risk_countries)
        ).astype(int)
        master["SHELL_CO_INDICATOR"] = is_shell.astype(int)

        cdd_tier = np.where(
            (master["EDD_TRIGGERED"] == 1) | (master["KYC_REVIEW_OVERDUE"] == 1),
            "ENHANCED",
            np.where((customer_risk_num <= 3) & (master["PEP_FLAG"].astype(float) == 0) & (master["SANCTION_HIT"].astype(float) == 0), "SIMPLIFIED", "STANDARD"),
        )
        master["CDD_TIER"] = cdd_tier
        master["CDD_TIER_ENHANCED"] = (master["CDD_TIER"] == "ENHANCED").astype(int)
        master["CDD_TIER_SIMPLIFIED"] = (master["CDD_TIER"] == "SIMPLIFIED").astype(int)
        master["CDD_TIER_STANDARD"] = (master["CDD_TIER"] == "STANDARD").astype(int)

        for date_col in ("CASE_OPEN_DATE", "OPEN_DATE"):
            date_series = pd.to_datetime(master[date_col], errors="coerce")
            master[f"{date_col}_year"] = date_series.dt.year.fillna(0).astype(int)
            master[f"{date_col}_month"] = date_series.dt.month.fillna(0).astype(int)
            master[f"{date_col}_day"] = date_series.dt.day.fillna(0).astype(int)
            master[f"{date_col}_dow"] = date_series.dt.dayofweek.fillna(0).astype(int)
            master[f"{date_col}_hour"] = date_series.dt.hour.fillna(0).astype(int)

        numeric_fill = [
            "RISK_SCORE",
            "TXN_AMOUNT",
            "CURRENT_BALANCE",
            "CUSTOMER_RISK_RATING",
            "KYC_COMPLETENESS_PCT",
            "DAYS_SINCE_KYC",
            "NUM_SIGNATORIES",
            "IS_ACTIVE",
            "total_txn_volume",
            "txn_count",
            "avg_txn_amount",
            "max_txn_amount",
            "std_txn_amount",
            "unique_channels",
            "unique_beneficiary_countries",
            "cash_txn_count",
            "swift_txn_count",
            "pct_high_risk_dest",
            "velocity_ratio",
            "ACCT_ALERT_COUNT",
            "ALERT_HOUR",
            "ALERT_IS_WEEKEND",
            "ANALYST_RISK_SCORE",
            "DOCS_REQUESTED",
            "CUSTOMER_CONTACTED",
            "EDD_TRIGGERED",
            "LINKED_CASES_COUNT",
            "EXPECTED_MONTHLY_TXN",
            "ACCOUNT_RISK_RATING",
            "NUM_LINKED_ACCOUNTS",
            "DEBIT_CARD_ISSUED",
            "INTERNET_BANKING",
            "YEARS_AS_CUSTOMER",
            "NUM_PRODUCTS_HELD",
            "FATF_HIGH_RISK_NATIONALITY",
            "KYC_REVIEW_OVERDUE",
            "LAST_TRANSACTION_DAYS_AGO",
            "CORRESPONDENT_BANK_FLAG",
            "SHELL_CO_INDICATOR",
            "CDD_TIER_ENHANCED",
            "CDD_TIER_SIMPLIFIED",
            "CDD_TIER_STANDARD",
            "CASE_OPEN_DATE_year",
            "CASE_OPEN_DATE_month",
            "CASE_OPEN_DATE_day",
            "CASE_OPEN_DATE_dow",
            "CASE_OPEN_DATE_hour",
            "OPEN_DATE_year",
            "OPEN_DATE_month",
            "OPEN_DATE_day",
            "OPEN_DATE_dow",
            "OPEN_DATE_hour",
        ]
        for col in numeric_fill:
            if col in master.columns:
                master[col] = pd.to_numeric(master[col], errors="coerce").fillna(0.0)

        if "CASE_STATUS" in master.columns:
            master["IS_TRUE_POS"] = self._derive_is_true_pos_from_case_status(master["CASE_STATUS"])
        else:
            master["IS_TRUE_POS"] = np.nan
        if "CASE_LABEL" not in master.columns:
            master["CASE_LABEL"] = master["IS_TRUE_POS"]
        if "FINAL_LABEL" not in master.columns:
            master["FINAL_LABEL"] = master["IS_TRUE_POS"]
        if "str_label" not in master.columns:
            master["str_label"] = master["FINAL_LABEL"]

        try:
            from api.tools.mlops.model_training_service import _enrich_aml_features

            master, _ = _enrich_aml_features(master, target_column="IS_TRUE_POS", grain="alert")
        except Exception:
            # Optional enrichment only; simulation must continue even if this import path changes.
            pass

        master["entity_type"] = np.where(master["CASE_ID"].notna(), "case", "alert")
        master["alert_id"] = master["ALERT_ID"].astype(str)
        master["case_id"] = master["CASE_ID"].fillna("").astype(str)
        master["entity_id"] = np.where(
            master["entity_type"].eq("case"),
            master["case_id"].replace("", np.nan).fillna(master["alert_id"]),
            master["alert_id"],
        )

        case_status_upper = master["CASE_STATUS"].astype(str).str.strip().str.upper()
        n_total = int(len(master))
        n_labelled = int(master["IS_TRUE_POS"].notna().sum())
        n_excluded = int(max(n_total - n_labelled, 0))
        n_positive = int((master["IS_TRUE_POS"] == 1).sum())
        n_negative = int((master["IS_TRUE_POS"] == 0).sum())
        label_summary = {
            "label_source": "CASE_STATUS",
            "strategy": "case_status_sar_filed",
            "n_total": n_total,
            "labelled_rows": n_labelled,
            "excluded_rows": n_excluded,
            "n_positive": n_positive,
            "n_negative": n_negative,
            "open_cases": int((case_status_upper == "OPEN").sum()),
            "no_case_assigned": int(master["CASE_STATUS"].isna().sum()),
            "str_rate_overall": round(n_positive / max(n_total, 1), 4),
            "str_rate_labelled": round(n_positive / max(n_labelled, 1), 4) if n_labelled else 0.0,
        }
        table_counts = {
            "customers": int(len(customers_df)),
            "accounts": int(len(accounts_df)),
            "transactions": int(len(transactions_df)),
            "alerts": int(len(alerts_df)),
            "cases": int(master["CASE_ID"].fillna("").astype(str).str.strip().replace({"nan": ""}).ne("").sum()),
            "master_rows": n_total,
        }
        return {
            "master_df": master.reset_index(drop=True),
            "transactions_df": transactions_df.reset_index(drop=True),
            "source_name": "synthetic_pipeline",
            "label_summary": label_summary,
            "table_counts": table_counts,
        }

    def _apply_simulation_scenario(
        self,
        df: pd.DataFrame,
        scenario: str,
        seed: int,
    ) -> Tuple[pd.DataFrame, Dict[str, Any]]:
        """Inject realistic shifts/noise for out-of-time production simulation."""
        rng = np.random.default_rng(seed)
        out = df.copy()
        scenario_name = str(scenario or "steady").strip().lower()

        num_cols = out.select_dtypes(include=[np.number]).columns.tolist()
        obj_cols = out.select_dtypes(exclude=[np.number]).columns.tolist()
        id_like = [c for c in out.columns if re.search(r"(?:^|_)(id|uuid)$", str(c).lower())]
        protected_numeric = {"is_true_pos", "actual_label"}
        protected_categorical = {"case_status"}
        num_mutable = [c for c in num_cols if c not in id_like and str(c).lower() not in protected_numeric]
        obj_mutable = [c for c in obj_cols if str(c).lower() not in protected_categorical]

        if scenario_name == "noisy":
            for c in num_mutable:
                vals = pd.to_numeric(out[c], errors="coerce")
                scale = float(vals.std() or 1.0)
                out[c] = vals + rng.normal(0.0, scale * 0.12, size=len(out))
            for c in obj_mutable:
                mask = rng.random(len(out)) < 0.04
                out.loc[mask, c] = "UNKNOWN"
        elif scenario_name == "drifted":
            for c in num_mutable:
                vals = pd.to_numeric(out[c], errors="coerce")
                shift = float((vals.mean() or 0.0) * 0.18)
                out[c] = vals + shift + rng.normal(0.0, float(vals.std() or 1.0) * 0.06, size=len(out))
            for c in obj_mutable:
                values = out[c].astype(str).fillna("UNKNOWN")
                top = values.value_counts().index.tolist()
                if len(top) >= 2:
                    mask = rng.random(len(out)) < 0.20
                    out.loc[mask, c] = top[1]
        elif scenario_name == "bad_data":
            for c in num_mutable:
                vals = pd.to_numeric(out[c], errors="coerce")
                mask_nan = rng.random(len(out)) < 0.18
                out.loc[mask_nan, c] = np.nan
                mask_spike = rng.random(len(out)) < 0.06
                out.loc[mask_spike, c] = vals.fillna(vals.median()) * rng.uniform(2.5, 6.0, size=mask_spike.sum())
            for c in obj_mutable:
                mask = rng.random(len(out)) < 0.10
                out.loc[mask, c] = ""
                mask2 = rng.random(len(out)) < 0.04
                out.loc[mask2, c] = "###BAD###"
        else:
            # steady: minimal natural production jitter
            for c in num_mutable:
                vals = pd.to_numeric(out[c], errors="coerce")
                out[c] = vals + rng.normal(0.0, float(vals.std() or 1.0) * 0.02, size=len(out))

        null_ratio = float(out.isna().mean().mean()) if len(out.columns) else 0.0
        quality = {
            "scenario": scenario_name,
            "null_ratio_pct": round(100.0 * null_ratio, 2),
            "numeric_columns_mutated": len(num_mutable),
            "categorical_columns_mutated": len(obj_mutable),
        }
        return out, quality

    def _estimate_event_loss(
        self,
        scores: np.ndarray,
        decisions: List[str],
        scenario: str,
        seed: int,
    ) -> Tuple[List[int], float]:
        """
        Estimate ground-truth labels for simulation so event-loss can be monitored.
        In production this should come from downstream case outcomes/SAR outcomes.
        """
        rng = np.random.default_rng(seed)
        scenario_name = str(scenario or "steady").lower()
        probs = np.clip(scores * 0.82 + 0.06, 0.01, 0.99)
        if scenario_name == "drifted":
            probs = np.clip(probs + 0.05, 0.01, 0.99)
        elif scenario_name == "bad_data":
            probs = np.clip(probs - 0.03, 0.01, 0.99)
        labels = rng.binomial(1, probs).astype(int).tolist()
        positives = max(int(np.sum(labels)), 1)
        missed = sum(1 for y, d in zip(labels, decisions) if y == 1 and d == "suppressed")
        event_loss_pct = round(100.0 * missed / positives, 2)
        return labels, event_loss_pct

    def _compute_batch_drift(self, deployment_id: str, current_scores: np.ndarray) -> Dict[str, Any]:
        """Compute simple score distribution drift against recent deployment history."""
        with self._conn() as conn:
            hist = conn.execute(
                """
                SELECT model_score
                FROM mlops_suppression_ledger
                WHERE deployment_id = ?
                  AND LOWER(COALESCE(source, '')) = 'production'
                ORDER BY scored_at DESC
                LIMIT 2000
                """,
                [deployment_id],
            ).fetchall()
        baseline = np.array([float(r[0]) for r in hist if r and r[0] is not None], dtype=float)
        current = np.asarray(current_scores, dtype=float)
        if baseline.size < 50 or current.size == 0:
            return {
                "psi": None,
                "score_mean_shift": None,
                "baseline_samples": int(baseline.size),
                "current_samples": int(current.size),
            }

        bins = np.linspace(0.0, 1.0, 11)
        base_hist = np.histogram(np.clip(baseline, 0, 1), bins=bins)[0].astype(float)
        curr_hist = np.histogram(np.clip(current, 0, 1), bins=bins)[0].astype(float)
        base_pct = base_hist / max(base_hist.sum(), 1.0)
        curr_pct = curr_hist / max(curr_hist.sum(), 1.0)
        eps = 1e-6
        psi = float(np.sum((curr_pct - base_pct) * np.log((curr_pct + eps) / (base_pct + eps))))
        return {
            "psi": round(psi, 4),
            "score_mean_shift": round(float(current.mean() - baseline.mean()), 4),
            "baseline_samples": int(baseline.size),
            "current_samples": int(current.size),
        }

    def _top_features(
        self,
        model,
        feature_columns: List[str],
        row: np.ndarray,
        n: int = 5,
    ) -> List[Dict]:
        """
        Approximate feature contributions using coefficient or feature_importances_.
        Returns top-N {feature, contribution} sorted descending by |contribution|.
        """
        try:
            if hasattr(model, "feature_importances_"):
                weights = model.feature_importances_
            elif hasattr(model, "coef_"):
                weights = np.abs(model.coef_[0])
            else:
                return []
            contributions = weights * np.abs(row)
            idx = np.argsort(contributions)[::-1][:n]
            return [
                {"feature": feature_columns[i], "contribution": round(float(contributions[i]), 6)}
                for i in idx
                if i < len(feature_columns)
            ]
        except Exception:
            return []

    def _shap_explain(
        self,
        model,
        X: pd.DataFrame,
        feature_columns: List[str],
        top_n: int = 8,
    ) -> Tuple[List[Dict[str, Any]], str]:
        """Return SHAP top features when available, otherwise proxy fallback."""
        try:
            import shap

            explainer = shap.Explainer(model, X)
            shap_values = explainer(X).values

            if isinstance(shap_values, list):
                values = np.asarray(shap_values[-1])[0]
            else:
                arr = np.asarray(shap_values)
                if arr.ndim == 3:
                    values = arr[0, :, -1]
                elif arr.ndim == 2:
                    values = arr[0]
                else:
                    values = arr.reshape(-1)

            idx = np.argsort(np.abs(values))[::-1][:top_n]
            rows = []
            for i in idx:
                if i < len(feature_columns):
                    rows.append({
                        "feature": str(feature_columns[i]),
                        "shap_value": round(float(values[i]), 6),
                    })
            return rows, "shap"
        except Exception:
            return [], "proxy"

    def _lime_explain(
        self,
        model,
        X_arr: np.ndarray,
        feature_columns: List[str],
        top_n: int = 8,
    ) -> Tuple[List[Dict[str, Any]], str]:
        """Return LIME top features when available, otherwise proxy fallback."""
        try:
            from lime.lime_tabular import LimeTabularExplainer

            baseline = np.vstack([X_arr, np.zeros_like(X_arr)])
            explainer = LimeTabularExplainer(
                training_data=baseline,
                feature_names=feature_columns,
                class_names=["Suppress", "Escalate"],
                mode="classification",
                discretize_continuous=True,
                random_state=42,
            )

            predict_fn = lambda arr: model.predict_proba(pd.DataFrame(arr, columns=feature_columns))
            exp = explainer.explain_instance(X_arr[0], predict_fn, num_features=min(top_n, len(feature_columns)))
            rows = [
                {"feature": str(name), "weight": round(float(weight), 6)}
                for name, weight in exp.as_list()
            ]
            return rows, "lime"
        except Exception:
            return [], "proxy"

    def inference_explain(
        self,
        run_id: str,
        record: Dict[str, Any],
        threshold: float = 0.5,
        top_n: int = 8,
    ) -> Dict:
        """
        Score a single record and provide explainability outputs.
        Uses SHAP/LIME when libraries are available; falls back to model-based proxy
        contribution otherwise.
        """
        bundle = self._load_bundle(run_id)
        model = bundle["model"]
        feature_columns: List[str] = bundle.get("feature_columns", [])

        if not feature_columns:
            raise ValueError("Model bundle missing feature_columns")

        df = pd.DataFrame([record or {}])
        X, coverage = self._build_feature_matrix(df, feature_columns)
        X_arr = X.values.astype(float)

        score = float(self._predict_scores(bundle, X)[0])
        decision = "escalated" if score >= float(threshold) else "suppressed"

        proxy = self._top_features(model, feature_columns, X_arr[0], n=max(top_n, 5))
        shap_rows, shap_method = self._shap_explain(model, X, feature_columns, top_n=top_n)
        lime_rows, lime_method = self._lime_explain(model, X_arr, feature_columns, top_n=top_n)

        if not shap_rows:
            shap_rows = [
                {"feature": row.get("feature"), "shap_value": round(float(row.get("contribution") or 0.0), 6)}
                for row in proxy[:top_n]
            ]
        if not lime_rows:
            lime_rows = [
                {"feature": row.get("feature"), "weight": round(float(row.get("contribution") or 0.0), 6)}
                for row in proxy[:top_n]
            ]

        return {
            "run_id": run_id,
            "threshold": float(threshold),
            "score": round(score, 6),
            "decision": decision,
            "feature_coverage": coverage,
            "proxy_top_features": proxy[:top_n],
            "shap": {
                "method": shap_method,
                "features": shap_rows,
            },
            "lime": {
                "method": lime_method,
                "features": lime_rows,
            },
        }

    # ── Public API ─────────────────────────────────────────────────────────────

    def score_batch(
        self,
        deployment_id: str,
        run_id: str,
        records: List[Dict],
        threshold: float = 0.5,
        entity_type: str = "alert",
    ) -> Dict:
        """
        Score a list of alert/case records through the deployed model.

        Parameters
        ----------
        deployment_id : str
        run_id        : str        — model run whose artifact to use
        records       : list[dict] — each dict must have an 'entity_id' key
                                     plus all feature columns
        threshold     : float      — decision threshold
        entity_type   : 'alert' | 'case'

        Returns
        -------
        {
          batch_id, scored_at, total, suppressed, escalated,
          suppression_rate, ledger: [...]
        }
        """
        bundle = self._load_bundle(run_id)
        model = bundle["model"]
        feature_columns: List[str] = bundle.get("feature_columns", [])

        if not feature_columns:
            raise ValueError("Model bundle missing feature_columns")

        df = pd.DataFrame(records)
        if df.empty:
            raise ValueError("No records provided for scoring")

        requested_entity_type = self._normalize_grain(entity_type)
        model_grain = self._resolve_model_grain(run_id=run_id, default=requested_entity_type)

        # Enforce run grain: case-grain models only score case entities; alert-grain only alert entities.
        df["entity_type"] = model_grain
        entity_types, entity_ids = self._infer_entity_ids(df, default_entity_type=model_grain)
        X, coverage = self._build_feature_matrix(df, feature_columns)
        X_arr = X.values.astype(float)

        scores = self._predict_scores(bundle, X)
        decisions = ["escalated" if float(s) >= float(threshold) else "suppressed" for s in scores]

        persisted = self._persist_scored_rows(
            model=model,
            deployment_id=deployment_id,
            run_id=run_id,
            entity_types=entity_types,
            entity_ids=entity_ids,
            scores=scores,
            decisions=decisions,
            threshold=float(threshold),
            feature_columns=feature_columns,
            X_arr=X_arr,
            batch_id=str(uuid.uuid4()),
            actual_labels=None,
            source="production",
        )
        scored_records = self._build_scored_batch_records(
            records=records,
            persisted_rows=persisted["ledger_rows"],
            run_id=run_id,
            deployment_id=deployment_id,
            feature_coverage=coverage,
        )
        self._persist_scored_batch_package(
            batch_id=str(persisted["batch_id"]),
            run_id=run_id,
            deployment_id=deployment_id,
            model_grain=model_grain,
            threshold=float(threshold),
            persisted=persisted,
            scored_records=scored_records,
            feature_coverage=coverage,
        )

        return {
            "batch_id": persisted["batch_id"],
            "scored_at": persisted["scored_at"],
            "total": persisted["total"],
            "suppressed": persisted["suppressed"],
            "escalated": persisted["escalated"],
            "suppression_rate": persisted["suppression_rate"],
            "entity_type": model_grain,
            "model_grain": model_grain,
            "requested_entity_type": requested_entity_type,
            "threshold": float(threshold),
            "feature_coverage": coverage,
            "ledger": persisted["ledger_rows"],
        }

    def simulate_live_pipeline(
        self,
        deployment_id: str,
        run_id: str,
        threshold: float = 0.5,
        scenario: str = "steady",
        batch_size: int = 200,
        compare_run_ids: Optional[List[str]] = None,
        seed: Optional[int] = None,
        simulation_mode: str = "synthetic_pipeline",
        auto_optimize_threshold: Optional[bool] = None,
        max_event_loss_pct: float = 5.0,
        persist_to_ledger: bool = False,
        pipeline_id: Optional[str] = None,
        pipeline_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Simulate production-style scoring on unseen / out-of-time data.

        Flow:
          source ingestion -> transform alignment -> model scoring -> investigator queue
        """
        sim_seed = int(seed if seed is not None else int(datetime.utcnow().timestamp()) % 10_000_000)
        scenario_name = str(scenario or "steady").strip().lower()
        if scenario_name not in {"steady", "noisy", "drifted", "bad_data"}:
            scenario_name = "steady"

        sim_mode = str(simulation_mode or "synthetic_pipeline").strip().lower()
        if sim_mode in {"pipeline", "full_pipeline", "synthetic_pipeline"}:
            generated = self._generate_synthetic_pipeline_batch(
                batch_size=max(int(batch_size), 16),
                seed=sim_seed,
            )
            source_df = generated["transactions_df"]
            source_name = generated.get("source_name") or "synthetic_pipeline"
            batch_df = generated["master_df"].copy()
            base_label_summary = generated.get("label_summary") or {}
            table_counts = generated.get("table_counts") or {}
            sim_mode = "synthetic_pipeline"
        else:
            source_df, source_name = self._load_source_batch(
                batch_size=max(int(batch_size), 16),
                seed=sim_seed,
            )
            batch_df = source_df.copy()
            base_label_summary = {}
            table_counts = {}
            sim_mode = "source_batch"
        # Downstream deployment monitoring must honor the locked release threshold.
        # Threshold experimentation belongs in validation / release governance, not
        # inside live FCC scoring or Sentinel handoff flows.
        optimize_threshold = False

        # Scenario jitter should not corrupt label provenance columns.
        protected_cols: Dict[str, pd.Series] = {}
        for protected in ("IS_TRUE_POS", "CASE_STATUS", "alert_id", "case_id", "entity_id", "entity_type", "ALERT_ID", "CASE_ID"):
            if protected in batch_df.columns:
                protected_cols[protected] = batch_df[protected].copy()
        batch_df, quality = self._apply_simulation_scenario(batch_df, scenario_name, seed=sim_seed + 11)
        for protected, values in protected_cols.items():
            batch_df[protected] = values
        batch_df = batch_df.reset_index(drop=True)

        if "entity_type" not in batch_df.columns:
            rng = np.random.default_rng(sim_seed + 29)
            batch_df["entity_type"] = np.where(rng.random(len(batch_df)) < 0.20, "case", "alert")
        else:
            batch_df["entity_type"] = batch_df["entity_type"].astype(str).str.lower().replace({"": "alert"})

        if "alert_id" not in batch_df.columns and "ALERT_ID" in batch_df.columns:
            batch_df["alert_id"] = batch_df["ALERT_ID"].astype(str)
        if "case_id" not in batch_df.columns and "CASE_ID" in batch_df.columns:
            batch_df["case_id"] = batch_df["CASE_ID"].fillna("").astype(str)
        if "alert_id" not in batch_df.columns:
            batch_df["alert_id"] = [f"ALT-{i + 1:06d}" for i in range(len(batch_df))]
        if "case_id" not in batch_df.columns:
            batch_df["case_id"] = [f"CSE-{(i // 3) + 1:06d}" for i in range(len(batch_df))]
        if "entity_id" not in batch_df.columns:
            batch_df["entity_id"] = np.where(
                batch_df["entity_type"].astype(str).str.lower().eq("case"),
                batch_df["case_id"].astype(str),
                batch_df["alert_id"].astype(str),
            )

        bundle = self._load_bundle(run_id)
        model = bundle["model"]
        model_grain = self._resolve_model_grain(run_id=run_id, run_meta=bundle, default="alert")
        feature_columns: List[str] = bundle.get("feature_columns", [])
        if not feature_columns:
            raise ValueError("Model bundle missing feature_columns")
        leakage_features = self._detect_label_leakage_features(feature_columns)
        threshold_requested = float(threshold)
        threshold_applied = float(threshold)
        threshold_optimization: Optional[Dict[str, Any]] = None
        threshold_optimization_skipped_reason: Optional[str] = None

        if sim_mode == "synthetic_pipeline":
            seeded_demo = self._build_seeded_demo_batch(
                bundle=bundle,
                model_grain=model_grain,
                threshold=float(threshold_requested),
                scenario=scenario_name,
                batch_size=max(int(batch_size), 16),
                seed=sim_seed + 23,
            )
            if seeded_demo:
                batch_df = seeded_demo["batch_df"].copy()
                base_label_summary = seeded_demo.get("label_summary") or base_label_summary
                source_name = str(seeded_demo.get("source_name") or source_name)

        # Enforce scoring scope by model grain.
        if model_grain == "case":
            case_col = "case_id" if "case_id" in batch_df.columns else ("CASE_ID" if "CASE_ID" in batch_df.columns else None)
            if case_col is not None:
                case_series = batch_df[case_col].astype(str).str.strip()
                batch_df = batch_df[case_series.ne("") & case_series.str.lower().ne("nan")].copy()
            if batch_df.empty:
                raise ValueError("Case-grain model selected but no case-level entities found in simulation batch")
            if "case_id" not in batch_df.columns:
                batch_df["case_id"] = (
                    batch_df.get("CASE_ID")
                    if "CASE_ID" in batch_df.columns
                    else [f"CSE-{i + 1:06d}" for i in range(len(batch_df))]
                )
            batch_df["case_id"] = batch_df["case_id"].astype(str).str.strip()
            batch_df["entity_type"] = "case"
            batch_df["entity_id"] = batch_df["case_id"]
            batch_df = batch_df.drop_duplicates(subset=["entity_id"]).reset_index(drop=True)
        else:
            if "alert_id" not in batch_df.columns:
                batch_df["alert_id"] = (
                    batch_df.get("ALERT_ID")
                    if "ALERT_ID" in batch_df.columns
                    else [f"ALT-{i + 1:06d}" for i in range(len(batch_df))]
                )
            batch_df["alert_id"] = batch_df["alert_id"].astype(str).str.strip()
            batch_df = batch_df[batch_df["alert_id"].ne("") & batch_df["alert_id"].str.lower().ne("nan")].copy()
            if batch_df.empty:
                raise ValueError("Alert-grain model selected but no alert-level entities found in simulation batch")
            batch_df["entity_type"] = "alert"
            batch_df["entity_id"] = batch_df["alert_id"]
            batch_df = batch_df.drop_duplicates(subset=["entity_id"]).reset_index(drop=True)

        X_main, coverage = self._build_feature_matrix(batch_df, feature_columns)
        X_main_arr = X_main.values.astype(float)
        scores = self._predict_scores(bundle, X_main)
        entity_types, entity_ids = self._infer_entity_ids(batch_df, default_entity_type=model_grain)
        score_min = float(np.min(scores)) if len(scores) else 0.0
        score_max = float(np.max(scores)) if len(scores) else 0.0
        score_std = float(np.std(scores)) if len(scores) else 0.0
        unique_score_count = int(np.unique(np.round(scores, 8)).size) if len(scores) else 0
        constant_scores = bool(unique_score_count <= 1 or score_std <= 1e-9)

        resolved_labels, label_basis, label_column = self._resolve_live_labels(
            batch_df=batch_df,
            bundle=bundle,
            model_grain=model_grain,
        )

        if resolved_labels:
            actual_labels: List[Optional[int]] = list(resolved_labels)

            if optimize_threshold:
                if leakage_features:
                    threshold_optimization_skipped_reason = "label_leakage_features_present"
                elif constant_scores:
                    threshold_optimization_skipped_reason = "constant_scores_on_unseen_batch"
                else:
                    threshold_optimization = self._optimize_threshold_with_event_loss_cap(
                        scores=scores,
                        labels=actual_labels,
                        max_event_loss_pct=float(max_event_loss_pct),
                    )
                    if threshold_optimization:
                        threshold_applied = float(
                            threshold_optimization.get("recommended_threshold", threshold_requested)
                        )
        else:
            threshold_applied = float(threshold_requested)
            decisions = [
                "escalated" if float(s) >= float(threshold_applied) else "suppressed"
                for s in scores
            ]
            synthetic_labels, _ = self._estimate_event_loss(
                scores=scores,
                decisions=decisions,
                scenario=scenario_name,
                seed=sim_seed + 31,
            )
            actual_labels = [int(v) for v in synthetic_labels]
            label_basis = "estimated_labels"

        decisions = [
            "escalated" if float(s) >= float(threshold_applied) else "suppressed"
            for s in scores
        ]
        event_loss_pct, label_eval = self._event_loss_from_known_labels(actual_labels, decisions)
        oot_validation = self._compute_oot_validation(
            scores=scores,
            labels=actual_labels,
            threshold=float(threshold_applied),
        )
        if oot_validation.get("defined") and oot_validation.get("event_loss_pct") is not None:
            event_loss_pct = float(oot_validation["event_loss_pct"])

        label_summary = dict(base_label_summary or {})
        label_summary.update(
            {
                "label_column": label_column,
                "evaluation_labelled_rows": int(label_eval.get("labelled_rows", 0)),
                "evaluation_positive_rows": int(label_eval.get("positive_rows", 0)),
                "evaluation_negative_rows": int(label_eval.get("negative_rows", 0)),
                "evaluation_missed_positive_rows": int(label_eval.get("missed_positive_rows", 0)),
                "evaluation_captured_positive_rows": int(label_eval.get("captured_positive_rows", 0)),
                "evaluation_event_loss_defined": bool(label_eval.get("event_loss_defined", False)),
                "event_loss_basis": label_basis,
                "threshold_requested": float(threshold_requested),
                "threshold_applied": float(threshold_applied),
                "threshold_auto_optimized": bool(
                    threshold_optimization is not None and optimize_threshold
                ),
                "threshold_optimization_skipped_reason": threshold_optimization_skipped_reason or "deployment_threshold_locked",
                "model_grain": model_grain,
                "mode": sim_mode,
                "persisted_to_ledger": bool(persist_to_ledger),
            }
        )

        drift_snapshot = self._compute_batch_drift(deployment_id=deployment_id, current_scores=scores)
        if persist_to_ledger:
            persisted = self._persist_scored_rows(
                model=model,
                deployment_id=deployment_id,
                run_id=run_id,
                entity_types=entity_types,
                entity_ids=entity_ids,
                scores=scores,
                decisions=decisions,
                threshold=float(threshold_applied),
                feature_columns=feature_columns,
                X_arr=X_main_arr,
                batch_id=str(uuid.uuid4()),
                actual_labels=actual_labels,
                source="simulation",
            )
        else:
            scored_at = datetime.utcnow().isoformat()
            suppressed_count = int(sum(1 for d in decisions if d == "suppressed"))
            total_count = int(len(decisions))
            escalated_count = int(total_count - suppressed_count)
            preview_rows: List[Dict[str, Any]] = []
            for i, (etype, eid, score, decision) in enumerate(
                zip(entity_types, entity_ids, scores, decisions)
            ):
                reason = _reason_code(float(score), float(threshold_applied))
                preview_rows.append(
                    {
                        "record_id": None,
                        "entity_id": str(eid),
                        "entity_type": str(etype),
                        "model_score": round(float(score), 6),
                        "decision": str(decision),
                        "threshold": float(threshold_applied),
                        "reason_code": reason,
                        "top_features": self._top_features(
                            model=model,
                            feature_columns=feature_columns,
                            row=X_main_arr[i],
                        ),
                        "actual_label": None if actual_labels[i] is None else int(actual_labels[i]),
                        "scored_at": scored_at,
                        "source": "simulation",
                    }
                )
            persisted = {
                "batch_id": str(uuid.uuid4()),
                "scored_at": scored_at,
                "total": total_count,
                "suppressed": suppressed_count,
                "escalated": escalated_count,
                "suppression_rate": round(100.0 * suppressed_count / max(total_count, 1), 2),
                "ledger_rows": preview_rows,
            }

        suppression_rate = persisted["suppression_rate"]
        reason_codes = [str(row.get("reason_code") or "") for row in persisted["ledger_rows"]]

        health_flags: List[str] = []
        health_messages: List[str] = []
        matched_ratio = float(coverage.get("matched_feature_ratio") or 0.0)
        positive_rows = int(label_eval.get("positive_rows", 0))
        if leakage_features:
            health_flags.append("label_leakage_features_present")
            health_messages.append(
                "The selected model depends on label-like features that are not trustworthy at prediction time."
            )
        if constant_scores:
            health_flags.append("constant_scores_on_unseen_batch")
            health_messages.append(
                "The model returned the same score for the entire unseen batch, so threshold optimization and downstream triage are not meaningful."
            )
        if matched_ratio < 0.75:
            health_flags.append("low_feature_coverage")
            health_messages.append(
                f"Only {matched_ratio * 100:.1f}% of expected model features were matched from the unseen batch."
            )
        if positive_rows < 5:
            health_flags.append("limited_known_positive_labels")
            health_messages.append(
                "Only a small number of known positive outcomes were available in the unseen batch, so validation metrics may be noisy."
            )
        if int(persisted["escalated"]) == 0:
            health_flags.append("no_retained_cases_for_sentinel")
            health_messages.append(
                "No alerts were retained for Sentinel in this run, so the downstream case-manager handoff is empty."
            )
        health_status = (
            "error"
            if any(flag in {"label_leakage_features_present", "constant_scores_on_unseen_batch"} for flag in health_flags)
            else ("warning" if health_flags else "healthy")
        )

        if persist_to_ledger:
            scored_records = self._build_scored_batch_records(
                records=batch_df.to_dict(orient="records"),
                persisted_rows=persisted["ledger_rows"],
                run_id=run_id,
                deployment_id=deployment_id,
                feature_coverage=coverage,
            )
            self._persist_scored_batch_package(
                batch_id=str(persisted["batch_id"]),
                run_id=run_id,
                deployment_id=deployment_id,
                model_grain=model_grain,
                threshold=float(threshold_applied),
                persisted=persisted,
                scored_records=scored_records,
                feature_coverage=coverage,
                pipeline_id=pipeline_id,
                pipeline_name=pipeline_name,
            )

        alert_total = sum(1 for t in entity_types if t == "alert")
        case_total = sum(1 for t in entity_types if t == "case")
        alert_suppressed = sum(
            1 for t, d in zip(entity_types, decisions) if t == "alert" and d == "suppressed"
        )
        case_suppressed = sum(
            1 for t, d in zip(entity_types, decisions) if t == "case" and d == "suppressed"
        )

        compare_ids = []
        for rid in compare_run_ids or []:
            rid_s = str(rid or "").strip()
            if rid_s and rid_s != run_id and rid_s not in compare_ids:
                compare_ids.append(rid_s)
        compare_ids = compare_ids[:4]

        comparison = [
            {
                "run_id": run_id,
                "is_primary": True,
                "threshold": float(threshold_applied),
                "avg_score": round(float(np.mean(scores)) if len(scores) else 0.0, 6),
                "suppression_rate": round(float(suppression_rate), 2),
                "event_loss_pct": None if event_loss_pct is None else float(event_loss_pct),
            }
        ]
        for cmp_run in compare_ids:
            try:
                cmp_bundle = self._load_bundle(cmp_run)
                cmp_model = cmp_bundle["model"]
                cmp_features: List[str] = cmp_bundle.get("feature_columns", [])
                if not cmp_features:
                    raise ValueError("model bundle missing feature_columns")
                X_cmp, _ = self._build_feature_matrix(batch_df, cmp_features)
                cmp_scores = self._predict_scores(cmp_bundle, X_cmp)
                cmp_decisions = [
                    "escalated" if float(s) >= float(threshold_applied) else "suppressed"
                    for s in cmp_scores
                ]
                cmp_event_loss, _ = self._event_loss_from_known_labels(actual_labels, cmp_decisions)
                cmp_supp = sum(1 for d in cmp_decisions if d == "suppressed")
                comparison.append(
                    {
                        "run_id": cmp_run,
                        "is_primary": False,
                        "threshold": float(threshold_applied),
                        "avg_score": round(float(np.mean(cmp_scores)) if len(cmp_scores) else 0.0, 6),
                        "suppression_rate": round(100.0 * cmp_supp / max(len(cmp_scores), 1), 2),
                        "event_loss_pct": None if cmp_event_loss is None else float(cmp_event_loss),
                    }
                )
            except Exception as exc:
                comparison.append(
                    {
                        "run_id": cmp_run,
                        "is_primary": False,
                        "error": str(exc),
                    }
                )

        investigator_queue: List[Dict[str, Any]] = []
        for i, row in enumerate(persisted["ledger_rows"]):
            raw = batch_df.iloc[i]
            investigator_queue.append(
                {
                    "entity_id": row["entity_id"],
                    "entity_type": row["entity_type"],
                    "alert_id": str(raw.get("alert_id") or "") if row["entity_type"] == "alert" else str(raw.get("alert_id") or ""),
                    "case_id": str(raw.get("case_id") or "") if row["entity_type"] == "case" else str(raw.get("case_id") or ""),
                    "model_run_id": run_id,
                    "threshold": float(threshold_applied),
                    "score": row["model_score"],
                    "decision": row["decision"],
                    "reason": row["reason_code"],
                    "top_drivers": row.get("top_features") or [],
                    "scored_at": row["scored_at"],
                }
            )

        scored_preview_df = batch_df.copy()
        scored_preview_df["model_score"] = [round(float(s), 6) for s in scores]
        scored_preview_df["decision"] = decisions
        scored_preview_df["threshold"] = float(threshold_applied)
        scored_preview_df["actual_label"] = [None if v is None else int(v) for v in actual_labels]
        scored_preview_df["reason_code"] = reason_codes
        scored_preview_df["queue_target"] = np.where(
            scored_preview_df["decision"].astype(str).str.lower().eq("escalated"),
            "sentinel_case_manager",
            "suppressed_in_fcc",
        )
        master_data_preview = self._preview_rows(
            batch_df,
            [
                "entity_id",
                "CUSTOMER_ID",
                "ACCOUNT_ID",
                "ALERT_ID",
                "CASE_ID",
                "RULE_TRIGGERED",
                "RISK_SCORE",
                "TXN_AMOUNT",
                "BENEFICIARY_COUNTRY",
                "CHANNEL",
                "CASE_STATUS",
                "IS_TRUE_POS",
            ],
            limit=30,
        )
        prepared_feature_columns = [col for col in feature_columns if col in X_main.columns][:10]
        prepared_preview_df = pd.concat(
            [
                batch_df[[col for col in ["entity_id", "alert_id", "case_id"] if col in batch_df.columns]].reset_index(drop=True),
                X_main.loc[:, prepared_feature_columns].reset_index(drop=True),
            ],
            axis=1,
        )
        prepared_feature_preview = self._preview_rows(
            prepared_preview_df,
            list(prepared_preview_df.columns),
            limit=30,
        )
        unseen_input_preview = self._preview_rows(
            batch_df,
            [
                "entity_id",
                "alert_id",
                "case_id",
                "RULE_TRIGGERED",
                "RISK_SCORE",
                "TXN_AMOUNT",
                "BENEFICIARY_COUNTRY",
                "CHANNEL",
                "CASE_STATUS",
                "IS_TRUE_POS",
            ],
            limit=30,
        )
        prediction_output_preview = self._preview_rows(
            scored_preview_df,
            [
                "entity_id",
                "alert_id",
                "case_id",
                "RISK_SCORE",
                "TXN_AMOUNT",
                "CASE_STATUS",
                "actual_label",
                "model_score",
                "threshold",
                "decision",
                "reason_code",
                "queue_target",
            ],
            limit=40,
        )
        retained_queue_preview = self._preview_rows(
            scored_preview_df.loc[scored_preview_df["decision"].astype(str).str.lower().eq("escalated")].reset_index(drop=True),
            [
                "entity_id",
                "alert_id",
                "case_id",
                "RISK_SCORE",
                "TXN_AMOUNT",
                "model_score",
                "threshold",
                "decision",
                "reason_code",
                "queue_target",
            ],
            limit=30,
        )
        suppressed_queue_preview = self._preview_rows(
            scored_preview_df.loc[scored_preview_df["decision"].astype(str).str.lower().eq("suppressed")].reset_index(drop=True),
            [
                "entity_id",
                "alert_id",
                "case_id",
                "RISK_SCORE",
                "TXN_AMOUNT",
                "model_score",
                "threshold",
                "decision",
                "reason_code",
            ],
            limit=30,
        )

        flow_stream: List[Dict[str, Any]] = []
        stream_chunk = int(max(80, min(500, len(scores) // 8 if len(scores) > 0 else 80)))
        cum_ingested = 0
        cum_transformed = 0
        cum_predicted = 0
        cum_escalated = 0
        cum_suppressed = 0
        cum_pos = 0
        cum_missed = 0
        for t_idx, start_idx in enumerate(range(0, len(scores), stream_chunk), start=1):
            end_idx = min(start_idx + stream_chunk, len(scores))
            chunk_scores = scores[start_idx:end_idx]
            chunk_decisions = decisions[start_idx:end_idx]
            chunk_labels = actual_labels[start_idx:end_idx]

            chunk_total = int(end_idx - start_idx)
            chunk_suppressed = int(sum(1 for d in chunk_decisions if d == "suppressed"))
            chunk_escalated = int(chunk_total - chunk_suppressed)
            chunk_known_pos = 0
            chunk_missed = 0
            for y, d in zip(chunk_labels, chunk_decisions):
                if y is None:
                    continue
                try:
                    yi = int(y)
                except Exception:
                    continue
                if yi != 1:
                    continue
                chunk_known_pos += 1
                if str(d).lower() == "suppressed":
                    chunk_missed += 1

            cum_ingested += chunk_total
            cum_transformed += chunk_total
            cum_predicted += chunk_total
            cum_escalated += chunk_escalated
            cum_suppressed += chunk_suppressed
            cum_pos += chunk_known_pos
            cum_missed += chunk_missed

            flow_stream.append(
                {
                    "tick": int(t_idx),
                    "batch_label": f"T+{t_idx}",
                    "ingested": chunk_total,
                    "transformed": chunk_total,
                    "predicted": chunk_total,
                    "escalated": chunk_escalated,
                    "suppressed": chunk_suppressed,
                    "avg_score": round(float(np.mean(chunk_scores)) if len(chunk_scores) else 0.0, 6),
                    "event_loss_pct": round(100.0 * chunk_missed / max(chunk_known_pos, 1), 2)
                    if chunk_known_pos > 0
                    else None,
                    "known_positive_rows": int(chunk_known_pos),
                    "cumulative_ingested": int(cum_ingested),
                    "cumulative_transformed": int(cum_transformed),
                    "cumulative_predicted": int(cum_predicted),
                    "cumulative_escalated": int(cum_escalated),
                    "cumulative_suppressed": int(cum_suppressed),
                    "cumulative_event_loss_pct": round(100.0 * cum_missed / max(cum_pos, 1), 2) if cum_pos > 0 else None,
                }
            )

        if persist_to_ledger:
            try:
                with self._conn() as conn:
                    conn.execute(
                        """
                        INSERT INTO mlops_drift_log
                          (drift_id, deployment_id, computed_at, window_label,
                           suppression_rate, event_loss_pct, alert_count, case_count, psi)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        [
                            str(uuid.uuid4()),
                            deployment_id,
                            datetime.utcnow(),
                            datetime.utcnow().strftime("%Y-W%W"),
                            float(suppression_rate),
                            float(event_loss_pct) if event_loss_pct is not None else None,
                            int(alert_total),
                            int(case_total),
                            drift_snapshot.get("psi"),
                        ],
                    )
            except Exception:
                # Non-fatal telemetry write.
                pass

        if sim_mode == "synthetic_pipeline":
            stage_rows = [
                {
                    "stage": "Synthetic Generation",
                    "status": "done",
                    "detail": (
                        f"{table_counts.get('customers', 0):,} customers | "
                        f"{table_counts.get('accounts', 0):,} accounts | "
                        f"{table_counts.get('transactions', 0):,} transactions"
                    ),
                },
                {
                    "stage": "Master Build",
                    "status": "done",
                    "detail": (
                        f"{table_counts.get('alerts', 0):,} alerts joined with "
                        f"{table_counts.get('cases', 0):,} cases -> "
                        f"{table_counts.get('master_rows', len(batch_df)):,} master rows"
                    ),
                },
                {
                    "stage": "Target Derivation",
                    "status": "done",
                    "detail": (
                        f"{int(label_summary.get('labelled_rows', 0)):,} labelled | "
                        f"{int(label_summary.get('excluded_rows', 0)):,} excluded "
                        f"(OPEN/no-case)"
                    ),
                },
                {
                    "stage": "Preprocessing",
                    "status": "done",
                    "detail": f"{len(feature_columns):,} model features aligned",
                },
                {
                    "stage": "Scoring",
                    "status": "done",
                    "detail": (
                        f"{persisted['total']:,} {model_grain} entities scored @ threshold {float(threshold_applied):.2f}"
                        + (" (auto-optimized)" if threshold_applied != threshold_requested else "")
                        + ("" if persist_to_ledger else " (simulation only; not written to ledger)")
                    ),
                },
                {
                    "stage": "Investigator Queue",
                    "status": "done",
                    "detail": f"{persisted['escalated']:,} escalated / {persisted['suppressed']:,} suppressed",
                },
            ]
        else:
            stage_rows = [
                {"stage": "Ingestion", "status": "done", "detail": f"{len(source_df):,} rows pulled from {source_name}"},
                {"stage": "Transformation", "status": "done", "detail": f"{len(feature_columns):,} model features aligned"},
                {
                    "stage": "Scoring",
                    "status": "done",
                    "detail": (
                        f"{persisted['total']:,} {model_grain} entities scored @ threshold {float(threshold_applied):.2f}"
                        + (" (auto-optimized)" if threshold_applied != threshold_requested else "")
                        + ("" if persist_to_ledger else " (simulation only; not written to ledger)")
                    ),
                },
                {"stage": "Investigator Queue", "status": "done", "detail": f"{persisted['escalated']:,} escalated / {persisted['suppressed']:,} suppressed"},
            ]

        return {
            "simulation_id": str(uuid.uuid4()),
            "simulation_mode": sim_mode,
            "model_grain": model_grain,
            "scenario": scenario_name,
            "seed": sim_seed,
            "pipeline_id": str(pipeline_id) if pipeline_id not in (None, "") else None,
            "pipeline_name": str(pipeline_name) if pipeline_name not in (None, "") else None,
            "persisted_to_ledger": bool(persist_to_ledger),
            "source": {
                "dataset": source_name,
                "rows_received": int(len(source_df)),
                "rows_scored": int(len(batch_df)),
                "quality": quality,
            },
            "transform": {
                "input_columns": int(batch_df.shape[1]),
                "output_features": int(len(feature_columns)),
                "feature_coverage": coverage,
            },
            "scoring": {
                "batch_id": str(persisted["batch_id"]),
                "run_id": run_id,
                "threshold": float(threshold_applied),
                "threshold_requested": float(threshold_requested),
                "threshold_applied": float(threshold_applied),
                "threshold_auto_optimized": bool(
                    threshold_optimization is not None and optimize_threshold
                ),
                "model_grain": model_grain,
                "total": int(persisted["total"]),
                "suppressed": int(persisted["suppressed"]),
                "escalated": int(persisted["escalated"]),
                "suppression_rate": float(suppression_rate),
                "event_loss_pct": None if event_loss_pct is None else float(event_loss_pct),
                "oot_known_rows": int(oot_validation.get("known_rows", 0)),
                "oot_known_positive_rows": int(oot_validation.get("known_positive_rows", 0)),
                "oot_known_negative_rows": int(oot_validation.get("known_negative_rows", 0)),
                "oot_roc_auc": oot_validation.get("roc_auc"),
                "oot_pr_auc": oot_validation.get("pr_auc"),
                "oot_precision": oot_validation.get("precision"),
                "oot_recall": oot_validation.get("recall"),
                "oot_f1": oot_validation.get("f1"),
                "avg_score": round(float(np.mean(scores)) if len(scores) else 0.0, 6),
                "score_min": round(float(score_min), 6),
                "score_max": round(float(score_max), 6),
                "score_std": round(float(score_std), 6),
                "unique_score_count": int(unique_score_count),
                "alert_total": int(alert_total),
                "case_total": int(case_total),
                "alert_suppressed": int(alert_suppressed),
                "case_suppressed": int(case_suppressed),
                "persisted_to_ledger": bool(persist_to_ledger),
                "quality_flags": health_flags,
                "leakage_features": leakage_features,
            },
            "label_summary": label_summary,
            "oot_validation": oot_validation,
            "threshold_optimization": threshold_optimization,
            "drift_snapshot": drift_snapshot,
            "comparison": comparison,
            "flow_stream": flow_stream,
            "investigator_queue": investigator_queue[:150],
            "ledger_preview": persisted["ledger_rows"][:60],
            "simulation_health": {
                "status": health_status,
                "flags": health_flags,
                "messages": health_messages,
                "leakage_features": leakage_features,
                "matched_feature_ratio": matched_ratio,
                "score_min": round(float(score_min), 6),
                "score_max": round(float(score_max), 6),
                "score_std": round(float(score_std), 6),
                "unique_score_count": int(unique_score_count),
                "retained_rows": int(persisted["escalated"]),
                "suppressed_rows": int(persisted["suppressed"]),
            },
            "preview_tables": {
                "master_data": master_data_preview,
                "prepared_features": prepared_feature_preview,
                "unseen_input": unseen_input_preview,
                "prediction_output": prediction_output_preview,
                "retained_queue": retained_queue_preview,
                "suppressed_queue": suppressed_queue_preview,
            },
            "pipeline_stages": stage_rows,
        }

    def suppression_ledger(
        self,
        deployment_id: str,
        run_id: Optional[str] = None,
        entity_type: Optional[str] = None,
        decision: Optional[str] = None,
        include_simulation: bool = True,
        limit: int = 500,
        offset: int = 0,
    ) -> Dict:
        """
        Query the suppression ledger with optional filters.

        Returns
        -------
        { total_count, rows: [...] }
        """
        clauses = ["deployment_id = ?"]
        params: List[Any] = [deployment_id]

        if run_id:
            clauses.append("run_id = ?")
            params.append(str(run_id))

        if entity_type:
            clauses.append("entity_type = ?")
            params.append(entity_type)
        if decision:
            clauses.append("decision = ?")
            params.append(decision)
        if not include_simulation:
            clauses.append("LOWER(COALESCE(source, '')) = 'production'")

        where = " AND ".join(clauses)

        with self._conn() as conn:
            total = conn.execute(
                f"SELECT COUNT(*) FROM mlops_suppression_ledger WHERE {where}",
                params,
            ).fetchone()[0]

            rows = conn.execute(
                f"""
                SELECT record_id, entity_id, entity_type, model_score,
                       decision, threshold, reason_code, top_features,
                       scored_at, actual_label, reviewer, COALESCE(source, 'legacy') AS source
                FROM mlops_suppression_ledger
                WHERE {where}
                ORDER BY scored_at DESC
                LIMIT ? OFFSET ?
                """,
                params + [limit, offset],
            ).fetchall()

        return {
            "total_count": int(total),
            "rows": [
                {
                    "record_id": r[0],
                    "entity_id": r[1],
                    "entity_type": r[2],
                    "model_score": round(float(r[3] or 0), 4),
                    "decision": r[4],
                    "threshold": float(r[5] or 0),
                    "reason_code": r[6],
                    "top_features": json.loads(r[7] or "[]"),
                    "scored_at": r[8].isoformat() if hasattr(r[8], "isoformat") else str(r[8]),
                    "actual_label": r[9],
                    "reviewer": r[10],
                    "source": r[11],
                }
                for r in rows
            ],
        }

    def drift_stats(
        self,
        deployment_id: str,
        n_weeks: int = 8,
        run_id: Optional[str] = None,
        model_grain: Optional[str] = None,
        include_simulation: bool = False,
    ) -> Dict:
        """
        Return week-over-week suppression rate and event-loss trend.

        Computes directly from ledger rows. No synthetic fallback values.

        Returns
        -------
        {
          windows: [{ week, suppression_rate, event_loss_pct,
                      alert_count, case_count, psi }],
          current_suppression_rate,
          suppression_drift_pct,   -- change from first to last window
          alert_vs_case: { alert_suppression, case_suppression }
        }
        """
        resolved_grain: Optional[str] = None
        if model_grain:
            resolved_grain = self._normalize_grain(model_grain)
        elif run_id:
            resolved_grain = self._resolve_model_grain(run_id=run_id, default="alert")

        where_clauses = ["deployment_id = ?"]
        params: List[Any] = [deployment_id]
        if run_id:
            where_clauses.append("run_id = ?")
            params.append(str(run_id))
        if resolved_grain in {"alert", "case"}:
            where_clauses.append("entity_type = ?")
            params.append(resolved_grain)
        if not include_simulation:
            where_clauses.append("LOWER(COALESCE(source, '')) = 'production'")
        where_sql = " AND ".join(where_clauses)

        with self._conn() as conn:
            rows = conn.execute(
                f"""
                SELECT
                    strftime(scored_at, '%Y-W%W')  AS week,
                    entity_type,
                    COUNT(*) AS total,
                    SUM(CASE WHEN decision = 'suppressed' THEN 1 ELSE 0 END) AS suppressed,
                    SUM(CASE WHEN actual_label = 1 THEN 1 ELSE 0 END) AS positives,
                    SUM(CASE WHEN actual_label = 1 AND decision = 'suppressed' THEN 1 ELSE 0 END) AS missed_events
                FROM mlops_suppression_ledger
                WHERE {where_sql}
                GROUP BY week, entity_type
                ORDER BY week
                """,
                params,
            ).fetchall()

        from collections import defaultdict
        week_map: Dict[str, Dict[str, Any]] = defaultdict(
            lambda: {
                "alert_total": 0,
                "alert_suppressed": 0,
                "case_total": 0,
                "case_suppressed": 0,
                "positives": 0,
                "missed_events": 0,
                "total": 0,
                "suppressed": 0,
            }
        )
        for row in rows:
            week, etype, total, suppressed, positives, missed = row
            wk = week_map[str(week)]
            etype_s = str(etype or "").lower()
            if etype_s == "case":
                wk["case_total"] += int(total or 0)
                wk["case_suppressed"] += int(suppressed or 0)
            else:
                wk["alert_total"] += int(total or 0)
                wk["alert_suppressed"] += int(suppressed or 0)
            wk["positives"] += int(positives or 0)
            wk["missed_events"] += int(missed or 0)
            wk["total"] += int(total or 0)
            wk["suppressed"] = wk["alert_suppressed"] + wk["case_suppressed"]

        windows: List[Dict[str, Any]] = []
        for week in sorted(week_map)[-max(int(n_weeks), 1):]:
            wk = week_map[week]
            supp_rate = round(100 * wk["suppressed"] / max(wk["total"], 1), 2)
            event_loss = round(100 * wk["missed_events"] / max(wk["positives"], 1), 2) if wk["positives"] > 0 else None
            windows.append(
                {
                    "week": week,
                    "suppression_rate": supp_rate,
                    "event_loss_pct": event_loss,
                    "alert_count": int(wk["alert_total"]),
                    "case_count": int(wk["case_total"]),
                    "psi": None,
                }
            )

        current = windows[-1]["suppression_rate"] if windows else 0
        first = windows[0]["suppression_rate"] if windows else 0
        drift = round(current - first, 2)

        # Alert vs case split from ledger (or synthetic)
        with self._conn() as conn:
            split = conn.execute(
                f"""
                SELECT entity_type,
                       COUNT(*) AS total,
                       SUM(CASE WHEN decision='suppressed' THEN 1 ELSE 0 END) AS suppressed
                FROM mlops_suppression_ledger
                WHERE {where_sql}
                GROUP BY entity_type
                """,
                params,
            ).fetchall()

        alert_supp = case_supp = None
        for row in split:
            etype, total, suppressed = row
            rate = round(100 * suppressed / max(total, 1), 2)
            if etype == "alert":
                alert_supp = rate
            else:
                case_supp = rate

        if resolved_grain == "alert":
            alert_supp = 0.0 if alert_supp is None else alert_supp
            case_supp = None
        elif resolved_grain == "case":
            case_supp = 0.0 if case_supp is None else case_supp
            alert_supp = None

        return {
            "model_grain": resolved_grain or "mixed",
            "windows": windows,
            "current_suppression_rate": current,
            "suppression_drift_pct": drift,
            "alert_vs_case": {
                "alert_suppression": alert_supp,
                "case_suppression": case_supp,
            },
        }

    def model_lineage(
        self,
        run_id: str,
        deployment_id: str,
        run_meta: Optional[Dict] = None,
    ) -> Dict:
        """
        Construct a DAG representing how this model was built.
        Nodes and edges suitable for rendering in a UI flow chart.

        run_meta — the activeModelRun object from the frontend (passed as JSON).

        Returns
        -------
        {
          nodes: [{ id, type, label, detail, status }],
          edges: [{ source, target, label }],
          summary_cards: [{ label, value, tone }]
        }
        """
        meta = run_meta or {}
        metrics = meta.get("metrics") or {}
        hp = meta.get("hyperparams") or {}
        model_grain = self._resolve_model_grain(
            run_id=run_id,
            run_meta=meta if isinstance(meta, dict) else None,
            default="alert",
        )
        grain_label = "Case" if model_grain == "case" else "Alert"

        nodes = [
            {
                "id": "raw_data",
                "type": "data",
                "label": "Raw Data Upload",
                "detail": f"{meta.get('train_rows', '?')} train + {meta.get('test_rows', '?')} test {model_grain} rows",
                "status": "done",
            },
            {
                "id": "master_ds",
                "type": "data",
                "label": "Master Dataset",
                "detail": f"Target: {meta.get('target_column', '?')}",
                "status": "done",
            },
            {
                "id": "preprocess",
                "type": "transform",
                "label": "Preprocessing",
                "detail": f"{meta.get('features_used', '?')} features after encoding & imputation",
                "status": "done",
            },
            {
                "id": "training",
                "type": "model",
                "label": f"Training | {meta.get('algorithm', 'Unknown').replace('_', ' ').title()}",
                "detail": (
                    f"CV Folds: {meta.get('cv_folds', 5)} | "
                    + " | ".join(f"{k}={v}" for k, v in list(hp.items())[:3])
                ),
                "status": "done",
            },
            {
                "id": "validation",
                "type": "validation",
                "label": "Model Validation",
                "detail": (
                    f"AUC: {metrics.get('roc_auc', 0):.4f} | "
                    f"F1: {metrics.get('f1', 0):.4f} | "
                    f"Precision: {metrics.get('precision', 0):.4f}"
                ),
                "status": "done",
            },
            {
                "id": "threshold",
                "type": "decision",
                "label": "Threshold Selection",
                "detail": (
                    f"Event-loss constrained optimisation | "
                    f"Threshold: {meta.get('threshold', 0.5)}"
                ),
                "status": "done",
            },
            {
                "id": "deployment",
                "type": "deploy",
                "label": "Deployed Model",
                "detail": f"Deployment ID: {deployment_id[:12]}...",
                "status": "active",
            },
            {
                "id": "suppression",
                "type": "output",
                "label": f"{grain_label} Suppression",
                "detail": f"Scoring {model_grain} entities only | suppress or escalate",
                "status": "active",
            },
        ]

        edges = [
            {"source": "raw_data",    "target": "master_ds",   "label": "joined & validated"},
            {"source": "master_ds",   "target": "preprocess",  "label": "feature engineering"},
            {"source": "preprocess",  "target": "training",    "label": "train/test split 80/20"},
            {"source": "training",    "target": "validation",  "label": "held-out test set"},
            {"source": "validation",  "target": "threshold",   "label": "AUC + event-loss constraint"},
            {"source": "threshold",   "target": "deployment",  "label": "approved & locked"},
            {"source": "deployment",  "target": "suppression", "label": "real-time scoring"},
        ]

        summary_cards = [
            {"label": "Model Grain",      "value": grain_label, "tone": "default"},
            {"label": "Algorithm",        "value": meta.get("algorithm", "N/A").replace("_", " ").title(), "tone": "default"},
            {"label": "ROC-AUC",          "value": f"{metrics.get('roc_auc', 0):.4f}", "tone": "good" if metrics.get("roc_auc", 0) >= 0.75 else "warn"},
            {"label": "F1 Score",         "value": f"{metrics.get('f1', 0):.4f}",      "tone": "default"},
            {"label": "Precision",        "value": f"{metrics.get('precision', 0):.4f}", "tone": "default"},
            {"label": "Recall",           "value": f"{metrics.get('recall', 0):.4f}",  "tone": "default"},
            {"label": "CV AUC (mean)",    "value": f"{metrics.get('cv_auc_mean', 0):.4f}", "tone": "default"},
            {"label": "Features Used",    "value": str(meta.get("features_used", "N/A")), "tone": "default"},
            {"label": "Training Rows",    "value": f"{meta.get('train_rows', 0):,}",   "tone": "default"},
            {"label": "Decision Threshold","value": str(meta.get("threshold", "N/A")),   "tone": "default"},
        ]

        return {"nodes": nodes, "edges": edges, "summary_cards": summary_cards}

    def event_loss_trend(
        self,
        deployment_id: str,
        n_weeks: int = 8,
        run_id: Optional[str] = None,
        model_grain: Optional[str] = None,
        include_simulation: bool = False,
    ) -> List[Dict]:
        """Return event-loss and suppression trend — delegates to drift_stats."""
        stats = self.drift_stats(
            deployment_id,
            n_weeks=n_weeks,
            run_id=run_id,
            model_grain=model_grain,
            include_simulation=include_simulation,
        )
        return stats["windows"]

    def alert_vs_case_summary(
        self,
        deployment_id: str,
        run_id: Optional[str] = None,
        model_grain: Optional[str] = None,
        include_simulation: bool = False,
    ) -> Dict:
        """
        Breakdown of total scored, suppressed, and escalated
        split by entity_type (alert / case).
        """
        resolved_grain: Optional[str] = None
        if model_grain:
            resolved_grain = self._normalize_grain(model_grain)
        elif run_id:
            resolved_grain = self._resolve_model_grain(run_id=run_id, default="alert")

        where_clauses = ["deployment_id = ?"]
        params: List[Any] = [deployment_id]
        if run_id:
            where_clauses.append("run_id = ?")
            params.append(str(run_id))
        if resolved_grain in {"alert", "case"}:
            where_clauses.append("entity_type = ?")
            params.append(resolved_grain)
        if not include_simulation:
            where_clauses.append("LOWER(COALESCE(source, '')) = 'production'")
        where_sql = " AND ".join(where_clauses)

        with self._conn() as conn:
            rows = conn.execute(
                f"""
                SELECT entity_type,
                       COUNT(*) AS total,
                       SUM(CASE WHEN decision='suppressed' THEN 1 ELSE 0 END) AS suppressed,
                       SUM(CASE WHEN decision='escalated'  THEN 1 ELSE 0 END) AS escalated,
                       AVG(model_score) AS avg_score,
                       MIN(scored_at) AS first_scored,
                       MAX(scored_at) AS last_scored
                FROM mlops_suppression_ledger
                WHERE {where_sql}
                GROUP BY entity_type
                """,
                params,
            ).fetchall()

        result = {}
        for r in rows:
            etype, total, suppressed, escalated, avg_score, first, last = r
            result[etype] = {
                "entity_type": etype,
                "total": int(total),
                "suppressed": int(suppressed),
                "escalated": int(escalated),
                "suppression_rate": round(100 * suppressed / max(total, 1), 2),
                "avg_score": round(float(avg_score or 0), 4),
                "first_scored": first.isoformat() if hasattr(first, "isoformat") else str(first),
                "last_scored": last.isoformat() if hasattr(last, "isoformat") else str(last),
            }

        if resolved_grain in {"alert", "case"}:
            if resolved_grain not in result:
                result[resolved_grain] = {
                    "entity_type": resolved_grain,
                    "total": 0,
                    "suppressed": 0,
                    "escalated": 0,
                    "suppression_rate": 0.0,
                    "avg_score": 0.0,
                    "first_scored": "N/A",
                    "last_scored": "N/A",
                }
            return {"model_grain": resolved_grain, resolved_grain: result[resolved_grain]}

        if "alert" not in result:
            result["alert"] = {
                "entity_type": "alert",
                "total": 0,
                "suppressed": 0,
                "escalated": 0,
                "suppression_rate": 0.0,
                "avg_score": 0.0,
                "first_scored": "N/A",
                "last_scored": "N/A",
            }
        if "case" not in result:
            result["case"] = {
                "entity_type": "case",
                "total": 0,
                "suppressed": 0,
                "escalated": 0,
                "suppression_rate": 0.0,
                "avg_score": 0.0,
                "first_scored": "N/A",
                "last_scored": "N/A",
            }
        result["model_grain"] = "mixed"
        return result

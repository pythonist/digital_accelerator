import json
import uuid
import hashlib
from datetime import datetime

import duckdb
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.metrics import confusion_matrix, precision_recall_curve, accuracy_score, precision_score, recall_score, f1_score, roc_auc_score

from models.model_pipeline import ModelPipeline
from models.model_pipeline import SMOTE
from modules.inference_engine import InferenceEngine
from services.mule_detection.db_service import get_md_db_service
from services.mule_detection.model_training.trainers import get_trainer


class ModelWorkbenchService:
    def __init__(self, env_id: str):
        self.env_id = env_id
        self.md_db = get_md_db_service()

    def _conn(self) -> tuple[duckdb.DuckDBPyConnection, dict]:
        paths = self.md_db.init_env_structure(self.env_id)
        return duckdb.connect(str(paths["duckdb"])), paths

    def _dataset_version(self, conn: duckdb.DuckDBPyConnection):
        row = conn.execute(
            """
            SELECT dataset_version, upload_id, uploaded_at
            FROM mule_uploads
            WHERE environment_id = ?
            ORDER BY uploaded_at DESC
            LIMIT 1
            """,
            [self.env_id],
        ).fetchone()
        if not row:
            return None
        dataset_version, upload_id, uploaded_at = row
        return str(dataset_version or upload_id or uploaded_at or "unknown")

    def experiments_create(self, payload: dict):
        experiment_id = str(uuid.uuid4())
        name = payload.get("name") or payload.get("experiment_name") or "Untitled"
        objective = payload.get("objective") or ""
        owner = payload.get("owner") or ""
        dataset_version = payload.get("dataset_version")
        feature_set_version = payload.get("feature_set_version")
        conn, _paths = self._conn()
        try:
            if not dataset_version:
                dataset_version = self._dataset_version(conn)
            conn.execute(
                """
                INSERT INTO mule_ml_experiments(experiment_id, name, objective, owner, dataset_version, feature_set_version, environment_id)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [experiment_id, name, objective, owner, dataset_version, feature_set_version, self.env_id],
            )
        finally:
            conn.close()
        return {
            "success": True,
            "experiment": {
                "experiment_id": experiment_id,
                "name": name,
                "objective": objective,
                "owner": owner,
                "dataset_version": dataset_version,
                "feature_set_version": feature_set_version,
            },
            "timestamp": now_iso(),
        }

    def experiments_list(self, limit: int = 50):
        conn, _paths = self._conn()
        try:
            df = conn.execute(
                """
                SELECT experiment_id, name, objective, owner, dataset_version, feature_set_version, created_at
                FROM mule_ml_experiments
                WHERE environment_id = ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                [self.env_id, int(limit)],
            ).df()
        finally:
            conn.close()
        return {"success": True, "experiments": df.to_dict("records"), "timestamp": now_iso()}

    def features_eligible(self, payload: dict | None = None):
        payload = payload or {}
        drop_high_leakage = bool(payload.get("drop_high_leakage", False))
        leakage_threshold = float(payload.get("leakage_threshold", 1.0))
        drop_unstable = bool(payload.get("drop_unstable", False))
        stability_threshold = float(payload.get("stability_threshold", 0.6))
        include = set(payload.get("include") or [])
        exclude = set(payload.get("exclude") or [])

        conn, _paths = self._conn()
        try:
            cols_df = conn.execute("PRAGMA table_info('mule_account_features')").df()
            if len(cols_df) == 0:
                return {"success": True, "features": [], "timestamp": now_iso(), "dataset_version": self._dataset_version(conn)}
            feat_names = [c for c in cols_df["name"].tolist() if c not in ["account_id", "environment_id", "computed_at"]]
            feats = conn.execute("SELECT * FROM mule_account_features WHERE environment_id = ?", [self.env_id]).df()
            labels = conn.execute("SELECT account_id, is_mule FROM mule_accounts_raw WHERE environment_id = ?", [self.env_id]).df()
            latest_runs = conn.execute(
                """
                SELECT run_id
                FROM mule_module_runs
                WHERE environment_id = ? AND module = 'feature_engineering'
                ORDER BY created_at DESC
                LIMIT 2
                """,
                [self.env_id],
            ).fetchall()
            cur_run = latest_runs[0][0] if len(latest_runs) > 0 else None
            prev_run = latest_runs[1][0] if len(latest_runs) > 1 else None
            cur_prof = pd.DataFrame()
            prev_prof = pd.DataFrame()
            if cur_run:
                cur_prof = conn.execute(
                    "SELECT feature_name, mean, std, missing_pct FROM mule_feature_profiles WHERE environment_id = ? AND run_id = ?",
                    [self.env_id, cur_run],
                ).df()
            if prev_run:
                prev_prof = conn.execute(
                    "SELECT feature_name, mean AS mean_prev, std AS std_prev, missing_pct AS missing_prev FROM mule_feature_profiles WHERE environment_id = ? AND run_id = ?",
                    [self.env_id, prev_run],
                ).df()
            dataset_version = self._dataset_version(conn)
        finally:
            conn.close()

        leakage = {}
        label_stats = {"has_results": False, "total": 0, "positives": 0, "positive_rate": None}
        if len(feats) and len(labels) and "is_mule" in labels.columns:
            merged = feats.merge(labels, on="account_id", how="left")
            y = pd.to_numeric(merged["is_mule"], errors="coerce").fillna(0).astype(int)
            total = int(len(y))
            positives = int(y.sum())
            label_stats = {
                "has_results": True,
                "total": total,
                "positives": positives,
                "positive_rate": (float(positives) / float(total)) if total > 0 else None,
            }
            for f in feat_names:
                if f not in merged.columns:
                    continue
                if not pd.api.types.is_numeric_dtype(merged[f]):
                    continue
                x = pd.to_numeric(merged[f], errors="coerce")
                std = float(x.std() or 0.0)
                if std == 0:
                    continue
                mu1 = float(x[y == 1].mean()) if (y == 1).any() else 0.0
                mu0 = float(x[y == 0].mean()) if (y == 0).any() else 0.0
                leakage[f] = abs(mu1 - mu0) / std

        stability = {}
        if len(cur_prof) and len(prev_prof):
            m = cur_prof.merge(prev_prof, on="feature_name", how="inner")
            for _, r in m.iterrows():
                denom = float(r.get("std_prev") or 0.0) or 1.0
                delta = abs(float(r.get("mean") or 0.0) - float(r.get("mean_prev") or 0.0)) / denom
                stability[r.get("feature_name")] = max(0.0, 1.0 - min(1.0, float(delta)))

        missing = {}
        if len(cur_prof):
            for _, r in cur_prof.iterrows():
                missing[r.get("feature_name")] = float(r.get("missing_pct") or 0.0)
        else:
            for f in feat_names:
                if f in feats.columns and len(feats):
                    missing[f] = float(feats[f].isna().mean())

        rows = []
        for f in feat_names:
            lr = leakage.get(f)
            st = stability.get(f)
            m = missing.get(f)
            eligible = True
            warnings = []
            if lr is not None and drop_high_leakage and lr >= leakage_threshold:
                eligible = False
                warnings.append("HIGH_LEAKAGE")
            elif lr is not None and lr >= leakage_threshold:
                warnings.append("LEAKAGE_RISK")
            if st is not None and drop_unstable and st <= stability_threshold:
                eligible = False
                warnings.append("UNSTABLE")
            elif st is not None and st <= stability_threshold:
                warnings.append("LOW_STABILITY")
            if f in exclude:
                eligible = False
                warnings.append("EXCLUDED")
            if include and f not in include:
                eligible = False
            rows.append(
                {
                    "feature_name": f,
                    "eligible": bool(eligible),
                    "missing_pct": m,
                    "stability": st,
                    "leakage_risk": lr,
                    "warnings": warnings,
                }
            )
        return {"success": True, "features": rows, "label_stats": label_stats, "dataset_version": dataset_version, "timestamp": now_iso()}

    def validation_run(self, payload: dict):
        strategy = payload.get("strategy") or {}
        kind = strategy.get("type") or "random"
        test_size = float(strategy.get("test_size", 0.2))
        random_state = int(strategy.get("random_state", 42))
        oot_days = int(strategy.get("oot_days", 30))

        conn, _paths = self._conn()
        try:
            df = conn.execute(
                """
                SELECT f.*, a.is_mule, a.customer_id, a.customer_type, a.risk_rating, a.account_open_date
                FROM mule_account_features f
                LEFT JOIN mule_accounts_raw a
                  ON a.environment_id = f.environment_id AND a.account_id = f.account_id
                WHERE f.environment_id = ?
                """,
                [self.env_id],
            ).df()
            dataset_version = self._dataset_version(conn)
        finally:
            conn.close()

        if len(df) == 0:
            return {"success": True, "has_results": False, "dataset_version": dataset_version, "timestamp": now_iso()}

        y = pd.to_numeric(df.get("is_mule"), errors="coerce").fillna(0).astype(int) if "is_mule" in df.columns else pd.Series([0] * len(df))

        idx = df.index.to_numpy().copy()
        split = {"train_idx": [], "val_idx": [], "oot_idx": []}
        explanation = ""

        if kind == "case":
            explanation = "Case-level split: groups by customer_id to prevent leakage across linked accounts."
            groups = df.get("customer_id").astype(str).fillna("MISSING")
            g_hash = groups.apply(lambda s: int(hashlib.md5(s.encode("utf-8")).hexdigest()[:8], 16) % 10_000)
            cutoff = int((1.0 - test_size) * 10_000)
            train_mask = g_hash < cutoff
            split["train_idx"] = idx[train_mask].tolist()
            split["val_idx"] = idx[~train_mask].tolist()
        elif kind == "time":
            explanation = "Time-based split: OOT uses most recent cohort by account_open_date."
            if "account_open_date" in df.columns and df["account_open_date"].notna().any():
                od = pd.to_datetime(df["account_open_date"], errors="coerce")
                max_d = od.max()
                oot_start = max_d - pd.Timedelta(days=oot_days)
                oot_mask = od >= oot_start
                split["oot_idx"] = idx[oot_mask].tolist()
                remain = idx[~oot_mask]
                rng = np.random.default_rng(random_state)
                rng.shuffle(remain)
                n_val = int(len(remain) * test_size)
                split["val_idx"] = remain[:n_val].tolist()
                split["train_idx"] = remain[n_val:].tolist()
            else:
                kind = "random"
        if kind == "random":
            explanation = "Random stratified split (when labels allow)."
            rng = np.random.default_rng(random_state)
            rng.shuffle(idx)
            n_val = int(len(idx) * test_size)
            split["val_idx"] = idx[:n_val].tolist()
            split["train_idx"] = idx[n_val:].tolist()

        out = {
            "success": True,
            "has_results": True,
            "dataset_version": dataset_version,
            "timestamp": now_iso(),
            "strategy": {"type": kind, "test_size": test_size, "random_state": random_state, "oot_days": oot_days},
            "explanation": explanation,
            "sizes": {k: len(v) for k, v in split.items()},
        }
        return out

    def training_run(self, payload: dict):
        experiment_id = payload.get("experiment_id")
        model_type = payload.get("model_type", "xgboost")
        hyperparams = payload.get("hyperparams") or {}
        validation = payload.get("validation") or {"type": "random", "test_size": 0.2, "random_state": 42}
        threshold = float(payload.get("threshold", 0.5))
        feature_selection = payload.get("feature_selection") or {}
        use_smote = bool(payload.get("use_smote", True))
        cv_folds = int(payload.get("cv_folds", 5))
        random_state = int(validation.get("random_state", 42))
        test_size = float(validation.get("test_size", 0.2))

        conn, paths = self._conn()
        try:
            df = conn.execute(
                """
                SELECT f.*, a.is_mule
                FROM mule_account_features f
                LEFT JOIN mule_accounts_raw a
                  ON a.environment_id = f.environment_id AND a.account_id = f.account_id
                WHERE f.environment_id = ?
                """,
                [self.env_id],
            ).df()
            dataset_version = self._dataset_version(conn)
        finally:
            conn.close()

        if len(df) == 0:
            return {"success": False, "error": "No engineered features found"}

        model_type = str(model_type or "").strip().lower()
        supervised_types = {"xgboost", "randomforest", "logistic", "lightgbm", "lgbm"}
        unsupervised_types = {"isolation_forest", "kmeans", "dbscan", "pca_autoencoder", "autoencoder"}
        if model_type not in supervised_types and model_type not in unsupervised_types:
            return {"success": False, "error": "Unknown model type"}

        include = feature_selection.get("include") or []
        exclude = set(feature_selection.get("exclude") or [])
        feature_cols = [c for c in df.columns if c not in ["account_id", "environment_id", "computed_at", "is_mule"]]
        before_filter_count = int(len(feature_cols))
        if include:
            feature_cols = [c for c in feature_cols if c in set(include)]
        feature_cols = [c for c in feature_cols if c not in exclude]
        after_filter_count = int(len(feature_cols))
        if len(feature_cols) == 0:
            return {"success": False, "error": "No features selected"}

        data = df[["account_id", "is_mule"] + feature_cols].copy()
        data["is_mule"] = pd.to_numeric(data.get("is_mule"), errors="coerce").fillna(0).astype(int)

        pipeline = ModelPipeline(model_dir=str(paths["models_dir"]))
        t0 = datetime.now()
        logs = []
        logs.append({"ts": now_iso(), "step": "prepare", "message": "Preparing dataset"})

        X, y, feature_names = pipeline._prepare_data(data)  # type: ignore[attr-defined]
        selection_report = {
            "include": list(include) if isinstance(include, list) else [],
            "exclude": list(exclude),
            "selected_before_filter": before_filter_count,
            "selected_after_filter": after_filter_count,
            "selected_after_prepare": int(len(feature_names)),
            "dropped_correlated": list(getattr(pipeline, "last_correlated_dropped", []) or []),
            "correlation_threshold": getattr(pipeline, "last_corr_threshold", None),
        }
        corr_heatmap = getattr(pipeline, "last_corr_heatmap", None)
        y_unique = np.unique(y)
        if model_type in supervised_types and len(y_unique) < 2:
            return {"success": False, "error": "Supervised training requires both classes in is_mule. Provide labels or use an unsupervised model."}

        if use_smote and SMOTE is not None and len(y_unique) > 1 and sum(y) < len(y) * 0.3:
            logs.append({"ts": now_iso(), "step": "balance", "message": "Applying SMOTE"})
            smote = SMOTE(random_state=random_state)
            X, y = smote.fit_resample(X, y)

        class_counts = np.bincount(y.astype(int)) if len(y) else np.array([])
        min_class = int(class_counts.min()) if len(class_counts) else 0
        n_classes = int(len(np.unique(y)))
        test_n = int(np.ceil(len(y) * test_size)) if len(y) else 0
        train_n = int(len(y) - test_n) if len(y) else 0
        use_stratify = n_classes > 1 and min_class >= 2 and test_n >= n_classes and train_n >= n_classes

        logs.append({"ts": now_iso(), "step": "split", "message": f"Splitting train/test (test_size={test_size})"})
        X_train = X_test = y_train = y_test = None
        if model_type in supervised_types:
            for i in range(10):
                rs = random_state + i
                Xt, Xv, yt, yv = train_test_split(
                    X, y, test_size=test_size, random_state=rs, stratify=y if use_stratify else None
                )
                if len(np.unique(yt)) < 2 or len(np.unique(yv)) < 2:
                    continue
                X_train, X_test, y_train, y_test = Xt, Xv, yt, yv
                break
            if X_train is None:
                return {"success": False, "error": "Not enough labeled data to produce a valid holdout split across both classes."}
        else:
            Xt, Xv, yt, yv = train_test_split(X, y, test_size=test_size, random_state=random_state, stratify=None)
            X_train, X_test, y_train, y_test = Xt, Xv, yt, yv

        logs.append({"ts": now_iso(), "step": "scale", "message": "Scaling features"})
        X_train_scaled = pipeline.scaler.fit_transform(X_train)
        X_test_scaled = pipeline.scaler.transform(X_test)

        logs.append({"ts": now_iso(), "step": "train", "message": f"Training model ({model_type})"})
        trainer = get_trainer(model_type)
        train_res = trainer.train(X_train_scaled, y_train, cv_folds=cv_folds, random_state=random_state, model_params=hyperparams)
        model = train_res.model

        if model_type in supervised_types and len(np.unique(y_train)) < 2:
            return {"success": False, "error": "Not enough labeled data for a holdout split. Increase labeled sample size or use isolation_forest."}

        logs.append({"ts": now_iso(), "step": "evaluate", "message": "Evaluating on holdout"})
        feature_importance = pipeline._get_feature_importance(model, feature_names)  # type: ignore[attr-defined]

        y_prob = self._predict_proba_safe(model, X_test_scaled)
        if model_type in supervised_types:
            y_pred = (y_prob >= 0.5).astype(int)
            metrics = {
                "accuracy": float(accuracy_score(y_test, y_pred)),
                "precision": float(precision_score(y_test, y_pred, zero_division=0)),
                "recall": float(recall_score(y_test, y_pred, zero_division=0)),
                "f1_score": float(f1_score(y_test, y_pred, zero_division=0)),
                "roc_auc": float(roc_auc_score(y_test, y_prob)) if len(np.unique(y_test)) > 1 else 0.0,
                "confusion_matrix": confusion_matrix(y_test, y_pred, labels=[0, 1]).tolist(),
                "mode": "supervised",
            }
            tradeoffs = self._tradeoffs_from_scores(y_test, y_prob, threshold)
        else:
            scores = np.asarray(y_prob).reshape(-1)
            t = float(threshold)
            metrics = {
                "mode": "unsupervised",
                "mean_score": float(np.mean(scores)) if len(scores) else 0.0,
                "p95_score": float(np.quantile(scores, 0.95)) if len(scores) else 0.0,
                "anomaly_rate": float((scores >= t).mean()) if len(scores) else 0.0,
                "threshold": t,
            }
            tradeoffs = {"threshold": t, "confusion_matrix": None, "precision_recall": None, "suppression_vs_event_loss": self._suppression_curve_unsupervised(scores)}

        logs.append({"ts": now_iso(), "step": "save", "message": "Persisting model artifact"})
        training_config = {
            "model_type": model_type,
            "test_size": float(test_size),
            "use_smote": bool(use_smote),
            "cv_folds": int(cv_folds),
            "random_state": int(random_state),
        }
        model_version = pipeline._save_model(  # type: ignore[attr-defined]
            model=model,
            model_type=model_type,
            metrics=metrics,
            features=feature_names,
            feature_importance=feature_importance,
            model_params=hyperparams or {},
            training_config=training_config,
        )
        try:
            pipeline._log_experiment(model_version=model_version, model_type=model_type, metrics=metrics, features_used=feature_names, feature_importance=feature_importance)  # type: ignore[attr-defined]
        except Exception:
            pass

        duration_seconds = int((datetime.now() - t0).total_seconds())
        logs.append({"ts": now_iso(), "step": "complete", "message": f"Completed in {duration_seconds}s"})

        run_id = str(uuid.uuid4())
        model_path = str((paths["models_dir"] / f"{model_version}.pkl"))
        conn, _p = self._conn()
        try:
            conn.execute(
                """
                INSERT INTO mule_models
                VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, 'READY', false, ?)
                """,
                [
                    model_version,
                    model_path,
                    model_type,
                    int(len(data)),
                    int(len(feature_names)),
                    float(metrics.get("roc_auc", 0) or 0),
                    float(metrics.get("recall", 0) or 0),
                    float(metrics.get("precision", 0) or 0),
                    float(metrics.get("f1_score", 0) or 0),
                    self.env_id,
                ],
            )
            conn.execute(
                """
                INSERT INTO mule_ml_experiment_runs(run_id, experiment_id, stage, status, config_json, result_json, environment_id)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    run_id,
                    experiment_id,
                    "training",
                    "completed",
                    json.dumps({"model_type": model_type, "hyperparams": hyperparams, "validation": validation, "threshold": threshold, "feature_selection": feature_selection}, default=str),
                    json.dumps({"model_version": model_version, "metrics": metrics, "tradeoffs": tradeoffs, "duration_seconds": duration_seconds, "features_used": feature_names, "feature_importance": feature_importance, "logs": logs}, default=str),
                    self.env_id,
                ],
            )
        finally:
            conn.close()

        return {
            "success": True,
            "run_id": run_id,
            "experiment_id": experiment_id,
            "dataset_version": dataset_version,
            "feature_set_version": payload.get("feature_set_version"),
            "timestamp": now_iso(),
            "model_version": model_version,
            "metrics": metrics,
            "tradeoffs": tradeoffs,
            "duration_seconds": duration_seconds,
            "features_used": feature_names,
            "feature_selection_report": selection_report,
            "correlation_heatmap": corr_heatmap,
            "feature_importance": feature_importance,
            "logs": logs,
        }

    def _suppression_curve_unsupervised(self, scores: np.ndarray):
        s = np.asarray(scores).reshape(-1)
        out = []
        for t in [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]:
            pred = (s >= float(t)).astype(int)
            suppressed = float((pred == 0).mean()) if len(pred) else 0.0
            anomaly_rate = float((pred == 1).mean()) if len(pred) else 0.0
            out.append({"threshold": float(t), "suppression": suppressed, "event_loss": None, "anomaly_rate": anomaly_rate})
        return out

    def metrics(self, params: dict):
        experiment_id = params.get("experiment_id")
        model_version = params.get("model_version")
        conn, _paths = self._conn()
        try:
            if model_version:
                row = conn.execute(
                    """
                    SELECT model_version, trained_at, algorithm, training_samples, feature_count, auc, recall, precision, f1, status, active
                    FROM mule_models
                    WHERE environment_id = ? AND model_version = ?
                    """,
                    [self.env_id, model_version],
                ).fetchone()
                return {"success": True, "model": dict_row(row, ["model_version","trained_at","algorithm","training_samples","feature_count","auc","recall","precision","f1","status","active"]), "timestamp": now_iso()}
            if experiment_id:
                df = conn.execute(
                    """
                    SELECT run_id, result_json, created_at
                    FROM mule_ml_experiment_runs
                    WHERE environment_id = ? AND experiment_id = ? AND stage = 'training'
                    ORDER BY created_at DESC
                    LIMIT 5
                    """,
                    [self.env_id, experiment_id],
                ).df()
                rows = []
                for _, r in df.iterrows():
                    rows.append({"run_id": r.get("run_id"), "created_at": str(r.get("created_at")), **json.loads(r.get("result_json") or "{}")})
                return {"success": True, "runs": rows, "timestamp": now_iso()}
            return {"success": True, "timestamp": now_iso(), "runs": []}
        finally:
            conn.close()

    def explain_global(self, params: dict):
        model_version = params.get("model_version")
        if not model_version:
            return {"success": False, "error": "model_version is required"}
        conn, paths = self._conn()
        try:
            p = paths["models_dir"] / f"{model_version}.pkl"
            if not p.exists():
                return {"success": False, "error": "Model file not found"}
            with open(p, "rb") as f:
                d = json_safe_pickle_load(f)
        finally:
            conn.close()
        meta = (d or {}).get("metadata", {}) or {}
        fi = meta.get("feature_importance") or {}
        all_features = (fi.get("all_features") or {}) if isinstance(fi, dict) else {}
        top = sorted(all_features.items(), key=lambda kv: float(kv[1] or 0), reverse=True)[:20]
        return {
            "success": True,
            "model_version": model_version,
            "timestamp": now_iso(),
            "global": [{"feature": k, "importance": float(v or 0)} for k, v in top],
        }

    def explain_local(self, params: dict):
        model_version = params.get("model_version")
        account_id = params.get("account_id")
        if not model_version or not account_id:
            return {"success": False, "error": "model_version and account_id are required"}
        conn, paths = self._conn()
        try:
            features_df = conn.execute(
                "SELECT * EXCLUDE(environment_id, computed_at) FROM mule_account_features WHERE environment_id = ?",
                [self.env_id],
            ).df()
        finally:
            conn.close()
        x_row = features_df[features_df["account_id"] == account_id]
        if len(x_row) == 0:
            return {"success": False, "error": "Account not found in engineered features"}
        engine = InferenceEngine(model_store_path=str(paths["models_dir"]))
        model_data = engine.load_model(model_version)
        metadata = model_data.get("metadata", {}) or {}
        feature_cols = metadata.get("features", []) or []
        if not feature_cols:
            return {"success": False, "error": "Model metadata missing feature list"}
        model = model_data["model"]
        x = x_row.reindex(columns=feature_cols).copy()
        x = x.replace([np.inf, -np.inf], np.nan).fillna(0)
        x = x.apply(pd.to_numeric, errors="coerce").replace([np.inf, -np.inf], np.nan).fillna(0)
        arr = engine._prepare_features(x, feature_cols, metadata)  # type: ignore[attr-defined]
        score = float(self._predict_proba_safe(model, arr)[0]) if len(arr) else 0.0

        model_type = str(metadata.get("model_type") or metadata.get("training_config", {}).get("model_type") or "").strip().lower()
        if not model_type:
            model_type = str(getattr(model, "__class__", type("X", (), {})).__name__ or "").lower()

        def _theme(f: str):
            n = str(f or "").lower()
            if "device" in n or "ip" in n or "vpn" in n or "fingerprint" in n:
                return "DEVICE"
            if "centrality" in n or "pagerank" in n or "community" in n or "degree" in n or "network" in n:
                return "NETWORK"
            if "cycle" in n or "circular" in n or "round_trip" in n or "loop" in n:
                return "CIRCULARITY"
            if "pass_through" in n or "in_out" in n or "out_in" in n:
                return "PASS_THROUGH"
            if "count_24h" in n or "tx_count" in n or "txn_count" in n or "velocity" in n:
                return "VELOCITY"
            if "cash" in n or "atm" in n or "withdraw" in n:
                return "CASH_OUT"
            if "kyc" in n or "occupation" in n or "income" in n or "age" in n or "risk_rating" in n:
                return "KYC"
            return "BEHAVIOR"

        def _mule_types(themes: list[str]):
            s = set([t for t in themes if t])
            out = []
            if "PASS_THROUGH" in s or "VELOCITY" in s or "CASH_OUT" in s:
                out.append("PASS_THROUGH_MULE")
            if "DEVICE" in s:
                out.append("DEVICE_SHARING_RING")
            if "NETWORK" in s:
                out.append("NETWORK_COORDINATION")
            if "CIRCULARITY" in s:
                out.append("CIRCULAR_FLOW_MULE")
            if "KYC" in s:
                out.append("RISK_PROFILE_MULE")
            return out[:3]

        contrib = []
        method = "zscore"

        if model_type in ["logistic"] and hasattr(model, "coef_"):
            method = "coefficients"
            coef = np.asarray(getattr(model, "coef_", np.zeros((1, len(feature_cols))))).reshape(-1)
            z = np.asarray(arr).reshape(-1)
            for i, f in enumerate(feature_cols):
                v = float(x.iloc[0][f]) if f in x.columns and pd.notna(x.iloc[0][f]) else 0.0
                c = float(coef[i] * z[i]) if i < len(coef) and i < len(z) else 0.0
                contrib.append({"feature": f, "value": v, "importance": c})
            contrib.sort(key=lambda r: abs(r["importance"]), reverse=True)
            contrib = contrib[:20]
        elif model_type in ["pca_autoencoder", "autoencoder"] and hasattr(model, "reconstruction_residual"):
            method = "reconstruction"
            resid = np.asarray(model.reconstruction_residual(arr)).reshape(1, -1)
            r0 = resid[0] if resid.size else np.zeros(len(feature_cols))
            for i, f in enumerate(feature_cols):
                v = float(x.iloc[0][f]) if f in x.columns and pd.notna(x.iloc[0][f]) else 0.0
                c = float(r0[i]) if i < len(r0) else 0.0
                contrib.append({"feature": f, "value": v, "importance": c})
            contrib.sort(key=lambda r: abs(r["importance"]), reverse=True)
            contrib = contrib[:20]
        elif model_type in ["kmeans"] and hasattr(model, "cluster_centers_"):
            method = "centroid_distance"
            centers = np.asarray(getattr(model, "cluster_centers_", np.zeros((0, len(feature_cols)))))
            v = np.asarray(arr).reshape(1, -1)
            if centers.size:
                d = np.linalg.norm(centers - v, axis=1)
                idx = int(np.argmin(d))
                delta = v.reshape(-1) - centers[idx].reshape(-1)
            else:
                delta = v.reshape(-1)
            for i, f in enumerate(feature_cols):
                raw = float(x.iloc[0][f]) if f in x.columns and pd.notna(x.iloc[0][f]) else 0.0
                contrib.append({"feature": f, "value": raw, "importance": float(delta[i]) if i < len(delta) else 0.0})
            contrib.sort(key=lambda r: abs(r["importance"]), reverse=True)
            contrib = contrib[:20]
        else:
            if model_type in ["xgboost", "randomforest", "lightgbm", "lgbm"]:
                try:
                    import shap  # type: ignore
                    explainer = shap.TreeExplainer(model)
                    shap_values = explainer.shap_values(arr)
                    if isinstance(shap_values, list) and len(shap_values) > 1:
                        sv = np.array(shap_values[1]).reshape(-1)
                    else:
                        sv = np.array(shap_values).reshape(-1)
                    method = "shap"
                    for i, f in enumerate(feature_cols):
                        raw = float(x.iloc[0][f]) if f in x.columns and pd.notna(x.iloc[0][f]) else 0.0
                        contrib.append({"feature": f, "value": raw, "shap": float(sv[i]) if i < len(sv) else 0.0})
                    contrib.sort(key=lambda r: abs(r["shap"]), reverse=True)
                    contrib = contrib[:20]
                except Exception:
                    contrib = []
            if not contrib:
                method = "zscore"
                z = np.asarray(arr).reshape(-1)
                for i, f in enumerate(feature_cols):
                    raw = float(x.iloc[0][f]) if f in x.columns and pd.notna(x.iloc[0][f]) else 0.0
                    contrib.append({"feature": f, "value": raw, "importance": float(z[i]) if i < len(z) else 0.0})
                contrib.sort(key=lambda r: abs(r["importance"]), reverse=True)
                contrib = contrib[:20]

        top_themes = []
        for r in contrib[:12]:
            t = _theme(r.get("feature"))
            if t not in top_themes:
                top_themes.append(t)
            if len(top_themes) >= 4:
                break

        meaning = "Likelihood of mule involvement" if model_type in ["xgboost", "randomforest", "logistic", "lightgbm", "lgbm"] else "Behavioral abnormality requiring review"
        bullets = []
        for t in top_themes[:3]:
            if t == "PASS_THROUGH":
                bullets.append("rapid outward movement")
            elif t == "VELOCITY":
                bullets.append("high transaction velocity")
            elif t == "DEVICE":
                bullets.append("shares device identifiers across accounts")
            elif t == "NETWORK":
                bullets.append("network coordination patterns")
            elif t == "CIRCULARITY":
                bullets.append("circular transfer behavior")
            elif t == "CASH_OUT":
                bullets.append("cash-out intensity patterns")
            elif t == "KYC":
                bullets.append("risky KYC profile signals")
            else:
                bullets.append("unusual behavioral deviations")

        return {
            "success": True,
            "method": method,
            "model_type": model_type,
            "model_version": model_version,
            "account_id": account_id,
            "score": score,
            "meaning": meaning,
            "narrative": {"headline": "Account is risky because:" if meaning.startswith("Likelihood") else "Account requires review because:", "bullets": bullets},
            "themes": top_themes,
            "mule_types": _mule_types(top_themes),
            "local": contrib,
            "timestamp": now_iso(),
        }

    def _tradeoffs_from_scores(self, y_true, y_prob, threshold: float):
        y_true = np.asarray(y_true).astype(int).reshape(-1)
        y_prob = np.asarray(y_prob).astype(float).reshape(-1)
        pred = (y_prob >= float(threshold)).astype(int)
        cm = confusion_matrix(y_true, pred, labels=[0, 1]).tolist()
        pr = precision_recall_curve(y_true, y_prob) if len(np.unique(y_true)) > 1 else (np.array([0.0]), np.array([0.0]), np.array([]))
        return {
            "threshold": float(threshold),
            "confusion_matrix": cm,
            "precision_recall": {"precision": pr[0].tolist(), "recall": pr[1].tolist(), "thresholds": pr[2].tolist()},
            "suppression_vs_event_loss": self._suppression_curve(pd.Series(y_true), pd.Series(y_prob)),
        }

    def _predict_proba_safe(self, model, X):
        if hasattr(model, "predict_proba"):
            p = model.predict_proba(X)
            p = np.asarray(p)
            if p.ndim == 2 and p.shape[1] >= 2:
                return p[:, 1]
            if hasattr(model, "classes_") and len(getattr(model, "classes_", [])) == 1:
                cls = int(model.classes_[0])
                return np.ones(X.shape[0]) if cls == 1 else np.zeros(X.shape[0])
            return np.zeros(X.shape[0])
        if hasattr(model, "decision_function"):
            s = np.asarray(model.decision_function(X)).reshape(-1)
            if len(s) == 0:
                return np.zeros(X.shape[0])
            lo, hi = float(np.min(s)), float(np.max(s))
            if lo == hi:
                return np.zeros(X.shape[0])
            return (s - lo) / (hi - lo)
        return np.asarray(model.predict(X)).reshape(-1)

    def bias(self, payload: dict):
        model_version = payload.get("model_version")
        threshold = float(payload.get("threshold", 0.5))
        if not model_version:
            return {"success": False, "error": "model_version is required"}
        conn, paths = self._conn()
        try:
            feats = conn.execute(
                "SELECT * EXCLUDE(environment_id, computed_at) FROM mule_account_features WHERE environment_id = ?",
                [self.env_id],
            ).df()
            acc = conn.execute(
                "SELECT account_id, is_mule, customer_type, risk_rating, geo_location FROM mule_accounts_raw WHERE environment_id = ?",
                [self.env_id],
            ).df()
        finally:
            conn.close()
        if len(feats) == 0:
            return {"success": True, "has_results": False, "timestamp": now_iso()}
        df = feats.merge(acc, on="account_id", how="left")
        y = pd.to_numeric(df.get("is_mule"), errors="coerce").fillna(0).astype(int)
        engine = InferenceEngine(model_store_path=str(paths["models_dir"]))
        model_data = engine.load_model(model_version)
        meta = model_data.get("metadata", {}) or {}
        feature_cols = meta.get("features", []) or []
        x = df.reindex(columns=feature_cols).copy()
        x = x.replace([np.inf, -np.inf], np.nan).fillna(0)
        model = model_data["model"]
        x = x.apply(pd.to_numeric, errors="coerce").replace([np.inf, -np.inf], np.nan).fillna(0)
        arr = engine._prepare_features(x, feature_cols, meta)  # type: ignore[attr-defined]
        s = pd.Series(self._predict_proba_safe(model, arr))
        pred = (s >= threshold).astype(int)
        group_cols = [c for c in ["geo_location", "customer_type", "risk_rating"] if c in df.columns]
        out = []
        for g in group_cols:
            for key, sub in df.groupby(df[g].astype(str).fillna("MISSING")):
                idx = sub.index
                yy = y.loc[idx]
                pp = pred.loc[idx]
                cm = confusion_matrix(yy, pp, labels=[0, 1]).tolist()
                out.append({"dimension": g, "group": str(key), "count": int(len(sub)), "confusion_matrix": cm})
        return {"success": True, "has_results": True, "model_version": model_version, "threshold": threshold, "groups": out, "timestamp": now_iso()}

    def compare(self, payload: dict):
        champion = payload.get("champion_model")
        challenger = payload.get("challenger_model")
        threshold = float(payload.get("threshold", 0.5))
        if not champion or not challenger:
            return {"success": False, "error": "champion_model and challenger_model are required"}
        conn, paths = self._conn()
        try:
            feats = conn.execute(
                "SELECT * EXCLUDE(environment_id, computed_at) FROM mule_account_features WHERE environment_id = ?",
                [self.env_id],
            ).df()
            labels = conn.execute(
                "SELECT account_id, is_mule FROM mule_accounts_raw WHERE environment_id = ?",
                [self.env_id],
            ).df()
        finally:
            conn.close()
        df = feats.merge(labels, on="account_id", how="left")
        y = pd.to_numeric(df.get("is_mule"), errors="coerce").fillna(0).astype(int)

        def _score(model_version: str):
            engine = InferenceEngine(model_store_path=str(paths["models_dir"]))
            model_data = engine.load_model(model_version)
            metadata = model_data.get("metadata", {}) or {}
            feature_cols = metadata.get("features", []) or []
            x = df.reindex(columns=feature_cols).copy()
            x = x.replace([np.inf, -np.inf], np.nan).fillna(0)
            x = x.apply(pd.to_numeric, errors="coerce").replace([np.inf, -np.inf], np.nan).fillna(0)
            model = model_data["model"]
            arr = engine._prepare_features(x, feature_cols, metadata)  # type: ignore[attr-defined]
            prob = pd.Series(self._predict_proba_safe(model, arr))
            pred = (prob >= threshold).astype(int)
            cm = confusion_matrix(y, pred, labels=[0, 1]).tolist()
            pr_out = None
            if len(np.unique(y)) > 1:
                pr = precision_recall_curve(y, prob)
                pr_out = {"precision": pr[0].tolist(), "recall": pr[1].tolist(), "thresholds": pr[2].tolist()}
            return float(prob.mean()) if len(prob) else 0.0, cm, pr_out

        champ_mean, champ_cm, champ_pr = _score(champion)
        chall_mean, chall_cm, chall_pr = _score(challenger)
        if champ_cm is None or chall_cm is None:
            return {"success": False, "error": "One of the models cannot be scored"}
        return {
            "success": True,
            "champion": {"model_version": champion, "mean_score": champ_mean, "confusion_matrix": champ_cm, "pr_curve": champ_pr},
            "challenger": {"model_version": challenger, "mean_score": chall_mean, "confusion_matrix": chall_cm, "pr_curve": chall_pr},
            "threshold": threshold,
            "timestamp": now_iso(),
        }

    def approve(self, payload: dict):
        model_version = payload.get("model_version")
        experiment_id = payload.get("experiment_id")
        reviewer = payload.get("reviewer") or ""
        decision = payload.get("decision")
        comments = payload.get("comments") or ""
        valid_until = payload.get("valid_until")
        activate = bool(payload.get("activate", False))
        if not model_version or not decision:
            return {"success": False, "error": "model_version and decision are required"}
        approval_id = str(uuid.uuid4())
        conn, _paths = self._conn()
        try:
            conn.execute(
                """
                INSERT INTO mule_ml_model_approvals(approval_id, model_version, experiment_id, reviewer, decision, comments, valid_until, environment_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [approval_id, model_version, experiment_id, reviewer, decision, comments, valid_until, self.env_id],
            )
            if activate:
                conn.execute("UPDATE mule_models SET active = FALSE WHERE environment_id = ?", [self.env_id])
                conn.execute("UPDATE mule_models SET active = TRUE WHERE environment_id = ? AND model_version = ?", [self.env_id, model_version])
        finally:
            conn.close()
        return {"success": True, "approval_id": approval_id, "model_version": model_version, "decision": decision, "timestamp": now_iso()}

    def _compute_tradeoffs(self, paths: dict, model_version: str, data: pd.DataFrame, threshold: float):
        if not model_version:
            return {}
        engine = InferenceEngine(model_store_path=str(paths["models_dir"]))
        model_data = engine.load_model(model_version)
        feature_cols = (model_data.get("metadata", {}) or {}).get("features", []) or []
        model = model_data["model"]
        if "is_mule" not in data.columns:
            return {}
        y = pd.to_numeric(data["is_mule"], errors="coerce").fillna(0).astype(int)
        x = data.reindex(columns=feature_cols).copy()
        x = x.replace([np.inf, -np.inf], np.nan).fillna(0)
        x = x.apply(pd.to_numeric, errors="coerce").replace([np.inf, -np.inf], np.nan).fillna(0)
        if not hasattr(model, "predict_proba"):
            return {}
        prob = pd.Series(model.predict_proba(x.values)[:, 1])
        pr = precision_recall_curve(y, prob)
        pred = (prob >= threshold).astype(int)
        cm = confusion_matrix(y, pred, labels=[0, 1]).tolist()
        return {
            "threshold": threshold,
            "confusion_matrix": cm,
            "precision_recall": {"precision": pr[0].tolist(), "recall": pr[1].tolist(), "thresholds": pr[2].tolist()},
            "suppression_vs_event_loss": self._suppression_curve(y, prob),
        }

    def _suppression_curve(self, y: pd.Series, prob: pd.Series):
        out = []
        for t in [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]:
            pred = (prob >= t).astype(int)
            suppressed = float((pred == 0).mean())
            event_loss = float(((y == 1) & (pred == 0)).sum() / max(int((y == 1).sum()), 1))
            out.append({"threshold": t, "suppression": suppressed, "event_loss": event_loss})
        return out


def now_iso():
    return datetime.now().isoformat()


def dict_row(row, cols):
    if not row:
        return None
    return {cols[i]: row[i] for i in range(min(len(cols), len(row)))}


def json_safe_pickle_load(file_obj):
    import pickle
    try:
        return pickle.load(file_obj)
    except Exception:
        return {}

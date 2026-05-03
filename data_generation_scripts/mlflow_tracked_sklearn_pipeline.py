from __future__ import annotations

import argparse
import json
import os
import random
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import mlflow
import mlflow.sklearn
import numpy as np
import pandas as pd
from mlflow.models.signature import infer_signature
from sklearn.metrics import average_precision_score, precision_score, recall_score, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression


@dataclass
class PipelineConfig:
    pipeline_name: str
    experiment_name: str
    target_col: str
    seed: int = 42
    test_size: float = 0.2
    random_state: int = 42
    user: str = "local"
    version: str = "1.0.0"
    suppression_threshold: float = 0.5


def set_global_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    os.environ["PYTHONHASHSEED"] = str(seed)


def load_data(data_path: str | Path) -> pd.DataFrame:
    path = Path(data_path)
    if not path.exists():
        raise FileNotFoundError(f"Input data not found: {path}")
    if path.suffix.lower() in {".parquet", ".pq"}:
        return pd.read_parquet(path)
    return pd.read_csv(path)


def preprocessing_step(
    df: pd.DataFrame,
    target_col: str,
    preprocessing_config: Optional[Dict[str, Any]] = None,
) -> Tuple[pd.DataFrame, pd.Series, List[str], Dict[str, Any]]:
    """
    Replace the body of this function with your existing preprocessing and feature
    engineering logic if you need exact behavior parity.

    The default implementation is intentionally small and deterministic:
    - keeps the target column
    - uses numeric columns as features
    - encodes booleans to integers
    - drops obviously non-feature identifier columns
    """
    preprocessing_config = preprocessing_config or {}
    df = df.copy()

    if target_col not in df.columns:
        raise ValueError(f"Target column '{target_col}' not found in dataset")

    y = df[target_col].astype(int)

    drop_cols = set(preprocessing_config.get("drop_columns", []))
    drop_cols.add(target_col)
    for col in df.columns:
        lowered = str(col).strip().lower()
        if lowered in {"id", "uuid", "created_at", "updated_at"}:
            drop_cols.add(col)

    X = df.drop(columns=[c for c in drop_cols if c in df.columns], errors="ignore")

    for col in X.columns:
        if pd.api.types.is_bool_dtype(X[col]):
            X[col] = X[col].astype(int)

    numeric_cols = X.select_dtypes(include=[np.number]).columns.tolist()
    categorical_cols = [c for c in X.columns if c not in numeric_cols]

    # Light-touch deterministic encoding so the script stays runnable.
    # If you already have your own feature engineering logic, keep it unchanged
    # by replacing this block with your current code.
    if categorical_cols:
        encoded = pd.get_dummies(X[categorical_cols].fillna("missing"), dummy_na=False, drop_first=False)
        X = pd.concat([X[numeric_cols].copy(), encoded], axis=1)
    else:
        X = X[numeric_cols].copy()

    X = X.replace([np.inf, -np.inf], np.nan).fillna(0.0)
    feature_list = list(X.columns)

    preprocessing_artifact = {
        "rows": int(len(df)),
        "feature_count": int(len(feature_list)),
        "feature_list": feature_list,
        "preprocessing_config": preprocessing_config,
    }
    return X, y, feature_list, preprocessing_artifact


def train_step(
    X_train: pd.DataFrame,
    y_train: pd.Series,
    config: PipelineConfig,
    model_params: Optional[Dict[str, Any]] = None,
) -> Tuple[Pipeline, Dict[str, Any]]:
    """
    Replace only the estimator construction/training body if you need your exact
    model behavior preserved. The MLflow integration around this function stays
    the same.
    """
    model_params = model_params or {}
    model = Pipeline(
        steps=[
            ("scaler", StandardScaler(with_mean=False)),
            (
                "clf",
                LogisticRegression(
                    max_iter=int(model_params.get("max_iter", 1000)),
                    C=float(model_params.get("C", 1.0)),
                    class_weight=model_params.get("class_weight", "balanced"),
                    random_state=int(model_params.get("random_state", config.random_state)),
                    solver=model_params.get("solver", "lbfgs"),
                ),
            ),
        ]
    )
    model.fit(X_train, y_train)
    train_artifact = {
        "model_type": "sklearn.pipeline.Pipeline",
        "model_params": model_params,
    }
    return model, train_artifact


def evaluation_step(
    model: Pipeline,
    X_test: pd.DataFrame,
    y_test: pd.Series,
    threshold: float,
) -> Tuple[Dict[str, float], pd.DataFrame]:
    y_proba = model.predict_proba(X_test)[:, 1]
    y_pred = (y_proba >= threshold).astype(int)

    metrics = {
        "auc": float(roc_auc_score(y_test, y_proba)),
        "precision": float(precision_score(y_test, y_pred, zero_division=0)),
        "recall": float(recall_score(y_test, y_pred, zero_division=0)),
        "pr_auc": float(average_precision_score(y_test, y_proba)),
        "suppression_rate": float(1.0 - y_pred.mean()),
        "event_loss": float(max(0.0, 1.0 - recall_score(y_test, y_pred, zero_division=0))),
    }
    eval_frame = pd.DataFrame(
        {
            "y_true": y_test.to_numpy(),
            "y_score": y_proba,
            "y_pred": y_pred,
        }
    )
    return metrics, eval_frame


def log_artifact_frame(frame: pd.DataFrame, artifact_name: str) -> str:
    tmp_dir = Path(tempfile.mkdtemp(prefix="mlflow_artifact_"))
    path = tmp_dir / artifact_name
    frame.to_csv(path, index=False)
    return str(path)


def run_pipeline(
    data_path: str | Path,
    config: PipelineConfig,
    preprocessing_config: Optional[Dict[str, Any]] = None,
    model_params: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    set_global_seed(config.seed)
    mlflow.set_experiment(config.experiment_name)

    with mlflow.start_run(run_name=config.pipeline_name) as parent_run:
        mlflow.set_tag("pipeline_name", config.pipeline_name)
        mlflow.set_tag("pipeline_version", config.version)
        mlflow.set_tag("user", config.user)
        mlflow.log_param("seed", config.seed)
        mlflow.log_param("target_col", config.target_col)
        mlflow.log_param("test_size", config.test_size)
        mlflow.log_param("random_state", config.random_state)

        # Step 1: data loading
        with mlflow.start_run(run_name="data_loading", nested=True) as data_run:
            df = load_data(data_path)
            mlflow.log_param("input_path", str(Path(data_path)))
            mlflow.log_metric("row_count", float(len(df)))
            mlflow.log_metric("column_count", float(len(df.columns)))
            data_profile = {
                "shape": [int(df.shape[0]), int(df.shape[1])],
                "columns": list(df.columns),
                "dtypes": {c: str(t) for c, t in df.dtypes.items()},
            }
            profile_path = Path(tempfile.mkdtemp(prefix="mlflow_profile_")) / "data_profile.json"
            profile_path.write_text(json.dumps(data_profile, indent=2), encoding="utf-8")
            mlflow.log_artifact(str(profile_path))

        # Step 2: preprocessing
        with mlflow.start_run(run_name="preprocessing", nested=True) as prep_run:
            X, y, feature_list, prep_artifact = preprocessing_step(df, config.target_col, preprocessing_config)
            mlflow.log_params({
                "feature_count": len(feature_list),
                "drop_columns": json.dumps((preprocessing_config or {}).get("drop_columns", [])),
            })
            mlflow.log_dict(prep_artifact, "preprocessing_artifact.json")
            features_path = Path(tempfile.mkdtemp(prefix="mlflow_features_")) / "features.json"
            features_path.write_text(json.dumps(feature_list, indent=2), encoding="utf-8")
            mlflow.log_artifact(str(features_path))

        X_train, X_test, y_train, y_test = train_test_split(
            X,
            y,
            test_size=config.test_size,
            random_state=config.random_state,
            stratify=y,
        )

        # Step 3: model training
        with mlflow.start_run(run_name="training", nested=True) as train_run:
            mlflow.log_params({
                "model_class": "LogisticRegression",
                "max_iter": int((model_params or {}).get("max_iter", 1000)),
                "C": float((model_params or {}).get("C", 1.0)),
                "class_weight": str((model_params or {}).get("class_weight", "balanced")),
            })
            model, train_artifact = train_step(X_train, y_train, config, model_params)
            mlflow.log_dict(train_artifact, "training_artifact.json")
            model_signature = infer_signature(X_train, model.predict_proba(X_train)[:, 1])
            mlflow.sklearn.log_model(
                sk_model=model,
                artifact_path="model",
                signature=model_signature,
                input_example=X_train.head(5),
            )

        # Step 4: evaluation
        with mlflow.start_run(run_name="evaluation", nested=True) as eval_run:
            metrics, eval_frame = evaluation_step(model, X_test, y_test, config.suppression_threshold)
            mlflow.log_metrics(metrics)
            mlflow.log_params({
                "suppression_threshold": config.suppression_threshold,
                "holdout_rows": int(len(X_test)),
            })
            eval_path = log_artifact_frame(eval_frame, "evaluation_predictions.csv")
            mlflow.log_artifact(eval_path)

        return {
            "pipeline_name": config.pipeline_name,
            "experiment_name": config.experiment_name,
            "run_id": parent_run.info.run_id,
            "metrics": metrics,
            "feature_list": feature_list,
            "model": model,
        }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="MLflow-tracked sklearn pipeline")
    parser.add_argument("--data-path", required=True, help="CSV or Parquet input data")
    parser.add_argument("--pipeline-name", required=True, help="Pipeline name used for MLflow experiment/run")
    parser.add_argument("--experiment-name", default=None, help="MLflow experiment name (defaults to pipeline name)")
    parser.add_argument("--target-col", required=True, help="Target/label column")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--test-size", type=float, default=0.2)
    parser.add_argument("--user", default=os.getenv("USER", "local"))
    parser.add_argument("--version", default="1.0.0")
    parser.add_argument("--suppression-threshold", type=float, default=0.5)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    config = PipelineConfig(
        pipeline_name=args.pipeline_name,
        experiment_name=args.experiment_name or args.pipeline_name,
        target_col=args.target_col,
        seed=args.seed,
        test_size=args.test_size,
        random_state=args.seed,
        user=args.user,
        version=args.version,
        suppression_threshold=args.suppression_threshold,
    )

    result = run_pipeline(
        data_path=args.data_path,
        config=config,
        preprocessing_config={},
        model_params={},
    )
    print(json.dumps({
        "run_id": result["run_id"],
        "metrics": result["metrics"],
        "feature_count": len(result["feature_list"]),
    }, indent=2))


if __name__ == "__main__":
    main()

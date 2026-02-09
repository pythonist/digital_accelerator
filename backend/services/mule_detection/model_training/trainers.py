from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple

import numpy as np
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.model_selection import StratifiedKFold, cross_val_score

try:
    import xgboost as xgb
except Exception:
    xgb = None


@dataclass(frozen=True)
class TrainResult:
    model: Any
    cv_mean_auc: Optional[float] = None
    cv_std_auc: Optional[float] = None


class BaseTrainer:
    model_type: str

    def default_params(self, random_state: int) -> Dict[str, Any]:
        raise NotImplementedError

    def train(
        self,
        X: np.ndarray,
        y: np.ndarray,
        *,
        cv_folds: int,
        random_state: int,
        model_params: Optional[Dict[str, Any]] = None,
    ) -> TrainResult:
        raise NotImplementedError


class XGBoostTrainer(BaseTrainer):
    model_type = "xgboost"

    def default_params(self, random_state: int) -> Dict[str, Any]:
        return {
            "n_estimators": 300,
            "max_depth": 6,
            "learning_rate": 0.05,
            "subsample": 0.9,
            "colsample_bytree": 0.9,
            "random_state": random_state,
            "eval_metric": "logloss",
            "use_label_encoder": False,
        }

    def train(
        self,
        X: np.ndarray,
        y: np.ndarray,
        *,
        cv_folds: int,
        random_state: int,
        model_params: Optional[Dict[str, Any]] = None,
    ) -> TrainResult:
        if xgb is None:
            raise ImportError("xgboost is not installed")

        params = self.default_params(random_state)
        if model_params:
            params.update(model_params)
        model = xgb.XGBClassifier(**params)

        y_int = np.asarray(y).astype(int)
        class_counts = np.bincount(y_int) if y_int.size else np.array([])
        min_class = int(class_counts.min()) if class_counts.size else 0
        folds = max(2, int(cv_folds))
        if min_class < 2 or folds > min_class:
            model.fit(X, y)
            return TrainResult(model=model, cv_mean_auc=None, cv_std_auc=None)
        cv = StratifiedKFold(n_splits=folds, shuffle=True, random_state=random_state)
        cv_scores = cross_val_score(model, X, y, cv=cv, scoring="roc_auc")

        model.fit(X, y)
        return TrainResult(model=model, cv_mean_auc=float(cv_scores.mean()), cv_std_auc=float(cv_scores.std()))


class RandomForestTrainer(BaseTrainer):
    model_type = "randomforest"

    def default_params(self, random_state: int) -> Dict[str, Any]:
        return {
            "n_estimators": 500,
            "max_depth": 12,
            "min_samples_split": 5,
            "min_samples_leaf": 2,
            "random_state": random_state,
            "class_weight": "balanced",
            "n_jobs": -1,
        }

    def train(
        self,
        X: np.ndarray,
        y: np.ndarray,
        *,
        cv_folds: int,
        random_state: int,
        model_params: Optional[Dict[str, Any]] = None,
    ) -> TrainResult:
        params = self.default_params(random_state)
        if model_params:
            params.update(model_params)
        model = RandomForestClassifier(**params)

        y_int = np.asarray(y).astype(int)
        class_counts = np.bincount(y_int) if y_int.size else np.array([])
        min_class = int(class_counts.min()) if class_counts.size else 0
        folds = max(2, int(cv_folds))
        if min_class < 2 or folds > min_class:
            model.fit(X, y)
            return TrainResult(model=model, cv_mean_auc=None, cv_std_auc=None)
        cv = StratifiedKFold(n_splits=folds, shuffle=True, random_state=random_state)
        cv_scores = cross_val_score(model, X, y, cv=cv, scoring="roc_auc")

        model.fit(X, y)
        return TrainResult(model=model, cv_mean_auc=float(cv_scores.mean()), cv_std_auc=float(cv_scores.std()))


class IsolationForestTrainer(BaseTrainer):
    model_type = "isolation_forest"

    def default_params(self, random_state: int) -> Dict[str, Any]:
        return {
            "n_estimators": 300,
            "contamination": 0.1,
            "random_state": random_state,
            "n_jobs": -1,
        }

    def train(
        self,
        X: np.ndarray,
        y: np.ndarray,
        *,
        cv_folds: int,
        random_state: int,
        model_params: Optional[Dict[str, Any]] = None,
    ) -> TrainResult:
        params = self.default_params(random_state)
        if model_params:
            params.update(model_params)
        model = IsolationForest(**params)
        model.fit(X)
        return TrainResult(model=model, cv_mean_auc=None, cv_std_auc=None)


def get_trainer(model_type: str) -> BaseTrainer:
    mt = str(model_type or "").strip().lower()
    if mt == "xgboost":
        # Fallback to RandomForest if xgboost unavailable
        return XGBoostTrainer() if xgb is not None else RandomForestTrainer()
    if mt == "randomforest":
        return RandomForestTrainer()
    if mt == "isolation_forest":
        return IsolationForestTrainer()
    raise ValueError(f"Unknown model type: {model_type}")

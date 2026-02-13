from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple

import numpy as np
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.cluster import KMeans, DBSCAN
from sklearn.decomposition import PCA
from sklearn.metrics import pairwise_distances
from sklearn.model_selection import StratifiedKFold, cross_val_score

try:
    import xgboost as xgb
except Exception:
    xgb = None

try:
    import lightgbm as lgb
except Exception:
    lgb = None


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

class LogisticTrainer(BaseTrainer):
    model_type = "logistic"

    def default_params(self, random_state: int) -> Dict[str, Any]:
        return {
            "C": 1.0,
            "max_iter": 500,
            "solver": "lbfgs",
            "class_weight": "balanced",
            "random_state": random_state,
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
        model = LogisticRegression(**params)

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


class LightGBMTrainer(BaseTrainer):
    model_type = "lightgbm"

    def default_params(self, random_state: int) -> Dict[str, Any]:
        return {
            "n_estimators": 600,
            "learning_rate": 0.05,
            "num_leaves": 31,
            "subsample": 0.9,
            "colsample_bytree": 0.9,
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
        if lgb is None:
            raise ImportError("lightgbm is not installed")
        params = self.default_params(random_state)
        if model_params:
            params.update(model_params)
        model = lgb.LGBMClassifier(**params)

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


class KMeansAnomalyModel:
    def __init__(self, *, n_clusters: int = 8, random_state: int = 42):
        self.n_clusters = int(n_clusters)
        self.random_state = int(random_state)
        self.kmeans = KMeans(n_clusters=self.n_clusters, random_state=self.random_state, n_init="auto")
        self.q05 = 0.0
        self.q95 = 1.0

    def fit(self, X: np.ndarray):
        self.kmeans.fit(X)
        d = self._distance(X)
        self.q05 = float(np.quantile(d, 0.05)) if len(d) else 0.0
        self.q95 = float(np.quantile(d, 0.95)) if len(d) else 1.0
        if self.q95 <= self.q05:
            self.q95 = self.q05 + 1.0
        return self

    def _distance(self, X: np.ndarray) -> np.ndarray:
        centers = np.asarray(self.kmeans.cluster_centers_)
        if centers.size == 0:
            return np.zeros(X.shape[0])
        d = pairwise_distances(X, centers, metric="euclidean")
        return np.min(d, axis=1)

    def decision_function(self, X: np.ndarray) -> np.ndarray:
        return self._distance(X)

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        d = self._distance(X)
        s = (d - self.q05) / (self.q95 - self.q05)
        s = np.clip(s, 0.0, 1.0)
        return np.vstack([1.0 - s, s]).T

    def predict(self, X: np.ndarray) -> np.ndarray:
        p = self.predict_proba(X)[:, 1]
        return (p >= 0.5).astype(int)

    @property
    def cluster_centers_(self):
        return self.kmeans.cluster_centers_


class DBSCANAnomalyModel:
    def __init__(self, *, eps: float = 0.8, min_samples: int = 10):
        self.eps = float(eps)
        self.min_samples = int(min_samples)
        self.dbscan = DBSCAN(eps=self.eps, min_samples=self.min_samples, n_jobs=-1)
        self.core_samples_ = None

    def fit(self, X: np.ndarray):
        self.dbscan.fit(X)
        core_idx = getattr(self.dbscan, "core_sample_indices_", None)
        if core_idx is None or len(core_idx) == 0:
            self.core_samples_ = None
            return self
        core = np.asarray(X)[np.asarray(core_idx)]
        if len(core) > 4000:
            rng = np.random.default_rng(7)
            core = core[rng.choice(len(core), size=4000, replace=False)]
        self.core_samples_ = core
        return self

    def decision_function(self, X: np.ndarray) -> np.ndarray:
        if self.core_samples_ is None or len(self.core_samples_) == 0:
            return np.zeros(X.shape[0])
        d = pairwise_distances(X, self.core_samples_, metric="euclidean")
        return np.min(d, axis=1)

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        d = self.decision_function(X)
        s = d / max(self.eps, 1e-9)
        s = np.clip(s, 0.0, 1.0)
        return np.vstack([1.0 - s, s]).T

    def predict(self, X: np.ndarray) -> np.ndarray:
        p = self.predict_proba(X)[:, 1]
        return (p >= 0.5).astype(int)


class PCAReconstructionAnomalyModel:
    def __init__(self, *, n_components: int = 10, random_state: int = 42):
        self.n_components = int(n_components)
        self.random_state = int(random_state)
        self.pca = PCA(n_components=self.n_components, random_state=self.random_state)
        self.q50 = 0.0
        self.q95 = 1.0

    def fit(self, X: np.ndarray):
        n = int(min(self.n_components, max(1, min(X.shape[0], X.shape[1]))))
        self.pca = PCA(n_components=n, random_state=self.random_state)
        self.pca.fit(X)
        e = self._recon_error(X)
        self.q50 = float(np.quantile(e, 0.50)) if len(e) else 0.0
        self.q95 = float(np.quantile(e, 0.95)) if len(e) else 1.0
        if self.q95 <= self.q50:
            self.q95 = self.q50 + 1.0
        return self

    def _recon(self, X: np.ndarray) -> np.ndarray:
        z = self.pca.transform(X)
        return self.pca.inverse_transform(z)

    def _recon_error(self, X: np.ndarray) -> np.ndarray:
        r = self._recon(X)
        err = np.mean((np.asarray(X) - np.asarray(r)) ** 2, axis=1)
        return np.asarray(err).reshape(-1)

    def decision_function(self, X: np.ndarray) -> np.ndarray:
        return self._recon_error(X)

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        e = self._recon_error(X)
        s = (e - self.q50) / (self.q95 - self.q50)
        s = np.clip(s, 0.0, 1.0)
        return np.vstack([1.0 - s, s]).T

    def predict(self, X: np.ndarray) -> np.ndarray:
        p = self.predict_proba(X)[:, 1]
        return (p >= 0.5).astype(int)

    def reconstruction_residual(self, X: np.ndarray) -> np.ndarray:
        r = self._recon(X)
        return np.asarray(X) - np.asarray(r)


class KMeansTrainer(BaseTrainer):
    model_type = "kmeans"

    def default_params(self, random_state: int) -> Dict[str, Any]:
        return {"n_clusters": 8, "random_state": random_state}

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
        model = KMeansAnomalyModel(n_clusters=int(params.get("n_clusters", 8)), random_state=int(params.get("random_state", random_state)))
        model.fit(X)
        return TrainResult(model=model, cv_mean_auc=None, cv_std_auc=None)


class DBSCANTrainer(BaseTrainer):
    model_type = "dbscan"

    def default_params(self, random_state: int) -> Dict[str, Any]:
        return {"eps": 0.8, "min_samples": 10}

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
        model = DBSCANAnomalyModel(eps=float(params.get("eps", 0.8)), min_samples=int(params.get("min_samples", 10)))
        model.fit(X)
        return TrainResult(model=model, cv_mean_auc=None, cv_std_auc=None)


class PCAAutoencoderTrainer(BaseTrainer):
    model_type = "pca_autoencoder"

    def default_params(self, random_state: int) -> Dict[str, Any]:
        return {"n_components": 10, "random_state": random_state}

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
        model = PCAReconstructionAnomalyModel(n_components=int(params.get("n_components", 10)), random_state=int(params.get("random_state", random_state)))
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
    if mt == "logistic":
        return LogisticTrainer()
    if mt in ["lightgbm", "lgbm"]:
        return LightGBMTrainer()
    if mt == "kmeans":
        return KMeansTrainer()
    if mt == "dbscan":
        return DBSCANTrainer()
    if mt in ["pca_autoencoder", "autoencoder"]:
        return PCAAutoencoderTrainer()
    raise ValueError(f"Unknown model type: {model_type}")

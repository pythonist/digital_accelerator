from __future__ import annotations

import pickle
import sys
import types
from pathlib import Path
from typing import Any

import numpy as np


def _install_legacy_gb_losses_alias() -> None:
    if "sklearn.ensemble._gb_losses" in sys.modules:
        return
    try:
        from sklearn._loss.loss import (
            AbsoluteError,
            ExponentialLoss as ModernExponentialLoss,
            HalfBinomialLoss,
            HalfMultinomialLoss,
            HalfSquaredError,
            HuberLoss,
            PinballLoss,
        )
    except Exception:
        return

    module = types.ModuleType("sklearn.ensemble._gb_losses")

    def _restore_state(instance: Any, state: dict[str, Any] | None = None) -> Any:
        payload = dict(state or {})
        cls_name = type(instance).__name__

        if cls_name == "BinomialDeviance":
            HalfBinomialLoss.__init__(instance)
        elif cls_name == "MultinomialDeviance":
            n_classes = int(payload.get("K") or payload.get("n_classes") or 3)
            HalfMultinomialLoss.__init__(instance, n_classes=max(n_classes, 3))
        elif cls_name == "LeastSquaresError":
            HalfSquaredError.__init__(instance)
        elif cls_name == "LeastAbsoluteError":
            AbsoluteError.__init__(instance)
        elif cls_name == "HuberLossFunction":
            quantile = float(payload.get("alpha", payload.get("quantile", 0.9)) or 0.9)
            HuberLoss.__init__(instance, quantile=quantile)
        elif cls_name == "QuantileLossFunction":
            quantile = float(payload.get("alpha", payload.get("quantile", 0.5)) or 0.5)
            PinballLoss.__init__(instance, quantile=quantile)
        elif cls_name == "ExponentialLoss":
            ModernExponentialLoss.__init__(instance)

        for key, value in payload.items():
            if key == "alpha" and cls_name in {"HuberLossFunction", "QuantileLossFunction"}:
                setattr(instance, "quantile", value)
            setattr(instance, key, value)
        return instance

    class BinomialDeviance(HalfBinomialLoss):
        __module__ = "sklearn.ensemble._gb_losses"
        __qualname__ = "BinomialDeviance"

        def __setstate__(self, state: dict[str, Any]) -> None:
            _restore_state(self, state)

    class MultinomialDeviance(HalfMultinomialLoss):
        __module__ = "sklearn.ensemble._gb_losses"
        __qualname__ = "MultinomialDeviance"

        def __setstate__(self, state: dict[str, Any]) -> None:
            _restore_state(self, state)

    class LeastSquaresError(HalfSquaredError):
        __module__ = "sklearn.ensemble._gb_losses"
        __qualname__ = "LeastSquaresError"

        def __setstate__(self, state: dict[str, Any]) -> None:
            _restore_state(self, state)

    class LeastAbsoluteError(AbsoluteError):
        __module__ = "sklearn.ensemble._gb_losses"
        __qualname__ = "LeastAbsoluteError"

        def __setstate__(self, state: dict[str, Any]) -> None:
            _restore_state(self, state)

    class HuberLossFunction(HuberLoss):
        __module__ = "sklearn.ensemble._gb_losses"
        __qualname__ = "HuberLossFunction"

        def __setstate__(self, state: dict[str, Any]) -> None:
            _restore_state(self, state)

    class QuantileLossFunction(PinballLoss):
        __module__ = "sklearn.ensemble._gb_losses"
        __qualname__ = "QuantileLossFunction"

        def __setstate__(self, state: dict[str, Any]) -> None:
            _restore_state(self, state)

    class ExponentialLoss(ModernExponentialLoss):
        __module__ = "sklearn.ensemble._gb_losses"
        __qualname__ = "ExponentialLoss"

        def __setstate__(self, state: dict[str, Any]) -> None:
            _restore_state(self, state)

    module.BinomialDeviance = BinomialDeviance
    module.MultinomialDeviance = MultinomialDeviance
    module.LeastSquaresError = LeastSquaresError
    module.LeastAbsoluteError = LeastAbsoluteError
    module.HuberLossFunction = HuberLossFunction
    module.QuantileLossFunction = QuantileLossFunction
    module.ExponentialLoss = ExponentialLoss
    sys.modules["sklearn.ensemble._gb_losses"] = module


def _patch_estimator_compat(obj: Any, seen: set[int] | None = None) -> Any:
    if seen is None:
        seen = set()
    obj_id = id(obj)
    if obj_id in seen:
        return obj
    seen.add(obj_id)

    if isinstance(obj, dict):
        for value in obj.values():
            _patch_estimator_compat(value, seen)
        return obj
    if isinstance(obj, np.ndarray):
        for value in obj.flat:
            _patch_estimator_compat(value, seen)
        return obj
    if isinstance(obj, (list, tuple, set)):
        for value in obj:
            _patch_estimator_compat(value, seen)
        return obj

    if hasattr(obj, "tree_") and not hasattr(obj, "monotonic_cst"):
        try:
            setattr(obj, "monotonic_cst", None)
        except Exception:
            pass

    cls_name = type(obj).__name__
    if cls_name in {
        "BinomialDeviance",
        "MultinomialDeviance",
        "LeastSquaresError",
        "LeastAbsoluteError",
        "HuberLossFunction",
        "QuantileLossFunction",
        "ExponentialLoss",
    } and not hasattr(obj, "link"):
        try:
            state = dict(getattr(obj, "__dict__", {}) or {})
            refreshed = type(obj)()
            for key, value in state.items():
                if key == "alpha" and hasattr(refreshed, "quantile"):
                    setattr(refreshed, "quantile", value)
                setattr(refreshed, key, value)
            for key, value in getattr(refreshed, "__dict__", {}).items():
                if not hasattr(obj, key):
                    setattr(obj, key, value)
        except Exception:
            pass

    for attr_name in (
        "estimators_",
        "estimator_",
        "base_estimator",
        "base_estimator_",
        "classifier",
        "classifier_",
        "calibrated_classifiers_",
        "classes_",
    ):
        try:
            attr_value = getattr(obj, attr_name)
        except Exception:
            continue
        _patch_estimator_compat(attr_value, seen)
    return obj


def load_pickle_compat(file_or_path: Any) -> Any:
    _install_legacy_gb_losses_alias()
    if isinstance(file_or_path, (str, Path)):
        with open(file_or_path, "rb") as handle:
            payload = pickle.load(handle)
    else:
        payload = pickle.load(file_or_path)
    return _patch_estimator_compat(payload)

import sys
import platform
import traceback


def _guard_import(module_name: str):
    try:
        __import__(module_name)
        return True, None
    except Exception as e:
        return False, repr(e)


def detect_optional_libs():
    """Detect availability of risky/optional C-extension libraries"""
    libs = [
        "faiss",
        "shap",
        "torch",
        "xgboost",
        "numpy",
        "scipy",
    ]
    out = {}
    for m in libs:
        ok, err = _guard_import(m)
        out[m] = {"available": ok, "error": err}
    return out


def get_python_info():
    vi = sys.version_info
    return {
        "python_version": f"{vi.major}.{vi.minor}.{vi.micro}",
        "platform": platform.platform(),
        "implementation": platform.python_implementation(),
    }


def get_supported_features(registry=None, pdf_service_available: bool = False):
    """Report feature capabilities without crashing"""
    # Base features inferred from registry status
    modules = (registry.status() if registry else {})
    def _is_available(name):
        info = modules.get(name)
        if not info:
            return False
        return bool(info.get("enabled")) and info.get("status") != "failed"

    features = {
        "ai": _is_available("llm_provider"),
        "docs_rag": _is_available("docs_rag"),
        "vector_search": _is_available("rag"),
        "graph": _is_available("graph"),
        "calibration_db": _is_available("calibration_db"),
        "percentile_engine": _is_available("percentile_engine"),
        "threshold_simulator": _is_available("threshold_simulator"),
        "pdf_reporting": bool(pdf_service_available),
    }
    return features


def log_startup_compat(registry=None, pdf_service_available: bool = False):
    info = get_python_info()
    opt_libs = detect_optional_libs()
    features = get_supported_features(registry, pdf_service_available)

    disabled = [k for k, v in features.items() if not v]
    missing_libs = [k for k, v in opt_libs.items() if not v["available"]]

    print("\n" + "=" * 70)
    print("COMPATIBILITY SUMMARY")
    print("=" * 70)
    print(f"Python        : {info['python_version']} ({info['implementation']})")
    print(f"Platform      : {info['platform']}")
    print(f"Missing libs  : {', '.join(missing_libs) if missing_libs else 'None'}")
    print(f"Disabled feats: {', '.join(disabled) if disabled else 'None'}")
    print("=" * 70 + "\n")

import os
import time
import threading
import traceback
from typing import Callable, Dict, Optional


class ModuleStatus:
    NOT_LOADED = "not_loaded"
    DISABLED = "disabled"
    LOADING = "loading"
    READY = "ready"
    FAILED = "failed"


class ModuleRecord:
    def __init__(self, name: str, loader: Callable[[], object], feature_flag_env: Optional[str] = None):
        self.name = name
        self.loader = loader
        self.feature_flag_env = feature_flag_env
        self.instance = None
        self.status = ModuleStatus.NOT_LOADED
        self.error = None
        self.loaded_at = None
        self.load_duration_sec = None


class ModuleRegistry:
    def __init__(self):
        self._modules: Dict[str, ModuleRecord] = {}
        self._lock = threading.RLock()

    def register(self, name: str, loader: Callable[[], object], feature_flag_env: Optional[str] = None):
        with self._lock:
            self._modules[name] = ModuleRecord(name, loader, feature_flag_env)

    def is_enabled(self, rec: ModuleRecord) -> bool:
        if not rec.feature_flag_env:
            return True
        val = os.getenv(rec.feature_flag_env, "true").lower()
        return val not in {"0", "false", "no", "disabled"}

    def get(self, name: str):
        rec = self._modules.get(name)
        if not rec:
            raise KeyError(f"Module '{name}' not registered")
        # Feature flag check
        if not self.is_enabled(rec):
            rec.status = ModuleStatus.DISABLED
            return None
        # Return cached
        if rec.instance is not None and rec.status == ModuleStatus.READY:
            return rec.instance
        # Lazy load
        with self._lock:
            # Double-check after acquiring the lock
            if rec.instance is not None and rec.status == ModuleStatus.READY:
                return rec.instance
            start = time.perf_counter()
            rec.status = ModuleStatus.LOADING
            rec.error = None
            try:
                print(f"[Registry] Loading module '{name}'...")
                inst = rec.loader()
                rec.instance = inst
                rec.status = ModuleStatus.READY
                rec.loaded_at = time.time()
                rec.load_duration_sec = round(time.perf_counter() - start, 3)
                print(f"[Registry] Module '{name}' loaded in {rec.load_duration_sec}s")
                return inst
            except Exception as e:
                rec.status = ModuleStatus.FAILED
                rec.error = repr(e)
                traceback.print_exc()
                return None

    def available(self, name: str) -> bool:
        rec = self._modules.get(name)
        if not rec:
            return False
        return self.is_enabled(rec)

    def status(self) -> Dict[str, Dict[str, Optional[object]]]:
        out = {}
        for name, rec in self._modules.items():
            out[name] = {
                "status": rec.status,
                "enabled": self.is_enabled(rec),
                "loaded_at": rec.loaded_at,
                "load_duration_sec": rec.load_duration_sec,
                "error": rec.error,
            }
        return out

    def warmup_async(self, names: Optional[list] = None, delay_sec: float = 0.0):
        """Warm modules in background without blocking boot"""
        def _run():
            if delay_sec:
                time.sleep(delay_sec)
            targets = names or list(self._modules.keys())
            for n in targets:
                try:
                    self.get(n)
                except Exception:
                    # Errors are captured inside get(); continue
                    pass
        threading.Thread(target=_run, daemon=True).start()

    def warmup_defaults(self, delay_sec: float = 0.1):
        """Auto warm safe, non-heavy modules without env config."""
        # Keep this short to avoid cold-start penalties
        defaults = [m for m in ["calibration_db"] if m in self._modules]
        if defaults:
            self.warmup_async(names=defaults, delay_sec=delay_sec)


# Global registry (import-safe)
REGISTRY = ModuleRegistry()


from __future__ import annotations

import atexit
import os
import re
import threading
import time
from pathlib import Path
from typing import Iterable


class CloudStateSync:
    """Best-effort GCS snapshot persistence for Cloud Run demo state.

    Cloud Run container files are ephemeral. The app still works on local files
    for DuckDB/SQLite compatibility, while this helper restores those files on
    startup and snapshots them after mutating API calls when configured.
    """

    def __init__(self) -> None:
        self.bucket_name = str(os.getenv("CLOUD_STATE_BUCKET") or "").strip()
        self.prefix = str(os.getenv("CLOUD_STATE_PREFIX") or "workbench-state").strip().strip("/")
        raw_paths = str(os.getenv("CLOUD_STATE_PATHS") or "data,env").strip()
        self.relative_paths = [p.strip().strip("/\\") for p in re.split(r"[,;]", raw_paths) if p.strip()]
        self.sync_mode = str(os.getenv("CLOUD_STATE_SYNC_MODE") or "async").strip().lower()
        try:
            self.debounce_seconds = max(0.25, float(os.getenv("CLOUD_STATE_DEBOUNCE_SECONDS") or "2"))
        except Exception:
            self.debounce_seconds = 2.0

        self.backend_root = Path(__file__).resolve().parents[1]
        self._client = None
        self._bucket = None
        self._timer: threading.Timer | None = None
        self._lock = threading.RLock()
        self._syncing = False
        self._pending = False
        self._restored = False
        self._enabled_cache: bool | None = None

    def enabled(self) -> bool:
        if self._enabled_cache is not None:
            return self._enabled_cache
        if not self.bucket_name:
            self._enabled_cache = False
            return False
        try:
            from google.cloud import storage  # noqa: F401
        except Exception as exc:
            print(f"[CloudState] Disabled: google-cloud-storage unavailable ({exc})")
            self._enabled_cache = False
            return False
        self._enabled_cache = True
        return True

    def _get_bucket(self):
        if self._bucket is not None:
            return self._bucket
        from google.cloud import storage

        self._client = storage.Client()
        self._bucket = self._client.bucket(self.bucket_name)
        return self._bucket

    def _tracked_roots(self) -> list[tuple[str, Path]]:
        roots: list[tuple[str, Path]] = []
        for rel in self.relative_paths:
            path = (self.backend_root / rel).resolve()
            try:
                path.relative_to(self.backend_root)
            except ValueError:
                continue
            roots.append((rel.replace("\\", "/"), path))
        return roots

    def _blob_prefix_for(self, rel: str) -> str:
        return f"{self.prefix}/{rel}".strip("/")

    def _iter_local_files(self, root: Path) -> Iterable[Path]:
        if not root.exists():
            return []
        skipped_dirs = {"__pycache__", ".pytest_cache", ".mypy_cache"}
        skipped_suffixes = {".tmp", ".lock"}

        def _walk() -> Iterable[Path]:
            for path in root.rglob("*"):
                if any(part in skipped_dirs for part in path.parts):
                    continue
                if not path.is_file():
                    continue
                if path.suffix.lower() in skipped_suffixes:
                    continue
                yield path

        return _walk()

    def restore_once(self) -> None:
        if self._restored or not self.enabled():
            return
        with self._lock:
            if self._restored:
                return
            started = time.perf_counter()
            restored_count = 0
            try:
                bucket = self._get_bucket()
                for rel, root in self._tracked_roots():
                    root.mkdir(parents=True, exist_ok=True)
                    prefix = self._blob_prefix_for(rel)
                    for blob in bucket.list_blobs(prefix=f"{prefix}/"):
                        suffix = blob.name[len(prefix) :].lstrip("/")
                        if not suffix or suffix.endswith("/"):
                            continue
                        target = (root / suffix).resolve()
                        try:
                            target.relative_to(root)
                        except ValueError:
                            continue
                        target.parent.mkdir(parents=True, exist_ok=True)
                        blob.download_to_filename(str(target))
                        restored_count += 1
                elapsed = (time.perf_counter() - started) * 1000.0
                print(f"[CloudState] Restored {restored_count} file(s) from gs://{self.bucket_name}/{self.prefix} in {elapsed:.1f} ms")
            except Exception as exc:
                print(f"[CloudState] Restore failed: {exc}")
            finally:
                self._restored = True

    def sync_now(self, reason: str = "manual") -> None:
        if not self.enabled():
            return
        with self._lock:
            if self._syncing:
                self._pending = True
                return
            self._syncing = True
            self._pending = False
            self._timer = None
        try:
            started = time.perf_counter()
            bucket = self._get_bucket()
            uploaded = 0
            deleted = 0
            delete_remote = str(os.getenv("CLOUD_STATE_DELETE_REMOTE") or "true").strip().lower() in {"1", "true", "yes", "on"}

            for rel, root in self._tracked_roots():
                root.mkdir(parents=True, exist_ok=True)
                prefix = self._blob_prefix_for(rel)
                local_names: set[str] = set()
                for file_path in self._iter_local_files(root):
                    local_rel = file_path.relative_to(root).as_posix()
                    blob_name = f"{prefix}/{local_rel}"
                    local_names.add(blob_name)
                    bucket.blob(blob_name).upload_from_filename(str(file_path))
                    uploaded += 1

                if delete_remote:
                    for blob in bucket.list_blobs(prefix=f"{prefix}/"):
                        if blob.name not in local_names:
                            blob.delete()
                            deleted += 1

            elapsed = (time.perf_counter() - started) * 1000.0
            print(
                f"[CloudState] Synced {uploaded} file(s), deleted {deleted} stale object(s) "
                f"to gs://{self.bucket_name}/{self.prefix} after {reason} in {elapsed:.1f} ms"
            )
        except Exception as exc:
            print(f"[CloudState] Sync failed after {reason}: {exc}")
        finally:
            run_again = False
            with self._lock:
                self._syncing = False
                run_again = self._pending
                self._pending = False
            if run_again:
                self.schedule_sync("pending-change")

    def schedule_sync(self, reason: str = "api-write") -> None:
        if not self.enabled():
            return
        if self.sync_mode == "sync":
            self.sync_now(reason)
            return
        with self._lock:
            self._pending = True
            if self._timer is not None and self._timer.is_alive():
                return
            self._timer = threading.Timer(self.debounce_seconds, self.sync_now, kwargs={"reason": reason})
            self._timer.daemon = True
            self._timer.start()


cloud_state_sync = CloudStateSync()


def restore_cloud_state() -> None:
    cloud_state_sync.restore_once()


def schedule_cloud_state_sync(reason: str = "api-write") -> None:
    cloud_state_sync.schedule_sync(reason)


def _sync_on_shutdown() -> None:
    enabled = str(os.getenv("CLOUD_STATE_SYNC_ON_SHUTDOWN") or "true").strip().lower()
    if enabled in {"0", "false", "no", "off"}:
        return
    cloud_state_sync.sync_now("shutdown")


atexit.register(_sync_on_shutdown)

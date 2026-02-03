from contextlib import contextmanager
from pathlib import Path
import duckdb
import threading
import time


class DuckDBPool:
    def __init__(self):
        self._global_lock = threading.Lock()
        self._locks = {}

    def _get_lock(self, db_path_str: str) -> threading.RLock:
        with self._global_lock:
            lock = self._locks.get(db_path_str)
            if lock is None:
                lock = threading.RLock()
                self._locks[db_path_str] = lock
            return lock

    def _open_conn(self, db_path_str: str, read_only: bool) -> duckdb.DuckDBPyConnection:
        conn = duckdb.connect(db_path_str, read_only=bool(read_only))
        try:
            conn.execute("SET preserve_insertion_order=false")
        except Exception:
            pass
        try:
            conn.execute("PRAGMA busy_timeout=5000")
        except Exception:
            pass
        return conn

    @contextmanager
    def connection(self, db_path: Path, read_only: bool = False):
        db_path_str = str(db_path)
        Path(db_path_str).parent.mkdir(parents=True, exist_ok=True)
        lock = self._get_lock(db_path_str)
        with lock:
            last_err = None
            conn = None
            for attempt in range(10):
                try:
                    conn = self._open_conn(db_path_str, read_only=read_only)
                    break
                except Exception as e:
                    last_err = e
                    time.sleep(min(0.05 * (2 ** attempt), 1.0))
            if conn is None:
                raise last_err
            try:
                yield conn
            finally:
                try:
                    conn.close()
                except Exception:
                    pass


duckdb_pool = DuckDBPool()

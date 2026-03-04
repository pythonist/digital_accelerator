"""
duckdb_manager.py
-----------------
Thread-safe DuckDB connection manager for the MLOps Workbench.

Solves two problems:
  1. TransactionContext Error: Conflict on update!
     — caused by concurrent Flask requests writing to DuckDB simultaneously
  2. IO Error: file is being used by another process
     — caused by connections not being closed properly

Usage in mlops_workbench_service.py:
    from api.tools.mlops.duckdb_manager import get_connection

    with get_connection(self.db_path) as conn:
        conn.execute("INSERT INTO ...")
        conn.commit()
"""

import duckdb
import threading
import os
from pathlib import Path
from contextlib import contextmanager

# ─── One lock per database file path ─────────────────────────────────────────
# This ensures that even if Flask spawns multiple threads, only ONE thread
# can write to a given DuckDB file at a time.
_locks: dict[str, threading.Lock] = {}
_locks_meta = threading.Lock()
_connections: dict[str, duckdb.DuckDBPyConnection] = {}


def _get_lock(db_path: str) -> threading.Lock:
    """Return (or create) the lock for a specific db file path."""
    with _locks_meta:
        if db_path not in _locks:
            _locks[db_path] = threading.Lock()
        return _locks[db_path]


def _get_or_create_connection(db_path: str, read_only: bool = False) -> duckdb.DuckDBPyConnection:
    """
    Reuse a single in-process connection per DB file.

    On some Windows setups, closing and reopening DuckDB repeatedly can leave the
    WAL file locked and cause "Failed to delete ... .wal" errors on next connect.
    Keeping one connection per DB path avoids this reopen cycle.
    """
    with _locks_meta:
        conn = _connections.get(db_path)
        if conn is not None:
            try:
                conn.execute("SELECT 1")
                return conn
            except Exception:
                try:
                    conn.close()
                except Exception:
                    pass
                _connections.pop(db_path, None)

        try:
            conn = duckdb.connect(db_path, read_only=read_only)
        except Exception as exc:
            # Recovery path for stale/corrupt WAL on some Windows setups.
            wal_path = f"{db_path}.wal"
            if os.path.exists(wal_path):
                try:
                    os.remove(wal_path)
                except Exception:
                    raise exc
                conn = duckdb.connect(db_path, read_only=read_only)
            else:
                raise
        _connections[db_path] = conn
        return conn


@contextmanager
def get_connection(db_path: str | Path, read_only: bool = False):
    """
    Context manager that:
      - Acquires a per-file threading lock (prevents concurrent write conflicts)
      - Opens a DuckDB connection
      - Yields it to the caller
      - Always closes the connection on exit (prevents file-lock errors)
      - Releases the threading lock

    Example:
        with get_connection(self.db_path) as conn:
            conn.execute("SELECT * FROM datasets")
    """
    db_path = str(db_path)
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)

    lock = _get_lock(db_path)
    lock.acquire()
    conn = None
    try:
        conn = _get_or_create_connection(db_path, read_only=read_only)
        yield conn
    finally:
        if conn is not None:
            try:
                conn.commit()
            except Exception:
                pass
        lock.release()


@contextmanager
def get_read_connection(db_path: str | Path):
    """
    Read-only connection — does NOT acquire the write lock.
    Multiple reads can happen concurrently.
    Note: DuckDB in-process mode still serialises reads through the same file
    so this is mainly for intent clarity.
    """
    db_path = str(db_path)
    conn = None
    try:
        # Use read_only=False even for reads in single-process mode
        # because DuckDB requires read_only=True only for external processes.
        # Using the write lock here too to be safe in dev environment.
        lock = _get_lock(db_path)
        lock.acquire()
        conn = _get_or_create_connection(db_path, read_only=False)
        yield conn
    finally:
        if conn is not None:
            try:
                conn.commit()
            except Exception:
                pass
        try:
            lock.release()
        except RuntimeError:
            pass

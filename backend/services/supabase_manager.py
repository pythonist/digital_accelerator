"""
Supabase Database Manager for AML Investigation System.
Provides transparent data access to Supabase PostgreSQL with seamless fallback to SQLite.
"""

import os
import sys
import traceback
from typing import Any, Dict, List, Optional
from dotenv import load_dotenv

load_dotenv()

try:
    from supabase import create_client, Client
    _SUPABASE_AVAILABLE = True
except ImportError:
    _SUPABASE_AVAILABLE = False


class SupabaseManager:
    """
    Manages connections and operations with Supabase.
    Maintains compatibility with SQLite interfaces.
    """

    def __init__(self, url: Optional[str] = None, key: Optional[str] = None):
        self.url = url or os.getenv("SUPABASE_URL")
        # Clean URL if it has /rest/v1/ suffix
        if self.url:
            if self.url.endswith("/rest/v1/"):
                self.url = self.url[:-9]
            elif self.url.endswith("/rest/v1"):
                self.url = self.url[:-8]

        self.key = key or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        self.client: Optional[Client] = None
        self._is_connected = False
        self._init_client()

    def _init_client(self):
        if not _SUPABASE_AVAILABLE:
            print("[WARN] [SupabaseManager] 'supabase' python package not installed.")
            return

        if not self.url or not self.key:
            print("[WARN] [SupabaseManager] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")
            return

        try:
            self.client = create_client(self.url, self.key)
            self._is_connected = True
            print(f"[OK] [SupabaseManager] Connected to Supabase at: {self.url}")
        except Exception as e:
            print(f"[ERROR] [SupabaseManager] Connection failed: {e}")
            self._is_connected = False

    @property
    def is_connected(self) -> bool:
        return self._is_connected and self.client is not None

    def fetch_all(self, table_name: str, limit: int = 1000, filters: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """Fetch records from a Supabase table with optional filtering."""
        if not self.is_connected:
            return []
        try:
            query = self.client.table(table_name).select("*").limit(limit)
            if filters:
                for k, v in filters.items():
                    query = query.eq(k, v)
            response = query.execute()
            return response.data or []
        except Exception as e:
            print(f"[WARN] [SupabaseManager] Error fetching from {table_name}: {e}")
            return []

    def insert_batch(self, table_name: str, records: List[Dict[str, Any]], batch_size: int = 500) -> int:
        """Inserts or upserts a list of records in batches."""
        if not self.is_connected or not records:
            return 0
        
        inserted_total = 0
        for i in range(0, len(records), batch_size):
            batch = records[i:i + batch_size]
            try:
                self.client.table(table_name).upsert(batch).execute()
                inserted_total += len(batch)
            except Exception as e:
                print(f"[ERROR] [SupabaseManager] Batch insert failed on {table_name} (rows {i}-{i+len(batch)}): {e}")
                # Try single row fallback if batch fails
                for r in batch:
                    try:
                        self.client.table(table_name).upsert(r).execute()
                        inserted_total += 1
                    except Exception:
                        pass
        return inserted_total

    def table_exists(self, table_name: str) -> bool:
        """Check if a table exists in Supabase by running a limit 0 select."""
        if not self.is_connected:
            return False
        try:
            self.client.table(table_name).select("*").limit(1).execute()
            return True
        except Exception as e:
            err_msg = str(e)
            if "permission denied" in err_msg.lower():
                print(f"[WARN] Table '{table_name}' exists but permission was denied. Please run GRANT statements in SQL Editor.")
            return False


    # ============================================================
    # MLOps Specialized State Persistence
    # ============================================================

    def upsert_run_state(self, run_state: Dict[str, Any]) -> bool:
        """Upsert MLOps run state into Supabase mlops_run_state table."""
        if not self.is_connected:
            return False
        try:
            payload = {
                "run_id": run_state.get("run_id"),
                "tenant_id": run_state.get("tenant_id", "default"),
                "env_id": run_state.get("env_id", "default"),
                "pipeline_id": run_state.get("pipeline_id"),
                "pipeline_uuid": run_state.get("pipeline_uuid"),
                "pipeline_name": run_state.get("pipeline_name", ""),
                "pipeline_type": run_state.get("pipeline_type", "fcc"),
                "status": run_state.get("status", "running"),
                "current_step": run_state.get("current_step", "data_upload"),
                "steps_json": run_state.get("steps_json") or run_state.get("steps") or {},
                "created_at": run_state.get("created_at"),
                "updated_at": run_state.get("updated_at"),
                "completed_at": run_state.get("completed_at")
            }
            # Remove keys with None if creating
            payload = {k: v for k, v in payload.items() if v is not None}
            self.client.table("mlops_run_state").upsert(payload).execute()
            return True
        except Exception as e:
            # Silent fallback to local if table not ready
            return False

    def get_run_state_by_id(self, tenant_id: str, env_id: str, run_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve run state from Supabase mlops_run_state table."""
        if not self.is_connected:
            return None
        try:
            res = self.client.table("mlops_run_state").select("*").eq("run_id", run_id).limit(1).execute()
            if res.data and len(res.data) > 0:
                row = res.data[0]
                row["steps"] = row.get("steps_json") or {}
                return row
            return None
        except Exception:
            return None

    def upsert_workflow_session(self, session: Dict[str, Any]) -> bool:
        """Upsert MLOps UI session and active step into Supabase."""
        if not self.is_connected:
            return False
        try:
            payload = {
                "session_id": session.get("session_id"),
                "journey_key": session.get("journey_key"),
                "tenant_id": session.get("tenant_id", "default"),
                "env_id": session.get("env_id", "default"),
                "pipeline_type": session.get("pipeline_type", "fcc"),
                "pipeline_id": str(session.get("pipeline_id") or ""),
                "pipeline_name": session.get("pipeline_name", ""),
                "run_id": session.get("run_id"),
                "deployment_id": session.get("deployment_id"),
                "publish_id": session.get("publish_id"),
                "current_module": session.get("current_module"),
                "current_step": session.get("current_step"),
                "current_state_json": session.get("current_state_json") or {},
                "last_stable_step": session.get("last_stable_step"),
                "last_stable_state_json": session.get("last_stable_state_json") or {},
                "case_scope_json": session.get("case_scope_json") or {},
                "selected_case_id": session.get("selected_case_id"),
                "handoff_summary_json": session.get("handoff_summary_json") or {},
                "checkpoint_key": session.get("checkpoint_key"),
                "status": session.get("status", "active"),
                "updated_at": session.get("updated_at")
            }
            payload = {k: v for k, v in payload.items() if v is not None}
            self.client.table("mlops_workflow_sessions").upsert(payload).execute()
            return True
        except Exception:
            return False

    def get_workflow_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve workflow session from Supabase."""
        if not self.is_connected:
            return None
        try:
            res = self.client.table("mlops_workflow_sessions").select("*").eq("session_id", session_id).limit(1).execute()
            if res.data and len(res.data) > 0:
                return res.data[0]
            return None
        except Exception:
            return None


# Global singleton instance
supabase_manager = SupabaseManager()

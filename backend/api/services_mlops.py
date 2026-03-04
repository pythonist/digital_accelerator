"""
Lightweight service container for AML_BACKEND_PROFILE=mlops.

This avoids importing full investigation/calibration stacks while keeping the
core methods used by MLOps routes available.
"""

import os
import traceback

from services.metadata_manager import MetadataManager
from services.db_schema import DatabaseManager
from services.data_ingestion import DataIngestionService
from audit.audit_logger import AuditLogger


class MLOpsServiceContainer:
    def __init__(self):
        self.metadata_manager = None
        self.audit_logger = None
        self.investigation_db = None

    def init_services(self):
        try:
            print("[MLOps] Startup (light profile)...")
            self.metadata_manager = MetadataManager()
            self.audit_logger = AuditLogger()
            print("[MLOps] Core services ready.")
            return True
        except Exception:
            traceback.print_exc()
            return False

    def get_investigation_db(self, env_id: str, tenant_id: str) -> DatabaseManager:
        if not env_id:
            raise ValueError("Environment ID required")

        paths = [
            f"data/environments/{env_id}/database.db",
            f"data/environments/{env_id}/investigation.db",
            f"data/{tenant_id}/{env_id}/database.db",
            f"backend/data/environments/{env_id}/database.db",
        ]

        for path in paths:
            if os.path.exists(path):
                return DatabaseManager(path)

        if (
            self.metadata_manager
            and self.metadata_manager.active_env == env_id
            and self.investigation_db
        ):
            return self.investigation_db

        raise FileNotFoundError(f"Database not found for env: {env_id}")

    def get_data_ingestion_service(self, env_id: str, tenant_id: str):
        db = self.get_investigation_db(env_id, tenant_id)
        return DataIngestionService(db)

    def activate_case(self, case_name: str, tenant_id: str):
        """Minimal activation support used by environment routes."""
        if not tenant_id:
            raise ValueError("Tenant ID required")

        env_info = self.metadata_manager.activate_environment(case_name, tenant_id)
        paths = env_info.get("paths", {})

        if not paths:
            root = env_info.get("db_path", "").replace("aml_database.db", "")
            paths = {
                "investigation_db": env_info.get("db_path"),
                "vector_store": os.path.join(root, "investigation", "vector_store"),
            }

        if env_info.get("tenant_id") != tenant_id:
            raise Exception("Tenant mismatch")

        self.investigation_db = DatabaseManager(paths["investigation_db"])
        self.investigation_db.init_schema()
        return env_info


services = MLOpsServiceContainer()

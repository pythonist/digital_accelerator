"""
Master Dataset Version & Lineage Manager (AML / FCC MLOps)
==========================================================
Manages immutable, version-addressed Master Dataset artifacts and provides
APIs for downstream pipeline stages to consume exact version IDs (master_dataset_version_id)
rather than relying on volatile filenames.
"""

from __future__ import annotations

import json
import logging
import sqlite3
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import pandas as pd

from api.tools.mlops.duckdb_manager import get_connection

logger = logging.getLogger(__name__)


# ── Version Record Data Class ──────────────────────────────────────────────────

@dataclass
class MasterDatasetVersionRecord:
    dataset_version_id: str
    dataset_id: Optional[int]
    tenant_id: str
    env_id: str
    version_tag: str
    version_number: int
    output_name: str
    file_path: str
    file_size_bytes: int
    row_count: int
    column_count: int
    sha256_checksum: str
    primary_key: str
    grain: str
    plan_json: Dict[str, Any]
    source_dataset_ids: List[int]
    source_dataset_versions: Dict[str, str]
    transformations_json: List[Dict[str, Any]]
    relationships_json: List[Dict[str, Any]]
    validation_results_json: Optional[Dict[str, Any]]
    schema_json: Dict[str, Any]
    lineage_json: Dict[str, Any]
    execution_id: str
    created_at: str

    def to_dict(self) -> Dict[str, Any]:
        """Convert version record to JSON-serializable dictionary."""
        return asdict(self)


# ── Version Manager Class ──────────────────────────────────────────────────────

class MasterDatasetVersionManager:
    """
    Persists and retrieves immutable Master Dataset versions in database and storage.
    """

    def __init__(self, db_path: Union[str, Path], env_root: Union[str, Path]):
        self.db_path = Path(db_path)
        self.env_root = Path(env_root)
        self.data_dir = self.env_root / "data"
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self._init_db_schema()

    def _init_db_schema(self):
        """Initializes the mlops_master_dataset_versions table in DuckDB/SQLite."""
        try:
            with get_connection(self.db_path) as conn:
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS mlops_master_dataset_versions (
                        dataset_version_id VARCHAR PRIMARY KEY,
                        dataset_id BIGINT,
                        tenant_id VARCHAR DEFAULT 'default',
                        env_id VARCHAR DEFAULT 'default',
                        version_tag VARCHAR NOT NULL,
                        version_number INTEGER NOT NULL,
                        output_name VARCHAR NOT NULL,
                        file_path VARCHAR NOT NULL,
                        file_size_bytes BIGINT DEFAULT 0,
                        row_count BIGINT NOT NULL,
                        column_count INTEGER NOT NULL,
                        sha256_checksum VARCHAR NOT NULL,
                        primary_key VARCHAR NOT NULL,
                        grain VARCHAR NOT NULL,
                        plan_json TEXT,
                        source_dataset_ids TEXT,
                        source_dataset_versions TEXT,
                        transformations_json TEXT,
                        relationships_json TEXT,
                        validation_results_json TEXT,
                        schema_json TEXT,
                        lineage_json TEXT,
                        execution_id VARCHAR NOT NULL,
                        created_at VARCHAR NOT NULL
                    );
                    """
                )
        except Exception as e:
            logger.warning("Could not initialize mlops_master_dataset_versions table: %s", e)

    def register_version(
        self,
        tenant_id: str,
        env_id: str,
        build_result_dict: Dict[str, Any],
        plan_dict: Dict[str, Any],
        dataset_id: Optional[int] = None,
    ) -> MasterDatasetVersionRecord:
        """
        Creates an immutable, version-addressed copy of the built dataset
        and registers its lineage manifest in the database.
        """
        output_name = build_result_dict.get("output_filename", "master_dataset.csv").replace(".csv", "")
        raw_output_path = Path(build_result_dict.get("output_path"))

        # Determine next auto-incrementing version number for this dataset
        existing_versions = self.list_versions(tenant_id, env_id, output_name)
        next_ver_num = len(existing_versions) + 1
        ver_tag = build_result_dict.get("version_id") or f"v{next_ver_num}.0.0"

        # Unique version-addressed ID and immutable file copy
        dataset_version_id = f"mdv_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{ver_tag.replace('.', '_')}"
        versioned_filename = f"{output_name}_{ver_tag}.csv"
        versioned_file_path = self.data_dir / versioned_filename

        # Write immutable copy
        if raw_output_path.exists() and raw_output_path != versioned_file_path:
            import shutil
            shutil.copyfile(raw_output_path, versioned_file_path)
        elif not versioned_file_path.exists() and raw_output_path.exists():
            versioned_file_path = raw_output_path

        file_size = versioned_file_path.stat().st_size if versioned_file_path.exists() else 0

        # Build Sources Mapping
        sources = build_result_dict.get("sources_manifest", [])
        src_versions = {s.get("table_name"): s.get("sha256_checksum") for s in sources}
        src_ids = [s.get("dataset_id") for s in plan_dict.get("sources", []) if s.get("dataset_id")]

        # Output Schema
        cols = build_result_dict.get("columns", [])
        schema_dict = {
            "columns": cols,
            "target_columns": build_result_dict.get("target_columns", []),
            "feature_columns": build_result_dict.get("feature_columns", []),
            "model_excluded_columns": build_result_dict.get("model_excluded_columns", []),
        }

        record = MasterDatasetVersionRecord(
            dataset_version_id=dataset_version_id,
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            env_id=env_id,
            version_tag=ver_tag,
            version_number=next_ver_num,
            output_name=output_name,
            file_path=str(versioned_file_path),
            file_size_bytes=file_size,
            row_count=build_result_dict.get("row_count", 0),
            column_count=build_result_dict.get("column_count", 0),
            sha256_checksum=build_result_dict.get("sha256_checksum", ""),
            primary_key=build_result_dict.get("primary_key", "ALERT_ID"),
            grain=build_result_dict.get("target_grain", "alerts"),
            plan_json=plan_dict,
            source_dataset_ids=src_ids,
            source_dataset_versions=src_versions,
            transformations_json=plan_dict.get("transformations", []),
            relationships_json=plan_dict.get("relationships", []),
            validation_results_json=build_result_dict.get("contract_validation"),
            schema_json=schema_dict,
            lineage_json=build_result_dict.get("lineage_manifest", {}),
            execution_id=build_result_dict.get("build_id", ""),
            created_at=datetime.utcnow().isoformat() + "Z",
        )

        self._insert_version_record(record)
        return record

    def _insert_version_record(self, record: MasterDatasetVersionRecord):
        """Persists the record to DuckDB / SQLite."""
        try:
            with get_connection(self.db_path) as conn:
                conn.execute(
                    """
                    INSERT INTO mlops_master_dataset_versions (
                        dataset_version_id, dataset_id, tenant_id, env_id, version_tag, version_number,
                        output_name, file_path, file_size_bytes, row_count, column_count, sha256_checksum,
                        primary_key, grain, plan_json, source_dataset_ids, source_dataset_versions,
                        transformations_json, relationships_json, validation_results_json, schema_json,
                        lineage_json, execution_id, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        record.dataset_version_id,
                        record.dataset_id,
                        record.tenant_id,
                        record.env_id,
                        record.version_tag,
                        record.version_number,
                        record.output_name,
                        record.file_path,
                        record.file_size_bytes,
                        record.row_count,
                        record.column_count,
                        record.sha256_checksum,
                        record.primary_key,
                        record.grain,
                        json.dumps(record.plan_json),
                        json.dumps(record.source_dataset_ids),
                        json.dumps(record.source_dataset_versions),
                        json.dumps(record.transformations_json),
                        json.dumps(record.relationships_json),
                        json.dumps(record.validation_results_json),
                        json.dumps(record.schema_json),
                        json.dumps(record.lineage_json),
                        record.execution_id,
                        record.created_at,
                    ],
                )
        except Exception as e:
            logger.error("Failed to insert mlops_master_dataset_versions record: %s", e)

    def list_versions(
        self,
        tenant_id: str,
        env_id: str,
        output_name: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Lists all immutable Master Dataset versions."""
        try:
            with get_connection(self.db_path) as conn:
                query = """
                    SELECT dataset_version_id, dataset_id, tenant_id, env_id, version_tag, version_number,
                           output_name, file_path, file_size_bytes, row_count, column_count, sha256_checksum,
                           primary_key, grain, execution_id, created_at
                    FROM mlops_master_dataset_versions
                    WHERE tenant_id = ? AND env_id = ?
                """
                params: List[Any] = [tenant_id, env_id]
                if output_name:
                    query += " AND output_name = ?"
                    params.append(output_name)

                query += " ORDER BY version_number DESC, created_at DESC"
                rows = conn.execute(query, params).fetchall()

                versions: List[Dict[str, Any]] = []
                for r in rows:
                    versions.append({
                        "dataset_version_id": r[0],
                        "dataset_id": r[1],
                        "tenant_id": r[2],
                        "env_id": r[3],
                        "version_tag": r[4],
                        "version_number": r[5],
                        "output_name": r[6],
                        "file_path": r[7],
                        "file_size_bytes": r[8],
                        "row_count": r[9],
                        "column_count": r[10],
                        "sha256_checksum": r[11],
                        "primary_key": r[12],
                        "grain": r[13],
                        "execution_id": r[14],
                        "created_at": r[15],
                    })
                return versions
        except Exception as e:
            logger.warning("Could not query mlops_master_dataset_versions: %s", e)
            return []

    def get_version(
        self,
        tenant_id: str,
        env_id: str,
        dataset_version_id: str,
    ) -> Optional[Dict[str, Any]]:
        """Fetches the complete immutable metadata, plan snapshot, and lineage manifest for a specific version."""
        try:
            with get_connection(self.db_path) as conn:
                query = """
                    SELECT dataset_version_id, dataset_id, tenant_id, env_id, version_tag, version_number,
                           output_name, file_path, file_size_bytes, row_count, column_count, sha256_checksum,
                           primary_key, grain, plan_json, source_dataset_ids, source_dataset_versions,
                           transformations_json, relationships_json, validation_results_json, schema_json,
                           lineage_json, execution_id, created_at
                    FROM mlops_master_dataset_versions
                    WHERE tenant_id = ? AND env_id = ? AND dataset_version_id = ?
                """
                row = conn.execute(query, [tenant_id, env_id, dataset_version_id]).fetchone()
                if not row:
                    return None

                def _safe_json(val: Any) -> Any:
                    if not val:
                        return None
                    if isinstance(val, (dict, list)):
                        return val
                    try:
                        return json.loads(val)
                    except Exception:
                        return val

                return {
                    "dataset_version_id": row[0],
                    "dataset_id": row[1],
                    "tenant_id": row[2],
                    "env_id": row[3],
                    "version_tag": row[4],
                    "version_number": row[5],
                    "output_name": row[6],
                    "file_path": row[7],
                    "file_size_bytes": row[8],
                    "row_count": row[9],
                    "column_count": row[10],
                    "sha256_checksum": row[11],
                    "primary_key": row[12],
                    "grain": row[13],
                    "plan": _safe_json(row[14]),
                    "source_dataset_ids": _safe_json(row[15]),
                    "source_dataset_versions": _safe_json(row[16]),
                    "transformations": _safe_json(row[17]),
                    "relationships": _safe_json(row[18]),
                    "validation_results": _safe_json(row[19]),
                    "schema": _safe_json(row[20]),
                    "lineage": _safe_json(row[21]),
                    "execution_id": row[22],
                    "created_at": row[23],
                }
        except Exception as e:
            logger.error("Error retrieving dataset version %s: %s", dataset_version_id, e)
            return None

    def get_version_dataframe(
        self,
        tenant_id: str,
        env_id: str,
        dataset_version_id: str,
    ) -> Optional[pd.DataFrame]:
        """Loads the exact pandas DataFrame for a specific immutable version ID."""
        from api.tools.mlops.path_utils import resolve_data_file_path
        version_meta = self.get_version(tenant_id, env_id, dataset_version_id)
        if not version_meta:
            return None

        file_p = resolve_data_file_path(Path(version_meta.get("file_path", "")), env_root=self.env_root)
        if not file_p.exists():
            return None

        return pd.read_csv(file_p)

    def check_version_freshness(
        self,
        tenant_id: str,
        env_id: str,
        dataset_version_id: str,
        current_datasets: Optional[List[Dict[str, Any]]] = None,
        current_plan: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Inspects whether the specified Master Dataset Version is still fresh or outdated.
        Detects if source files were re-uploaded or modified (SHA256 mismatch)
        or if the MasterDatasetPlan has evolved since the version was built.
        """
        from api.tools.mlops.path_utils import resolve_data_file_path
        version_meta = self.get_version(tenant_id, env_id, dataset_version_id)
        if not version_meta:
            return {
                "is_valid": False,
                "is_fresh": False,
                "is_outdated": True,
                "dataset_version_id": dataset_version_id,
                "stale_reasons": [f"Master Dataset Version '{dataset_version_id}' does not exist in registry."],
                "impacted_stages": ["target", "eda", "preprocess", "model", "validation", "registry", "ready"],
            }

        stale_reasons: List[str] = []

        # 1. Check file existence
        raw_p = Path(version_meta.get("file_path", ""))
        file_p = resolve_data_file_path(raw_p, env_root=self.env_root)
        if not file_p.exists():
            stale_reasons.append(f"Master Dataset Version artifact file '{file_p.name}' is missing on disk.")

        # 2. Check source file checksums
        stored_src_versions = version_meta.get("source_dataset_versions") or {}
        import hashlib
        current_map = {str(d.get("dataset_type", "")).strip().lower(): d for d in (current_datasets or [])}
        for tbl, stored_hash in stored_src_versions.items():
            norm_tbl = str(tbl).strip().lower()
            cur_ds = current_map.get(norm_tbl)
            cur_path = None
            if cur_ds and cur_ds.get("file_path"):
                cur_path = resolve_data_file_path(Path(cur_ds.get("file_path", "")), env_root=self.env_root)
            else:
                # Fallback to direct check in env data or mlops data directories
                candidates = [
                    self.env_root / "data" / f"{norm_tbl}.csv",
                    self.env_root / "data" / f"{norm_tbl}.parquet",
                    self.env_root / "mlops" / "data" / f"{norm_tbl}.csv",
                    self.data_dir / f"{norm_tbl}.csv",
                ]
                for c in candidates:
                    if c.exists():
                        cur_path = c
                        break

            if not cur_path or not cur_path.exists():
                stale_reasons.append(f"Required source table '{tbl}' is no longer present in workspace.")
                continue

            # Compute current hash
            try:
                h = hashlib.sha256()
                with open(cur_path, "rb") as f:
                    for chunk in iter(lambda: f.read(65536), b""):
                        h.update(chunk)
                cur_hash = h.hexdigest()
                if cur_hash != stored_hash:
                    stale_reasons.append(
                        f"Source table '{tbl}' was modified or re-uploaded (checksum changed from {stored_hash[:8]}... to {cur_hash[:8]}...)."
                    )
            except Exception as exc:
                stale_reasons.append(f"Could not verify checksum for table '{tbl}': {exc}")

        # 3. Check plan divergence if current_plan is provided
        if current_plan:
            stored_plan = version_meta.get("plan") or {}
            cur_grain = current_plan.get("target_grain", {}).get("entity_name")
            stored_grain = stored_plan.get("target_grain", {}).get("entity_name")
            if cur_grain and stored_grain and cur_grain != stored_grain:
                stale_reasons.append(f"Master grain changed from '{stored_grain}' to '{cur_grain}'.")

            cur_tables = sorted(s.get("table_name", "") for s in current_plan.get("sources", []) if s.get("table_name"))
            stored_tables = sorted(s.get("table_name", "") for s in stored_plan.get("sources", []) if s.get("table_name"))
            if cur_tables and stored_tables and cur_tables != stored_tables:
                stale_reasons.append(f"Plan source tables changed (now {cur_tables} vs stored {stored_tables}).")

        is_fresh = len(stale_reasons) == 0
        return {
            "is_valid": True,
            "is_fresh": is_fresh,
            "is_outdated": not is_fresh,
            "dataset_version_id": dataset_version_id,
            "version_tag": version_meta.get("version_tag"),
            "row_count": version_meta.get("row_count"),
            "column_count": version_meta.get("column_count"),
            "stale_reasons": stale_reasons,
            "impacted_stages": [
                "target",
                "eda",
                "preprocess",
                "model",
                "validation",
                "registry",
                "ready",
            ] if not is_fresh else [],
        }

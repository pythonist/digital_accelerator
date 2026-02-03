from flask import Blueprint, request, jsonify
import hashlib
import json
import logging
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from api.tools.btsy.service import get_btsy_service
from api.tools.btsy.mapping_service import MappingService
from api.tools.btsy.snapshot_manager import SnapshotManager

logger = logging.getLogger(__name__)

datatype_bp = Blueprint("btsy_datatypes", __name__)


VALID_DOMAINS = ["transactions", "accounts", "customers", "str"]
IDENTIFIER_FIELDS = {"account_id", "transaction_id", "customer_id"}


def _relation_expr(file_path: Path) -> str:
    p = str(file_path).replace("'", "''")
    ext = file_path.suffix.lower()
    if ext in (".parquet", ".pq"):
        return f"read_parquet('{p}')"
    return f"read_csv_auto('{p}')"


def _infer_proposed_type_for_field(field_name: str, expected_type: Optional[str], source_type: Optional[str]) -> str:
    if field_name in IDENTIFIER_FIELDS:
        return "VARCHAR"
    t = (expected_type or "").upper()
    if "TIMESTAMP" in t or "DATE" in t:
        return "TIMESTAMP"
    if "BOOL" in t or "BOOLEAN" in t:
        return "BOOLEAN"
    if "FLOAT" in t or "DOUBLE" in t or "DECIMAL" in t:
        return "DECIMAL(38,10)"
    st = (source_type or "").upper()
    if st in ("DOUBLE", "FLOAT", "DECIMAL", "BIGINT", "INTEGER", "HUGEINT", "UBIGINT"):
        return "DECIMAL(38,10)"
    if st in ("TIMESTAMP", "TIMESTAMPTZ", "DATE"):
        return "TIMESTAMP"
    if st in ("BOOLEAN", "BOOL"):
        return "BOOLEAN"
    return "VARCHAR"


def _is_numeric_source_type(source_type: Optional[str]) -> bool:
    st = (source_type or "").upper()
    return any(k in st for k in ("INT", "DECIMAL", "DOUBLE", "FLOAT", "HUGEINT", "UBIGINT"))


def _build_cast_expr(source_col: str, target_type: str, is_identifier: bool) -> str:
    col = source_col.replace('"', '""')
    t = (target_type or "").upper()
    if is_identifier:
        return f'CAST("{col}" AS VARCHAR)'
    if t.startswith("DECIMAL"):
        return f"""TRY_CAST(REGEXP_REPLACE(CAST("{col}" AS VARCHAR), '[^0-9.-]', '', 'g') AS {t})"""
    if t == "TIMESTAMP":
        return f"""TRY_CAST("{col}" AS TIMESTAMP)"""
    if t == "BOOLEAN":
        return f"""
            CASE 
                WHEN UPPER(CAST("{col}" AS VARCHAR)) IN ('TRUE', 'YES', '1', 'Y') THEN TRUE
                WHEN UPPER(CAST("{col}" AS VARCHAR)) IN ('FALSE', 'NO', '0', 'N') THEN FALSE
                ELSE NULL
            END
        """
    return f'CAST("{col}" AS VARCHAR)'


def _validate_field(
    conn,
    rel: str,
    source_col: str,
    proposed_type: str,
    is_identifier: bool,
    sample_size: int,
) -> Dict:
    col = source_col.replace('"', '""')
    cast_expr = _build_cast_expr(source_col, proposed_type, is_identifier)
    raw_expr = f'CAST("{col}" AS VARCHAR)'
    raw_len = f"LENGTH({raw_expr})"
    cast_as_text = f"CAST({cast_expr} AS VARCHAR)"
    cast_len = f"LENGTH({cast_as_text})"

    samples = conn.execute(
        f"""
        SELECT {raw_expr} AS raw_value, {cast_as_text} AS cast_value
        FROM {rel}
        WHERE "{col}" IS NOT NULL
        LIMIT {int(sample_size)}
        """
    ).fetchall()
    raw_samples = [r[0] for r in samples]
    cast_samples = [r[1] for r in samples]

    total_checked = conn.execute(
        f"""SELECT COUNT(*) FROM {rel} WHERE "{col}" IS NOT NULL"""
    ).fetchone()[0]

    null_introduced = conn.execute(
        f"""
        SELECT COUNT(*) 
        FROM {rel}
        WHERE "{col}" IS NOT NULL AND {cast_expr} IS NULL
        """
    ).fetchone()[0]

    failures: List[str] = []
    checks: Dict[str, Dict] = {}

    if is_identifier:
        if _is_numeric_source_type(conn.execute(f"DESCRIBE SELECT \"{col}\" FROM {rel}").fetchone()[1]):
            failures.append("Identifier source type is numeric; leading zeros may be lost. Provide as string.")
            checks["identifier_source_is_string"] = {"pass": False}
        else:
            checks["identifier_source_is_string"] = {"pass": True}

        mismatch_count = conn.execute(
            f"""
            SELECT COUNT(*)
            FROM {rel}
            WHERE "{col}" IS NOT NULL AND ({raw_expr} != {cast_as_text})
            """
        ).fetchone()[0]
        checks["raw_equals_cast"] = {"pass": mismatch_count == 0, "mismatch_count": int(mismatch_count)}
        if mismatch_count:
            failures.append("raw_value != cast_value for identifier field")

        len_mismatch = conn.execute(
            f"""
            SELECT COUNT(*)
            FROM {rel}
            WHERE "{col}" IS NOT NULL AND ({raw_len} != {cast_len})
            """
        ).fetchone()[0]
        checks["length_preserved"] = {"pass": len_mismatch == 0, "mismatch_count": int(len_mismatch)}
        if len_mismatch:
            failures.append("length changed for identifier field")

        checks["nulls_introduced"] = {"pass": int(null_introduced) == 0, "count": int(null_introduced)}
        if null_introduced:
            failures.append("nulls introduced by casting")
    else:
        checks["nulls_introduced"] = {"pass": int(null_introduced) == 0, "count": int(null_introduced)}
        if null_introduced:
            failures.append("nulls introduced by casting")

        if (proposed_type or "").upper().startswith("DECIMAL"):
            too_many_decimals = conn.execute(
                f"""
                SELECT COUNT(*)
                FROM {rel}
                WHERE "{col}" IS NOT NULL
                  AND REGEXP_MATCHES(REGEXP_REPLACE(CAST("{col}" AS VARCHAR), '[^0-9.-]', '', 'g'), '.*\\.[0-9]{{11,}}$')
                """
            ).fetchone()[0]
            checks["scale_preserved"] = {"pass": int(too_many_decimals) == 0, "over_scale_count": int(too_many_decimals)}
            if too_many_decimals:
                failures.append("decimal scale exceeds DECIMAL(38,10); rounding risk")

    ok = len(failures) == 0
    return {
        "ok": ok,
        "checks": checks,
        "failures": failures,
        "raw_samples": raw_samples[:10],
        "cast_samples": cast_samples[:10],
        "sample_size": int(len(raw_samples)),
        "total_non_null_rows": int(total_checked),
        "null_introduced": int(null_introduced),
    }


def _get_draft_snapshot_id(mgr: SnapshotManager, env_id: str, tenant_id: str) -> Optional[str]:
    return mgr.get_latest_snapshot_id(env_id=env_id, tenant_id=tenant_id, status="draft")


def _run_validation(
    *,
    domain: str,
    env_id: str,
    tenant_id: str,
    field_kind: str,
    field_key: str,
    proposed_type: Optional[str],
    sample_size: int,
) -> Tuple[Dict, str, str, str]:
    service = get_btsy_service()
    folders = service.init_env_structure(tenant_id, env_id)
    mgr = SnapshotManager(folders["duckdb"] / "snapshots.duckdb")
    draft_snapshot_id = _get_draft_snapshot_id(mgr, env_id, tenant_id)
    if not draft_snapshot_id:
        raise ValueError("No draft snapshot found")

    raw_path = folders["raw"]
    domain_files = list(raw_path.glob(f"{domain}.*"))
    if not domain_files:
        raise FileNotFoundError(f"No file found for {domain}")
    file_path = domain_files[0]
    rel = _relation_expr(file_path)
    conn = service.get_connection(tenant_id, env_id)

    mapping_service = MappingService(folders["state"])
    mapping_state = mapping_service.load_mapping(domain) or {}
    bank_info = mapping_state.get("bank_column_info") or {}

    if field_kind == "canonical":
        field_meta = next((f for f in (mapping_state.get("canonical_fields") or []) if f.get("canonical_name") == field_key), None)
        if not field_meta or field_meta.get("status") != "mapped" or not field_meta.get("mapped_column"):
            raise ValueError("Canonical field is not mapped")
        source_col = field_meta.get("mapped_column")
        source_type = (bank_info.get(source_col) or {}).get("datatype") or field_meta.get("source_datatype")
        proposed = proposed_type or _infer_proposed_type_for_field(field_key, field_meta.get("expected_type"), source_type)
        result = _validate_field(conn, rel, source_col, proposed, field_key in IDENTIFIER_FIELDS, sample_size)
    else:
        source_col = field_key
        source_type = (bank_info.get(source_col) or {}).get("datatype")
        proposed = proposed_type or _infer_proposed_type_for_field(field_key, None, source_type)
        result = _validate_field(conn, rel, source_col, proposed, False, sample_size)

    result["proposed_type"] = proposed
    result["source_type"] = source_type
    result["source_column_name"] = source_col
    return result, draft_snapshot_id, str(folders["duckdb"] / "snapshots.duckdb"), source_col



@datatype_bp.route("/dtypes/plan/<domain>", methods=["GET"])
def get_dtype_plan(domain):
    try:
        if domain not in VALID_DOMAINS:
            return jsonify({"error": "Invalid domain"}), 400
        env_id = request.headers.get("X-Environment-ID")
        if not env_id:
            return jsonify({"error": "X-Environment-ID header required"}), 400

        tenant_id = "default"
        service = get_btsy_service()
        folders = service.init_env_structure(tenant_id, env_id)

        mgr = SnapshotManager(folders["duckdb"] / "snapshots.duckdb")
        draft_snapshot_id = _get_draft_snapshot_id(mgr, env_id, tenant_id)
        if not draft_snapshot_id:
            return jsonify({"success": False, "error": "No draft snapshot found"}), 404

        mapping_service = MappingService(folders["state"])
        mapping_state = mapping_service.load_mapping(domain) or {}

        fields: List[Dict] = []

        bank_info = mapping_state.get("bank_column_info") or {}
        for f in (mapping_state.get("canonical_fields") or []):
            if f.get("status") != "mapped" or not f.get("mapped_column"):
                continue
            canonical_name = f.get("canonical_name")
            source_col = f.get("mapped_column")
            source_type = (bank_info.get(source_col) or {}).get("datatype") or f.get("source_datatype")
            proposed = _infer_proposed_type_for_field(canonical_name, f.get("expected_type"), source_type)
            lock = mgr.get_type_lock(env_id, tenant_id, domain, "canonical", canonical_name) or {}
            fields.append(
                {
                    "field_kind": "canonical",
                    "field_key": canonical_name,
                    "mapped_name": canonical_name,
                    "source_column_name": source_col,
                    "source_type": source_type,
                    "proposed_type": proposed,
                    "locked": bool(lock.get("locked")),
                    "locked_type": lock.get("locked_type"),
                    "lock_version": lock.get("lock_version"),
                    "status": lock.get("status") or ("locked" if lock.get("locked") else "pending"),
                    "risk": "HIGH" if canonical_name in IDENTIFIER_FIELDS and _is_numeric_source_type(source_type) else "LOW",
                }
            )

        ext_attrs = mgr.list_extension_attributes(draft_snapshot_id, domain)
        for a in ext_attrs:
            if str(a.get("status") or "").lower() == "ignored":
                continue
            source_col = a.get("source_column_name")
            source_type = (bank_info.get(source_col) or {}).get("datatype") or a.get("data_type")
            proposed = _infer_proposed_type_for_field(source_col, None, source_type)
            lock = mgr.get_type_lock(env_id, tenant_id, domain, "extension", source_col) or {}
            fields.append(
                {
                    "field_kind": "extension",
                    "field_key": source_col,
                    "mapped_name": a.get("display_name") or source_col,
                    "source_column_name": source_col,
                    "source_type": source_type,
                    "proposed_type": proposed,
                    "locked": bool(lock.get("locked")),
                    "locked_type": lock.get("locked_type"),
                    "lock_version": lock.get("lock_version"),
                    "status": lock.get("status") or ("locked" if lock.get("locked") else "pending"),
                    "risk": "LOW",
                }
            )

        locked_count = sum(1 for f in fields if f.get("locked"))
        return jsonify(
            {
                "success": True,
                "data": {
                    "snapshot_id": draft_snapshot_id,
                    "domain": domain,
                    "fields": fields,
                    "progress": {"locked": locked_count, "total": len(fields)},
                },
            }
        ), 200
    except Exception as e:
        logger.error(f"[BTSY][DTYPE] Plan failed: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@datatype_bp.route("/dtypes/validate/<domain>", methods=["POST"])
def validate_dtype(domain):
    try:
        if domain not in VALID_DOMAINS:
            return jsonify({"error": "Invalid domain"}), 400
        env_id = request.headers.get("X-Environment-ID")
        if not env_id:
            return jsonify({"error": "X-Environment-ID header required"}), 400

        payload = request.get_json() or {}
        field_kind = payload.get("field_kind")
        field_key = payload.get("field_key")
        proposed_type = payload.get("proposed_type")
        sample_size = int(payload.get("sample_size") or 50)
        sample_size = max(5, min(sample_size, 200))

        if field_kind not in ("canonical", "extension") or not field_key:
            return jsonify({"error": "field_kind and field_key required"}), 400

        tenant_id = "default"
        result, _, _, _ = _run_validation(
            domain=domain,
            env_id=env_id,
            tenant_id=tenant_id,
            field_kind=field_kind,
            field_key=field_key,
            proposed_type=proposed_type,
            sample_size=sample_size,
        )
        return jsonify({"success": True, "data": result}), 200
    except Exception as e:
        logger.error(f"[BTSY][DTYPE] Validate failed: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@datatype_bp.route("/dtypes/lock/<domain>", methods=["POST"])
def lock_dtype(domain):
    try:
        if domain not in VALID_DOMAINS:
            return jsonify({"error": "Invalid domain"}), 400
        env_id = request.headers.get("X-Environment-ID")
        if not env_id:
            return jsonify({"error": "X-Environment-ID header required"}), 400
        tenant_id = "default"
        performed_by = (request.get_json() or {}).get("performed_by") or "user"
        payload = request.get_json() or {}

        field_kind = payload.get("field_kind")
        field_key = payload.get("field_key")
        proposed_type = payload.get("proposed_type")

        if field_kind not in ("canonical", "extension") or not field_key:
            return jsonify({"error": "field_kind and field_key required"}), 400

        service = get_btsy_service()
        folders = service.init_env_structure(tenant_id, env_id)
        mgr = SnapshotManager(folders["duckdb"] / "snapshots.duckdb")
        data, draft_snapshot_id, _, source_column_name = _run_validation(
            domain=domain,
            env_id=env_id,
            tenant_id=tenant_id,
            field_kind=field_kind,
            field_key=field_key,
            proposed_type=proposed_type,
            sample_size=max(5, min(int(payload.get("sample_size") or 50), 200)),
        )
        if not data.get("ok"):
            status = "quarantine" if mgr.get_type_lock(env_id, tenant_id, domain, field_kind, field_key) else "pending"
            mgr.upsert_type_lock(
                env_id=env_id,
                tenant_id=tenant_id,
                snapshot_id=draft_snapshot_id,
                entity_scope=domain,
                field_kind=field_kind,
                field_key=field_key,
                source_column_name=source_column_name,
                proposed_type=data.get("proposed_type"),
                locked_type=data.get("proposed_type"),
                locked=False,
                status=status,
                validation_checksum=None,
                validation_report=data,
                performed_by=performed_by,
            )
            return jsonify({"success": False, "error": "Validation failed", "data": data}), 400

        checksum = hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()

        mgr.upsert_type_lock(
            env_id=env_id,
            tenant_id=tenant_id,
            snapshot_id=draft_snapshot_id,
            entity_scope=domain,
            field_kind=field_kind,
            field_key=field_key,
            source_column_name=source_column_name,
            proposed_type=proposed_type or data.get("proposed_type"),
            locked_type=proposed_type or data.get("proposed_type"),
            locked=True,
            status="locked",
            validation_checksum=checksum,
            validation_report=data,
            performed_by=performed_by,
        )

        if field_kind == "extension":
            mgr.upsert_extension_attributes(
                draft_snapshot_id,
                domain,
                [{"source_column_name": field_key, "status": "active", "locked": True, "data_type": data.get("proposed_type")}],
            )

        return jsonify({"success": True, "data": {"field_kind": field_kind, "field_key": field_key, "locked_type": proposed_type or data.get("proposed_type"), "checksum": checksum}}), 200
    except Exception as e:
        logger.error(f"[BTSY][DTYPE] Lock failed: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500

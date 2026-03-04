from flask import Blueprint, request, jsonify, Response
import json
from datetime import date, datetime
import duckdb
import traceback
from api.tools.btsy.service import get_btsy_service
from api.tools.btsy.threshold_construction.threshold_construction_service import ThresholdConstructionService


threshold_construction_bp = Blueprint("threshold_construction", __name__)


def _safe_json(obj):
    if obj is None:
        return None
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if hasattr(obj, "to_pydatetime"):
        try:
            return obj.to_pydatetime().isoformat()
        except Exception:
            return obj
    if hasattr(obj, "isoformat"):
        try:
            return obj.isoformat()
        except Exception:
            return obj
    if isinstance(obj, dict):
        return {k: _safe_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_safe_json(v) for v in obj]
    return obj


def _get_services(env_id: str, tenant_id: str = "default"):
    service = get_btsy_service()
    folders = service.init_env_structure(tenant_id, env_id)
    universe_db = folders["duckdb"] / "universes.duckdb"
    threshold_db = folders["duckdb"] / "threshold_construction.duckdb"
    pipeline = ThresholdConstructionService(threshold_db)
    return pipeline, universe_db


@threshold_construction_bp.route("/threshold/run/start", methods=["POST"])
def threshold_run_start():
    try:
        env_id = request.headers.get("X-Environment-ID")
        if not env_id:
            return jsonify({"error": "X-Environment-ID header required"}), 400
        data = request.get_json() or {}
        if data.get("__debug_probe"):
            return jsonify({"probe": "ok"}), 200
        run_id = data.get("run_id")
        universe_id = data.get("universe_id")
        created_by = data.get("created_by", "user")
        limit = data.get("limit", 200)
        offset = data.get("offset", 0)
        account_id = data.get("account_id")
        customer_id = data.get("customer_id")
        pipeline, universe_db = _get_services(env_id)
        if run_id:
            result = pipeline.preview_static(
                run_id=int(run_id),
                preview_limit=int(limit),
                preview_offset=int(offset),
                account_id=str(account_id) if account_id else None,
                customer_id=str(customer_id) if customer_id else None,
            )
        else:
            if not universe_id:
                return jsonify({"error": "universe_id required"}), 400
            started = pipeline.start_run(
                universe_id=int(universe_id),
                universe_db_path=universe_db,
                created_by=str(created_by),
                preview_limit=int(limit),
                preview_offset=int(offset),
            )
            result = pipeline.preview_static(
                run_id=int(started.get("run_id")),
                preview_limit=int(limit),
                preview_offset=int(offset),
                account_id=str(account_id) if account_id else None,
                customer_id=str(customer_id) if customer_id else None,
            )
        payload = {"success": True, "data": _safe_json(result)}
        return Response(json.dumps(payload, default=str), mimetype="application/json"), 200
    except Exception as e:
        print(traceback.format_exc())
        msg = str(e)
        if universe_id:
            try:
                fallback_pipeline, _ = _get_services(env_id)
                conn = duckdb.connect(str(fallback_pipeline.db_path))
                try:
                    row = conn.execute(
                        "SELECT run_id FROM threshold_runs WHERE universe_id = ? ORDER BY run_id DESC LIMIT 1",
                        [int(universe_id)],
                    ).fetchone()
                finally:
                    conn.close()
                if row and row[0]:
                    result = fallback_pipeline.preview_static(
                        run_id=int(row[0]),
                        preview_limit=int(limit),
                        preview_offset=int(offset),
                        account_id=str(account_id) if account_id else None,
                        customer_id=str(customer_id) if customer_id else None,
                    )
                    payload = {"success": True, "data": _safe_json(result), "warning": msg}
                    return Response(json.dumps(payload, default=str), mimetype="application/json"), 200
            except Exception:
                pass
        return jsonify({"error": msg, "trace": traceback.format_exc()}), 500


@threshold_construction_bp.route("/threshold/run/group", methods=["POST"])
def threshold_run_group():
    try:
        env_id = request.headers.get("X-Environment-ID")
        if not env_id:
            return jsonify({"error": "X-Environment-ID header required"}), 400
        data = request.get_json() or {}
        run_id = data.get("run_id")
        if not run_id:
            return jsonify({"error": "run_id required"}), 400
        aggregation_level = data.get("aggregation_level")
        entity_level = data.get("entity_level")
        transaction_type = data.get("transaction_type")
        limit = data.get("limit", 200)
        offset = data.get("offset", 0)
        account_id = data.get("account_id")
        customer_id = data.get("customer_id")
        pipeline, _ = _get_services(env_id)
        result = pipeline.group_run(
            run_id=int(run_id),
            aggregation_level=str(aggregation_level),
            entity_level=str(entity_level),
            transaction_type=str(transaction_type) if transaction_type is not None else None,
            preview_limit=int(limit),
            preview_offset=int(offset),
            account_id=str(account_id) if account_id else None,
            customer_id=str(customer_id) if customer_id else None,
        )
        payload = {"success": True, "data": _safe_json(result)}
        return Response(json.dumps(payload, default=str), mimetype="application/json"), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@threshold_construction_bp.route("/threshold/run/lookback", methods=["POST"])
def threshold_run_lookback():
    try:
        env_id = request.headers.get("X-Environment-ID")
        if not env_id:
            return jsonify({"error": "X-Environment-ID header required"}), 400
        data = request.get_json() or {}
        run_id = data.get("run_id")
        lookback_days = data.get("lookback_days")
        if not run_id:
            return jsonify({"error": "run_id required"}), 400
        if lookback_days is None:
            return jsonify({"error": "lookback_days required"}), 400
        limit = data.get("limit", 200)
        offset = data.get("offset", 0)
        account_id = data.get("account_id")
        customer_id = data.get("customer_id")
        as_of_date = data.get("as_of_date")
        pipeline, _ = _get_services(env_id)
        result = pipeline.lookback_run(
            run_id=int(run_id),
            lookback_days=int(lookback_days),
            preview_limit=int(limit),
            preview_offset=int(offset),
            account_id=str(account_id) if account_id else None,
            customer_id=str(customer_id) if customer_id else None,
            as_of_date=str(as_of_date) if as_of_date else None,
        )
        payload = {"success": True, "data": _safe_json(result)}
        return Response(json.dumps(payload, default=str), mimetype="application/json"), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@threshold_construction_bp.route("/threshold/run/threshold", methods=["POST"])
def threshold_run_threshold():
    try:
        env_id = request.headers.get("X-Environment-ID")
        if not env_id:
            return jsonify({"error": "X-Environment-ID header required"}), 400
        data = request.get_json() or {}
        run_id = data.get("run_id")
        if not run_id:
            return jsonify({"error": "run_id required"}), 400
        limit = data.get("limit", 200)
        offset = data.get("offset", 0)
        account_id = data.get("account_id")
        customer_id = data.get("customer_id")
        pipeline, _ = _get_services(env_id)
        result = pipeline.threshold_run(
            run_id=int(run_id),
            preview_limit=int(limit),
            preview_offset=int(offset),
            account_id=str(account_id) if account_id else None,
            customer_id=str(customer_id) if customer_id else None,
        )
        payload = {"success": True, "data": _safe_json(result)}
        return Response(json.dumps(payload, default=str), mimetype="application/json"), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

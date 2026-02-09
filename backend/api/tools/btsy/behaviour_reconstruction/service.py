from pathlib import Path
from typing import Any, Dict

from api.tools.btsy.service import get_btsy_service
from api.tools.btsy.cortex.scenario_builder import CortexScenarioBuilderService
from .repository import BehaviourReconstructionRepository
from .models import BehaviourReconstructionMeta, BehaviourReconstructionResult


class BehaviourReconstructionService:
    def __init__(self, cortex_db_path: Path, universe_db_path: Path):
        self.cortex_db_path = cortex_db_path
        self.universe_db_path = universe_db_path
        self.builder = CortexScenarioBuilderService(cortex_db_path)
        self.repo = BehaviourReconstructionRepository(cortex_db_path)

    def reconstruct(
        self,
        behavior_run_id: int,
        entity_id: str,
        as_of_date: str,
        entity_level: str,
        created_by: str,
    ) -> Dict[str, Any]:
        run_id = int(behavior_run_id)
        entity_id_str = str(entity_id)
        as_of_date_str = str(as_of_date)
        cached = self.repo.get_cached_reconstruction(run_id, entity_id_str, as_of_date_str)
        if cached is None:
            artifact = self.builder.reconstruct_behavior(
                run_id=run_id,
                universe_db_path=self.universe_db_path,
                entity_id=entity_id_str,
                as_of_date=as_of_date_str,
                entity_level=entity_level,
                created_by=created_by,
            )
        else:
            artifact = cached
        recon_id = int(artifact.get("recon_id") or 0)
        cfg = artifact.get("config_snapshot") or {}
        meta = BehaviourReconstructionMeta(
            behavior_run_id=run_id,
            entity_level=str(artifact.get("entity_level") or entity_level or "account"),
            metric_name="threshold_amt",
            aggregation_level=str(cfg.get("aggregation_level") or ""),
            lookback_days=int(cfg.get("lookback_days") or 0),
            transaction_type=str(cfg.get("transaction_type") or ""),
        )
        raw_view = artifact.get("raw_view") or []
        raw_transactions = []
        for row in raw_view:
            r = dict(row)
            included_flag = bool(r.get("included_step2"))
            r["included_in_step2"] = included_flag
            if "included_step2" not in r:
                r["included_step2"] = included_flag
            raw_transactions.append(r)
        filter_impact = artifact.get("filter_impact") or {}
        aggregated_rows = artifact.get("aggregation", {}).get("rows") or []
        lookback = artifact.get("lookback") or {}
        lookback_window = {
            "start": lookback.get("window_start"),
            "end": lookback.get("window_end"),
        }
        included_rows = lookback.get("included_dates") or []
        excluded_rows = lookback.get("excluded_dates") or []
        contribution = artifact.get("contribution_table") or {}
        contribution_rows = contribution.get("rows") or []
        final_threshold = float(contribution.get("final_threshold") or 0.0)
        components = []
        for row in contribution_rows:
            if "aggregated_amount" in row:
                components.append(float(row.get("aggregated_amount") or 0.0))
            else:
                components.append(float(row.get("total_daily_amount") or 0.0))
        formula = {
            "components": components,
            "final_value": final_threshold,
        }
        stored_threshold = self.repo.get_stored_threshold(
            run_id=run_id,
            entity_level=meta.entity_level,
            entity_id=entity_id_str,
            as_of_date=artifact.get("as_of_date") or as_of_date_str,
        )
        matches = None
        integrity = {"dropped_unexpected": []}
        if stored_threshold is not None:
            diff = abs(float(stored_threshold) - float(final_threshold))
            matches = diff < 1e-6
            if not matches:
                integrity["dropped_unexpected"].append(
                    {
                        "reason": "threshold_mismatch",
                        "stored_threshold": float(stored_threshold),
                        "reconstructed_threshold": float(final_threshold),
                    }
                )
        data_loss = artifact.get("data_loss") or {}
        if int(data_loss.get("dropped_raw") or 0) > 0:
            dropped_rows = data_loss.get("dropped_rows") or []
            integrity["dropped_unexpected"].append(
                {
                    "reason": "dropped_raw_rows",
                    "count": int(data_loss.get("dropped_raw") or 0),
                    "rows": dropped_rows,
                }
            )
        self.repo.log_reconstruction(
            recon_id=recon_id,
            run_id=run_id,
            entity_level=meta.entity_level,
            entity_id=entity_id_str,
            as_of_date=artifact.get("as_of_date") or as_of_date_str,
            created_by=created_by,
            matches_threshold=matches,
            stored_threshold=stored_threshold,
            reconstructed_threshold=final_threshold,
        )
        result = BehaviourReconstructionResult(
            meta=meta,
            raw_transactions=raw_transactions,
            filter_summary={
                "total_raw": int(filter_impact.get("total_raw") or 0),
                "after_basic_filters": int(filter_impact.get("after_basic_filters") or 0),
                "after_type_filter": int(filter_impact.get("after_type_filter") or 0),
            },
            aggregated_rows=aggregated_rows,
            lookback_window=lookback_window,
            included_rows=included_rows,
            excluded_rows=excluded_rows,
            formula=formula,
            integrity=integrity,
        )
        return {
            "meta": {
                "behavior_run_id": result.meta.behavior_run_id,
                "entity_level": result.meta.entity_level,
                "metric_name": result.meta.metric_name,
                "aggregation_level": result.meta.aggregation_level,
                "lookback_days": result.meta.lookback_days,
                "transaction_type": result.meta.transaction_type,
            },
            "raw_transactions": result.raw_transactions,
            "filter_summary": result.filter_summary,
            "aggregated_rows": result.aggregated_rows,
            "lookback_window": result.lookback_window,
            "included_rows": result.included_rows,
            "excluded_rows": result.excluded_rows,
            "formula": result.formula,
            "integrity": result.integrity,
        }


def get_behaviour_reconstruction_service(env_id: str, tenant_id: str = "default") -> BehaviourReconstructionService:
    service = get_btsy_service()
    folders = service.init_env_structure(tenant_id, env_id)
    cortex_db = folders["duckdb"] / "cortex.duckdb"
    universe_db = folders["duckdb"] / "universes.duckdb"
    return BehaviourReconstructionService(cortex_db, universe_db)


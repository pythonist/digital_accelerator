import tempfile
import unittest
from pathlib import Path
import sys

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from api.tools.mlops.run_state_service import DEFAULT_STEP_ORDER, RunStateService
from api.tools.mlops.duckdb_manager import close_connection


class RunStateServiceTest(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmpdir.name) / "mlops.duckdb"
        self.service = RunStateService(self.db_path)

    def tearDown(self):
        close_connection(self.db_path)
        self.tmpdir.cleanup()

    def test_create_run_initializes_full_step_state(self):
        state = self.service.create_run_state(
            "tenant-a",
            "env-a",
            pipeline_id=101,
            pipeline_name="Persistent FCC Run",
        )

        self.assertEqual(state["status"], "running")
        self.assertEqual(state["current_step"], "data_upload")
        self.assertEqual(set(DEFAULT_STEP_ORDER), set(state["steps_json"]))
        self.assertEqual(state["steps_json"]["data_upload"]["status"], "not_started")
        self.assertEqual(state["steps_json"]["model_training"]["outputs"], {})

    def test_completed_step_with_unchanged_inputs_is_skipped(self):
        state = self.service.create_run_state(
            "tenant-a",
            "env-a",
            pipeline_id=101,
            pipeline_name="Persistent FCC Run",
        )
        run_id = state["run_id"]

        self.service.update_step_state(
            "tenant-a",
            "env-a",
            run_id,
            "preprocessing",
            inputs={"dataset_id": 7, "steps": [{"type": "impute"}]},
            outputs={"dataset_ref": "snapshots/preprocessed.parquet", "preprocessedDatasetId": 44},
            status="completed",
            pipeline_id=101,
        )

        result = self.service.execute_step(
            "tenant-a",
            "env-a",
            run_id,
            "preprocessing",
            inputs={"dataset_id": 7, "steps": [{"type": "impute"}]},
            outputs={},
            status="running",
            pipeline_id=101,
        )

        self.assertTrue(result["skipped"])
        self.assertEqual(result["reason"], "completed_with_unchanged_inputs")
        self.assertEqual(result["step"]["outputs"]["preprocessedDatasetId"], 44)

    def test_upstream_input_change_marks_only_completed_dependents_stale(self):
        state = self.service.create_run_state("tenant-a", "env-a", pipeline_id=101)
        run_id = state["run_id"]

        self.service.update_step_state(
            "tenant-a",
            "env-a",
            run_id,
            "preprocessing",
            inputs={"dataset_id": 7, "steps": [{"type": "impute"}]},
            outputs={"dataset_ref": "snapshots/preprocessed.parquet"},
            status="completed",
            pipeline_id=101,
        )
        self.service.update_step_state(
            "tenant-a",
            "env-a",
            run_id,
            "model_training",
            inputs={"algorithm": "xgboost"},
            outputs={"model_id": "model_456", "model_path": "models/model_456.joblib"},
            status="completed",
            pipeline_id=101,
        )
        self.service.update_step_state(
            "tenant-a",
            "env-a",
            run_id,
            "validation",
            inputs={"threshold": 0.42},
            outputs={"metrics": {"auc": 0.66}, "confusion_matrix": {"tp": 1, "fp": 2, "tn": 3, "fn": 4}},
            status="completed",
            pipeline_id=101,
        )

        updated = self.service.update_step_state(
            "tenant-a",
            "env-a",
            run_id,
            "preprocessing",
            inputs={"dataset_id": 7, "steps": [{"type": "impute"}, {"type": "scale"}]},
            outputs={"dataset_ref": "snapshots/preprocessed_v2.parquet"},
            status="completed",
            pipeline_id=101,
        )

        steps = updated["steps_json"]
        self.assertEqual(steps["preprocessing"]["status"], "completed")
        self.assertEqual(steps["model_training"]["status"], "stale")
        self.assertEqual(steps["validation"]["status"], "stale")
        self.assertEqual(steps["model_release"]["status"], "not_started")
        self.assertEqual(updated["status"], "stale")


if __name__ == "__main__":
    unittest.main()

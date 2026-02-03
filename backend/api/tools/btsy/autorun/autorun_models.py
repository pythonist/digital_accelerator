from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional


@dataclass
class RunContext:
    tenant_id: str
    env_id: str
    run_id: int
    mode: str
    snapshot_id: str
    session_id: int
    created_by: str

    workspace_path: Path
    run_db_path: Path
    universe_db_path: Path
    behavior_db_path: Path

    inputs_path: Path
    outputs_path: Path
    report_path: Path
    logs_path: Path

    def as_dict(self) -> Dict:
        return {
            'tenant_id': self.tenant_id,
            'env_id': self.env_id,
            'run_id': int(self.run_id),
            'mode': self.mode,
            'snapshot_id': self.snapshot_id,
            'session_id': int(self.session_id),
            'created_by': self.created_by,
            'workspace_path': str(self.workspace_path),
            'run_db_path': str(self.run_db_path),
            'universe_db_path': str(self.universe_db_path),
            'behavior_db_path': str(self.behavior_db_path),
            'inputs_path': str(self.inputs_path),
            'outputs_path': str(self.outputs_path),
            'report_path': str(self.report_path),
            'logs_path': str(self.logs_path),
        }


@dataclass
class FrozenConfig:
    config_id: str
    config_version: str
    behavior_config: Dict
    universe_filter_spec: Dict

    def as_dict(self) -> Dict:
        return {
            'config_id': self.config_id,
            'config_version': self.config_version,
            'behavior_config': self.behavior_config,
            'universe_filter_spec': self.universe_filter_spec,
        }


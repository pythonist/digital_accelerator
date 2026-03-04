from __future__ import annotations

from contextlib import redirect_stderr, redirect_stdout
import io
import json
import re
from typing import Any, Dict, Optional

from api.tools.btsy.duckdb_pool import duckdb_pool
from api.tools.btsy.evidence.evidence_store import CalibrationEvidenceStore


_DIGIT_RE = re.compile(r"[0-9]")


def _stable_json(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


class ControlledInferenceService:
    def __init__(self, run_db_path):
        self.run_db_path = run_db_path
        buf = io.StringIO()
        with redirect_stdout(buf), redirect_stderr(buf):
            from llm.ollama_wrapper import OllamaWrapper
            self._ollama = OllamaWrapper()

    def available(self) -> bool:
        try:
            return bool(self._ollama.check_connection())
        except Exception:
            return False

    def _load_step_metrics(self, run_id: int, step_id: str) -> Dict[str, Any]:
        metrics: Dict[str, Any] = {}
        with duckdb_pool.connection(self.run_db_path) as conn:
            try:
                rows = conn.execute(
                    """
                    SELECT metric_key, metric_value, metric_json
                    FROM calibration_metric
                    WHERE run_id = ? AND step_id = ?
                    ORDER BY created_at DESC
                    """,
                    [int(run_id), step_id],
                ).fetchall()
                for k, v, j in rows:
                    if v is not None:
                        metrics[str(k)] = float(v)
                    elif j:
                        try:
                            metrics[str(k)] = json.loads(j)
                        except Exception:
                            metrics[str(k)] = j
            except Exception:
                pass
        return metrics

    def _system_prompt(self) -> str:
        return (
            "You are a senior AML calibration reviewer writing an audit-grade interpretation.\n"
            "CRITICAL RULES:\n"
            "1. Use ONLY the evidence JSON provided.\n"
            "2. Do NOT invent any facts.\n"
            "3. Do NOT include any numbers, numerals, or percentages.\n"
            "4. Do NOT mention AI, LLMs, or models.\n"
            "5. Output plain text only.\n"
            "If evidence is insufficient, state: \"Evidence is insufficient to support a defensible interpretation for this section.\""
        )

    def _prompt(self, *, step_id: str, inference_type: str, evidence: Dict[str, Any]) -> str:
        return (
            f"Section: {step_id}\n"
            f"Inference type: {inference_type}\n\n"
            "EVIDENCE_JSON:\n"
            f"{_stable_json(evidence)}\n\n"
            "Write a concise, formal interpretation in an AML auditor tone."
        )

    def generate_inference_text(self, *, step_id: str, inference_type: str, evidence: Dict[str, Any]) -> Optional[str]:
        if not self.available():
            return "Evidence is insufficient to support a defensible interpretation for this section."
        res = self._ollama.generate(
            prompt=self._prompt(step_id=step_id, inference_type=inference_type, evidence=evidence),
            system_prompt=self._system_prompt(),
            temperature=0.2,
            max_tokens=240,
        )
        if not res.get("success"):
            return None
        txt = (res.get("response") or "").strip()
        if not txt:
            return None
        if _DIGIT_RE.search(txt):
            res2 = self._ollama.generate(
                prompt=self._prompt(step_id=step_id, inference_type=inference_type, evidence=evidence),
                system_prompt=self._system_prompt() + "\nOutput must contain no digits.",
                temperature=0.0,
                max_tokens=240,
            )
            if res2.get("success"):
                txt2 = (res2.get("response") or "").strip()
                if txt2 and not _DIGIT_RE.search(txt2):
                    return txt2
            txt = _DIGIT_RE.sub("", txt)
        return txt

    def generate_and_store(self, *, run_id: int, step_id: str, inference_type: str, extra_evidence: Optional[Dict[str, Any]] = None) -> bool:
        evidence = {"metrics": self._load_step_metrics(int(run_id), step_id)}
        if extra_evidence:
            evidence.update(extra_evidence)
        txt = self.generate_inference_text(step_id=step_id, inference_type=inference_type, evidence=evidence)
        if not txt:
            return False
        store = CalibrationEvidenceStore(self.run_db_path)
        store.store_inference(
            run_id=int(run_id),
            step_id=step_id,
            inference_type=inference_type,
            input_metrics=evidence,
            inference_text=txt,
        )
        return True

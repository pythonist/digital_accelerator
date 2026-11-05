import os
import pytest
from unittest.mock import patch, MagicMock

from api.agent_db import init_db, create_session, log_activity, get_activities
from api.agentic_workflow import run_agentic_investigation
from api.routes.llm_clients import LLMError


@pytest.fixture(autouse=True)
def setup_db():
    init_db()


def test_nemotron_key_error_fixed():
    """Verify that calling run_agentic_investigation with selected_model='nemotron' does not raise KeyError."""
    session_id = create_session("CASE_TEST_001")
    
    with patch("api.agentic_workflow.resolve_workflow_nodes", return_value=[]), \
         patch("api.agentic_workflow.plan_investigation") as mock_plan:
        mock_plan.side_effect = LLMError("OpenAI API credit limit reached or rate limited ($2 credit limit).")
        
        # This should handle the error safely without raising KeyError: 'nemotron'
        run_agentic_investigation("CASE_TEST_001", session_id, {"selected_model": "nemotron"})
        
        activities = get_activities(session_id)
        messages = [a["message"] for a in activities]
        # Should not crash on KeyError: 'nemotron'
        assert not any("KeyError" in m for m in messages)
        assert any("OpenAI API credit limit" in m or "credit limit" in m for m in messages)


def test_activities_retrieval_limit():
    """Verify that get_activities returns logged activities correctly."""
    session_id = create_session("CASE_TEST_002")
    log_activity(session_id, "Test activity message 1", "info")
    log_activity(session_id, "Test activity message 2", "success")
    
    activities = get_activities(session_id, limit=500)
    assert len(activities) >= 2
    assert any("Test activity message 1" in a["message"] for a in activities)
    assert any("Test activity message 2" in a["message"] for a in activities)

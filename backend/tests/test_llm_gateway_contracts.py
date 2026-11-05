"""Regression tests for enterprise LLM gateway contracts.

Ensures:
1. Only minimal payloads {"model": ..., "messages": [...]} are sent to the gateway.
2. Unverified parameters like temperature and max_tokens are omitted from HTTP transmissions.
3. Chat URL construction never appends an automatic /v1.
4. Response parsing strictly handles choices[0].message.content and standardized {success, response/error}.
5. Consumers do not mask LLM failures with fake 200 success responses.
6. Streaming SSE contracts and embedding endpoints work as expected.
"""

from __future__ import annotations

import json
import unittest
from unittest.mock import MagicMock, patch

from llm.openai_wrapper import OpenAIWrapper
from api.routes.llm_clients import (
    LLMError,
    chatgpt_complete,
    chatgpt_complete_json,
    nemotron_summarize,
    run_llm_text,
    run_llm_json,
)


class TestOpenAIPayloadContract(unittest.TestCase):
    def setUp(self):
        self.wrapper = OpenAIWrapper(
            api_key="test-secret-key-12345",
            base_url="https://gateway.example.com/custom/path",
            default_model="openai.gpt-5.6-luna",
            embedding_model="vertex_ai.gemini-embedding-2",
        )

    def test_minimal_chat_payload_omits_temperature_and_extra_args(self):
        """Gateway explicitly rejects temperature; payload must only include model and messages."""
        payload = self.wrapper._chat_payload(
            prompt="Analyze account 9999",
            model="openai.gpt-5.6-luna",
            system_prompt="You are a fraud detector.",
            temperature=0.5,
            max_tokens=1000,
            top_p=0.9,
            extra_param="rejected_by_gateway",
        )

        # Strictly only model and messages in the chat payload
        self.assertEqual(set(payload.keys()), {"model", "messages"})
        self.assertEqual(payload["model"], "openai.gpt-5.6-luna")
        self.assertEqual(len(payload["messages"]), 2)
        self.assertEqual(payload["messages"][0], {"role": "system", "content": "You are a fraud detector."})
        self.assertEqual(payload["messages"][1], {"role": "user", "content": "Analyze account 9999"})
        self.assertNotIn("temperature", payload)
        self.assertNotIn("max_tokens", payload)
        self.assertNotIn("top_p", payload)
        self.assertNotIn("extra_param", payload)

    def test_strip_openai_prefix_from_model(self):
        """Ensure openai: prefix is stripped from model parameter."""
        payload = self.wrapper._chat_payload(
            prompt="Hello",
            model="openai:openai.gpt-5.6-luna",
        )
        self.assertEqual(payload["model"], "openai.gpt-5.6-luna")

    def test_streaming_payload_only_adds_stream_flag(self):
        """Streaming flag is permitted when stream=True, but temperature remains excluded."""
        payload = self.wrapper._chat_payload(
            prompt="Explain layering",
            stream=True,
            temperature=0.7,
        )
        self.assertEqual(set(payload.keys()), {"model", "messages", "stream"})
        self.assertTrue(payload["stream"])
        self.assertNotIn("temperature", payload)


class TestOpenAIUrlAndHeaders(unittest.TestCase):
    def test_chat_url_never_appends_automatic_v1(self):
        """Base URLs must be preserved exactly, appending only /chat/completions."""
        # Custom org gateway
        w1 = OpenAIWrapper(base_url="https://ai.internal.bank/genai/v2", api_key="k")
        self.assertEqual(w1._chat_url(), "https://ai.internal.bank/genai/v2/chat/completions")

        # Standard v1 endpoint
        w2 = OpenAIWrapper(base_url="https://api.openai.com/v1", api_key="k")
        self.assertEqual(w2._chat_url(), "https://api.openai.com/v1/chat/completions")

        # Base URL that already ends with chat/completions
        w3 = OpenAIWrapper(base_url="https://gateway.bank/endpoint/chat/completions", api_key="k")
        self.assertEqual(w3._chat_url(), "https://gateway.bank/endpoint/chat/completions")

    def test_embeddings_url_appends_embeddings(self):
        w = OpenAIWrapper(base_url="https://ai.internal.bank/genai", api_key="k")
        self.assertEqual(w._embeddings_url(), "https://ai.internal.bank/genai/embeddings")

    def test_headers_include_bearer_and_api_key(self):
        w = OpenAIWrapper(api_key="sk-test-token-abcdef", base_url="https://example.com")
        headers = w._headers()
        self.assertEqual(headers["Authorization"], "Bearer sk-test-token-abcdef")
        self.assertEqual(headers["api-key"], "sk-test-token-abcdef")
        self.assertEqual(headers["Content-Type"], "application/json")


class TestOpenAIGenerateParsing(unittest.TestCase):
    def setUp(self):
        self.wrapper = OpenAIWrapper(
            api_key="test-key",
            base_url="https://mock.gateway/llm",
            default_model="openai.gpt-5.6-luna",
        )

    @patch("requests.post")
    def test_generate_success_standard_contract(self, mock_post):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": "chatcmpl-001",
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": "Transaction indicates potential structuring."},
                    "finish_reason": "stop",
                }
            ],
        }
        mock_post.return_value = mock_response

        res = self.wrapper.generate("Investigate transactions", temperature=0.5)

        self.assertTrue(res["success"])
        self.assertEqual(res["response"], "Transaction indicates potential structuring.")
        self.assertEqual(res["text"], "Transaction indicates potential structuring.")
        self.assertEqual(res["model"], "openai.gpt-5.6-luna")
        self.assertEqual(res["provider"], "openai")
        self.assertEqual(res["finish_reason"], "stop")

        # Verify requests.post was called with payload omitting temperature
        sent_json = mock_post.call_args[1]["json"]
        self.assertNotIn("temperature", sent_json)
        self.assertIn("model", sent_json)
        self.assertIn("messages", sent_json)

    @patch("requests.post")
    def test_generate_http_error_returns_failure(self, mock_post):
        mock_response = MagicMock()
        mock_response.status_code = 400
        mock_response.text = '{"error": {"message": "Invalid request: temperature rejected"}}'
        mock_post.return_value = mock_response

        res = self.wrapper.generate("test prompt")

        self.assertFalse(res["success"])
        self.assertIn("HTTP 400", res["error"])
        self.assertEqual(res["response"], "")
        self.assertEqual(res["text"], "")

    @patch("requests.post")
    def test_generate_blank_content_returns_failure(self, mock_post):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "choices": [{"message": {"role": "assistant", "content": "   "}, "finish_reason": "length"}]
        }
        mock_post.return_value = mock_response

        res = self.wrapper.generate("test prompt")

        self.assertFalse(res["success"])
        self.assertIn("no content", res["error"])
        self.assertEqual(res["response"], "")

    def test_generate_missing_api_key(self):
        w = OpenAIWrapper(api_key="", base_url="https://example.com")
        res = w.generate("test prompt")
        self.assertFalse(res["success"])
        self.assertIn("OPENAI_API_KEY is not configured", res["error"])

    @patch("requests.post")
    def test_generate_embedding_success(self, mock_post):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "data": [{"embedding": [0.012, -0.045, 0.987]}]
        }
        mock_post.return_value = mock_response

        vec = self.wrapper.generate_embedding("AML entity matching")
        self.assertEqual(vec, [0.012, -0.045, 0.987])
        mock_post.assert_called_once()
        self.assertEqual(mock_post.call_args[1]["json"]["model"], "vertex_ai.gemini-embedding-2")

    @patch("requests.post")
    def test_stream_generate_yields_sse_chunks(self, mock_post):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.__enter__.return_value = mock_response
        mock_response.iter_lines.return_value = [
            b'data: {"choices": [{"delta": {"content": "Step 1: "}}]}',
            b'data: {"choices": [{"delta": {"content": "Trace funds"}}]}',
            b'data: [DONE]',
        ]
        mock_post.return_value = mock_response

        chunks = list(self.wrapper.stream_generate("Investigate"))
        self.assertEqual(chunks, ["Step 1: ", "Trace funds"])


class TestLLMClientsRouting(unittest.TestCase):
    @patch("llm.unified_provider.UnifiedLLMProvider.generate")
    def test_chatgpt_complete_success(self, mock_generate):
        mock_generate.return_value = {
            "success": True,
            "response": "Investigation completed with 2 alerts.",
        }
        res = chatgpt_complete("System instruction", "User query")
        self.assertEqual(res, "Investigation completed with 2 alerts.")
        mock_generate.assert_called_once()

    @patch("llm.unified_provider.UnifiedLLMProvider.generate")
    def test_chatgpt_complete_raises_on_failure(self, mock_generate):
        mock_generate.return_value = {
            "success": False,
            "error": "Gateway rejected connection",
        }
        with self.assertRaises(LLMError) as ctx:
            chatgpt_complete("System", "User")
        self.assertIn("Gateway rejected connection", str(ctx.exception))

    @patch("llm.unified_provider.UnifiedLLMProvider.generate")
    def test_chatgpt_complete_json_success(self, mock_generate):
        mock_generate.return_value = {
            "success": True,
            "response": '{"risk_level": "HIGH", "score": 92}',
        }
        parsed = chatgpt_complete_json("System", "User")
        self.assertEqual(parsed, {"risk_level": "HIGH", "score": 92})

    @patch("llm.unified_provider.UnifiedLLMProvider.generate")
    def test_chatgpt_complete_json_raises_on_invalid_json(self, mock_generate):
        mock_generate.return_value = {
            "success": True,
            "response": "Not valid JSON",
        }
        with self.assertRaises(LLMError) as ctx:
            chatgpt_complete_json("System", "User")
        self.assertIn("did not return valid JSON", str(ctx.exception))

    @patch("llm.unified_provider.UnifiedLLMProvider.generate")
    def test_nemotron_summarize_routes_to_openai(self, mock_generate):
        mock_generate.return_value = {
            "success": True,
            "response": "## Current Facts\n- Transaction sum > $50,000",
        }
        summary = nemotron_summarize("graph_tool", "Raw tool node data")
        self.assertIn("Current Facts", summary)
        mock_generate.assert_called_once()

    @patch("llm.unified_provider.UnifiedLLMProvider.generate")
    def test_run_llm_text_and_json(self, mock_generate):
        mock_generate.return_value = {
            "success": True,
            "response": '{"status": "ok"}',
        }
        text_res = run_llm_text("nemotron", "sys", "usr")
        self.assertEqual(text_res, '{"status": "ok"}')

        json_res = run_llm_json("gpt-4o", "sys", "usr")
        self.assertEqual(json_res, {"status": "ok"})


class TestFlaskEndpointsErrorHandling(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import os
        import sys
        sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
        from app import create_app
        cls.app = create_app()
        cls.client = cls.app.test_client()

    def setUp(self):
        from api.services import services
        services.investigation_db = MagicMock()

    @patch("api.routes.llm._get_case_summary_builder")
    @patch("api.routes.llm._get_llm_service")
    def test_case_chat_endpoint_failure_returns_502(self, mock_get_llm, mock_builder):
        """Case chat must return 502/503 when generation fails, never 200 with fallback."""
        mock_builder_inst = MagicMock()
        mock_builder_inst.build_case_summary.return_value = {"case_id": "CASE-101"}
        mock_builder.return_value = mock_builder_inst

        mock_service = MagicMock()
        mock_service.check_connection.return_value = True
        mock_service.chat.return_value = {
            "success": False,
            "error": "Gateway connection timed out",
            "response": "",
        }
        mock_get_llm.return_value = mock_service

        resp = self.client.post("/api/v2/llm/case-chat", json={"case_id": "CASE-101", "message": "Hi"})
        self.assertEqual(resp.status_code, 502)
        data = resp.get_json()
        self.assertFalse(data.get("success"))
        self.assertIn("Gateway connection timed out", data.get("error", ""))

    @patch("api.routes.llm._get_case_summary_builder")
    @patch("api.routes.llm._get_llm_service")
    def test_explain_case_failure_returns_502(self, mock_get_llm, mock_builder):
        """Explain case must return 502 when explanation generation fails."""
        mock_builder_inst = MagicMock()
        mock_builder_inst.build_case_summary.return_value = {"case_id": "CASE-101"}
        mock_builder.return_value = mock_builder_inst

        mock_service = MagicMock()
        mock_service.check_connection.return_value = True
        mock_service.generate.return_value = {
            "success": False,
            "error": "Model rate limit exceeded",
            "response": "",
        }
        mock_get_llm.return_value = mock_service

        resp = self.client.post("/api/v2/llm/explain-case", json={"case_id": "CASE-101"})
        self.assertEqual(resp.status_code, 502)
        data = resp.get_json()
        self.assertFalse(data.get("success"))

    @patch("api.routes.llm._get_case_summary_builder")
    @patch("api.routes.llm._get_llm_service")
    def test_review_questions_failure_returns_502(self, mock_get_llm, mock_builder):
        """Review questions must return 502 when question generation fails."""
        mock_builder_inst = MagicMock()
        mock_builder_inst.build_case_summary.return_value = {"case_id": "CASE-101"}
        mock_builder.return_value = mock_builder_inst

        mock_service = MagicMock()
        mock_service.check_connection.return_value = True
        mock_service.generate.return_value = {
            "success": False,
            "error": "OpenAI 500 error",
            "response": "",
        }
        mock_get_llm.return_value = mock_service

        resp = self.client.post("/api/v2/llm/review-questions", json={"case_id": "CASE-101"})
        self.assertEqual(resp.status_code, 502)
        data = resp.get_json()
        self.assertFalse(data.get("success"))


if __name__ == "__main__":
    unittest.main()

"""
Ollama LLM Wrapper – Docker GPU Only
Author: You + ChatGPT
Purpose: Stable, GPU-backed Ollama integration for AML tools
"""

import os
import requests
import json
import time
from datetime import datetime
from typing import Dict, List, Optional


# =========================
# Configuration
# =========================

DEFAULT_OLLAMA_URL = os.getenv(
    "OLLAMA_BASE_URL",
    "http://localhost:11435"  # Docker Ollama (GPU)
)

DEFAULT_MODEL = os.getenv(
    "OLLAMA_DEFAULT_MODEL",
    "llama3.2:1b"
)

REQUEST_TIMEOUT = int(os.getenv("OLLAMA_TIMEOUT", "60"))


# =========================
# Ollama Wrapper
# =========================

class OllamaWrapper:
    """
    Production-safe wrapper around Ollama HTTP API.
    Designed for Docker + GPU usage.
    """

    def __init__(
        self,
        base_url: str = DEFAULT_OLLAMA_URL,
        default_model: str = DEFAULT_MODEL
    ):
        self.base_url = base_url.rstrip("/")
        self.default_model = default_model
        self.conversation_history: List[Dict] = []

        print("OllamaWrapper initialized")
        print(f"   Base URL : {self.base_url}")
        print(f"   Model    : {self.default_model}")

    # -------------------------
    # Health & Diagnostics
    # -------------------------

    def check_connection(self) -> bool:
        """Check if Ollama server is reachable"""
        try:
            r = requests.get(
                f"{self.base_url}/api/tags",
                timeout=5
            )
            return r.status_code == 200
        except Exception:
            return False

    def list_models(self) -> List[str]:
        """List available models"""
        try:
            r = requests.get(
                f"{self.base_url}/api/tags",
                timeout=10
            )
            if r.status_code == 200:
                return [m["name"] for m in r.json().get("models", [])]
            return []
        except Exception as e:
            print(f"list_models error: {e}")
            return []

    # -------------------------
    # Core Generation
    # -------------------------

    def generate(
        self,
        prompt: str,
        model: Optional[str] = None,
        system_prompt: Optional[str] = None,
        temperature: float = 0.5,
        max_tokens: int = 800
    ) -> Dict:
        """
        Single-shot generation (no history)
        """
        model = model or self.default_model

        payload = {
            "model": model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens
            }
        }

        if system_prompt:
            payload["system"] = system_prompt

        start = time.time()

        try:
            r = requests.post(
                f"{self.base_url}/api/generate",
                json=payload,
                timeout=REQUEST_TIMEOUT
            )

            elapsed = round(time.time() - start, 2)

            if r.status_code != 200:
                return {
                    "success": False,
                    "error": f"HTTP {r.status_code}",
                    "latency_sec": elapsed
                }

            data = r.json()

            return {
                "success": True,
                "response": data.get("response", ""),
                "model": model,
                "tokens": data.get("eval_count", 0),
                "latency_sec": elapsed,
                "timestamp": datetime.utcnow().isoformat()
            }

        except requests.Timeout:
            return {
                "success": False,
                "error": "LLM timeout",
                "latency_sec": REQUEST_TIMEOUT
            }

        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }

    # -------------------------
    # Chat (Contextual)
    # -------------------------

    def chat(
        self,
        message: str,
        model: Optional[str] = None,
        system_prompt: Optional[str] = None,
        use_history: bool = True,
        temperature: float = 0.5,
        max_tokens: int = 800
    ) -> Dict:
        """
        Context-aware chat with optional memory
        """
        model = model or self.default_model

        messages: List[Dict] = []

        if system_prompt:
            messages.append({
                "role": "system",
                "content": system_prompt
            })

        if use_history:
            messages.extend(self.conversation_history)

        messages.append({
            "role": "user",
            "content": message
        })

        payload = {
            "model": model,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens
            }
        }

        start = time.time()

        try:
            r = requests.post(
                f"{self.base_url}/api/chat",
                json=payload,
                timeout=REQUEST_TIMEOUT
            )

            elapsed = round(time.time() - start, 2)

            if r.status_code != 200:
                return {
                    "success": False,
                    "error": f"HTTP {r.status_code}",
                    "latency_sec": elapsed
                }

            data = r.json()
            reply = data.get("message", {}).get("content", "")

            if use_history:
                self.conversation_history.append({
                    "role": "user",
                    "content": message
                })
                self.conversation_history.append({
                    "role": "assistant",
                    "content": reply
                })

            return {
                "success": True,
                "response": reply,
                "model": model,
                "latency_sec": elapsed,
                "timestamp": datetime.utcnow().isoformat()
            }

        except requests.Timeout:
            return {
                "success": False,
                "error": "LLM timeout",
                "latency_sec": REQUEST_TIMEOUT
            }

        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }

    # -------------------------
    # Embeddings (RAG)
    # -------------------------

    def generate_embedding(
        self,
        text: str,
        model: str = "nomic-embed-text"
    ) -> Optional[List[float]]:
        """
        Generate vector embeddings
        """
        payload = {
            "model": model,
            "prompt": text
        }

        try:
            r = requests.post(
                f"{self.base_url}/api/embeddings",
                json=payload,
                timeout=30
            )

            if r.status_code == 200:
                return r.json().get("embedding")

            return None

        except Exception as e:
            print(f"Embedding error: {e}")
            return None

    # -------------------------
    # Utilities
    # -------------------------

    def clear_history(self):
        self.conversation_history = []

    def get_history(self) -> List[Dict]:
        return list(self.conversation_history)

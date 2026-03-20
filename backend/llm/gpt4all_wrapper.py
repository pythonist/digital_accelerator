"""
Local GPT4All wrapper with the same interface used by the Ollama integration.

This lets the rest of the application keep calling:
  - check_connection()
  - list_models()
  - generate()
  - chat()
  - generate_embedding()

without needing a separate local server process.
"""

import os
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from core.optional_imports import safe_import

gpt4all_mod, _GPT4ALL_OK = safe_import("gpt4all")


def _as_bool(raw: Optional[str], default: bool = False) -> bool:
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


DEFAULT_MODEL_DIR = Path(
    os.getenv("GPT4ALL_MODEL_DIR")
    or os.getenv("LLM_MODEL_DIR")
    or (Path(__file__).resolve().parents[1] / "data" / "local_models")
)
DEFAULT_MODEL = (
    os.getenv("GPT4ALL_DEFAULT_MODEL")
    or os.getenv("LLM_DEFAULT_MODEL")
    or "Meta-Llama-3-8B-Instruct.Q4_0.gguf"
)
DEFAULT_EMBED_MODEL = (
    os.getenv("GPT4ALL_EMBED_MODEL")
    or os.getenv("LLM_EMBED_MODEL")
    or "nomic-embed-text-v1.5.f16.gguf"
)
DEFAULT_ALLOW_DOWNLOAD = _as_bool(
    os.getenv("GPT4ALL_ALLOW_DOWNLOAD") or os.getenv("LLM_ALLOW_DOWNLOAD"),
    default=False,
)
DEFAULT_THREADS = int(os.getenv("LLM_THREADS") or os.getenv("GPT4ALL_THREADS") or "0") or None
DEFAULT_CTX = int(os.getenv("LLM_CONTEXT_WINDOW") or os.getenv("GPT4ALL_CONTEXT_WINDOW") or "4096")
DEFAULT_DEVICE = os.getenv("LLM_DEVICE") or os.getenv("GPT4ALL_DEVICE") or "cpu"
REQUEST_TIMEOUT = int(os.getenv("LLM_TIMEOUT") or "120")


class GPT4AllWrapper:
    provider_name = "gpt4all"

    def __init__(
        self,
        default_model: str = DEFAULT_MODEL,
        model_dir: Path = DEFAULT_MODEL_DIR,
        allow_download: bool = DEFAULT_ALLOW_DOWNLOAD,
        n_threads: Optional[int] = DEFAULT_THREADS,
        n_ctx: int = DEFAULT_CTX,
        device: str = DEFAULT_DEVICE,
        embedding_model: str = DEFAULT_EMBED_MODEL,
    ):
        self.default_model = default_model
        self.embedding_model = embedding_model
        self.model_dir = Path(model_dir)
        self.model_dir.mkdir(parents=True, exist_ok=True)
        self.allow_download = allow_download
        self.n_threads = n_threads
        self.n_ctx = n_ctx
        self.device = device
        self.base_url = "local://gpt4all"
        self.conversation_history: List[Dict] = []

        self._lock = threading.RLock()
        self._model = None
        self._model_key = None
        self._embedder = None

        print("Local GPT4All provider initialized")
        print(f"   Model dir : {self.model_dir}")
        print(f"   Model     : {self.default_model}")
        print(f"   Embedding : {self.embedding_model}")

    # -------------------------
    # Internals
    # -------------------------

    def _resolve_model_target(self, requested: Optional[str]) -> Tuple[str, Path]:
        raw = str(requested or "").strip()
        if not raw or (":" in raw and ".gguf" not in raw.lower()):
            raw = self.default_model

        raw_path = Path(raw)
        if raw_path.suffix.lower() == ".gguf" and raw_path.is_absolute():
            return raw_path.name, raw_path.parent

        if raw_path.suffix.lower() == ".gguf":
            return raw_path.name, self.model_dir

        default_path = Path(self.default_model)
        if default_path.suffix.lower() == ".gguf" and default_path.is_absolute():
            return default_path.name, default_path.parent

        return self.default_model, self.model_dir

    def _build_manual_prompt(self, prompt: str, system_prompt: Optional[str] = None, history: Optional[List[Dict]] = None) -> str:
        parts: List[str] = []
        if system_prompt:
            parts.append(f"System:\n{system_prompt}")
        for message in history or []:
            role = "Assistant" if str(message.get("role")).lower() == "assistant" else "User"
            parts.append(f"{role}:\n{message.get('content', '')}")
        parts.append(f"User:\n{prompt}")
        parts.append("Assistant:")
        return "\n\n".join(part.strip() for part in parts if str(part).strip())

    def _ensure_model(self, requested: Optional[str] = None):
        if not _GPT4ALL_OK:
            raise ImportError("gpt4all is not installed")

        model_name, model_dir = self._resolve_model_target(requested)
        model_key = f"{model_dir}|{model_name}"

        with self._lock:
            if self._model is not None and self._model_key == model_key:
                return self._model, model_name

            if self._model is not None:
                try:
                    self._model.close()
                except Exception:
                    pass
                self._model = None
                self._model_key = None

            GPT4All = getattr(gpt4all_mod, "GPT4All")
            self._model = GPT4All(
                model_name,
                model_path=str(model_dir),
                allow_download=self.allow_download,
                n_threads=self.n_threads,
                device=self.device,
                n_ctx=self.n_ctx,
                verbose=False,
            )
            self._model_key = model_key
            return self._model, model_name

    def _ensure_embedder(self):
        if not _GPT4ALL_OK:
            raise ImportError("gpt4all is not installed")

        with self._lock:
            if self._embedder is not None:
                return self._embedder

            Embed4All = getattr(gpt4all_mod, "Embed4All")
            self._embedder = Embed4All(
                self.embedding_model,
                model_path=str(self.model_dir),
                allow_download=self.allow_download,
                n_threads=self.n_threads,
                device=self.device,
            )
            return self._embedder

    # -------------------------
    # Health and diagnostics
    # -------------------------

    def check_connection(self) -> bool:
        if not _GPT4ALL_OK:
            return False
        if self._model is not None:
            return True

        model_name, model_dir = self._resolve_model_target(None)
        if (model_dir / model_name).exists():
            return True

        return bool(self.allow_download)

    def list_models(self) -> List[str]:
        names: List[str] = []

        try:
            if self.model_dir.exists():
                names.extend(
                    sorted({path.name for path in self.model_dir.glob("*.gguf")})
                )
        except Exception:
            pass

        if self.default_model and self.default_model not in names:
            names.insert(0, self.default_model)

        include_catalog = _as_bool(os.getenv("LLM_INCLUDE_REMOTE_MODEL_CATALOG"), default=False)
        if include_catalog and _GPT4ALL_OK:
            try:
                GPT4All = getattr(gpt4all_mod, "GPT4All")
                catalog = GPT4All.list_models()
                for row in catalog:
                    filename = str(row.get("filename") or "").strip()
                    if filename and filename not in names:
                        names.append(filename)
            except Exception:
                pass

        return names

    # -------------------------
    # Generation
    # -------------------------

    def generate(
        self,
        prompt: str,
        model: Optional[str] = None,
        system_prompt: Optional[str] = None,
        temperature: float = 0.5,
        max_tokens: int = 800,
    ) -> Dict:
        start = time.time()
        try:
            llm, resolved_model = self._ensure_model(model)
            with self._lock:
                text = None
                if system_prompt:
                    try:
                        with llm.chat_session(system_message=system_prompt):
                            text = llm.generate(prompt, max_tokens=max_tokens, temp=temperature)
                    except Exception:
                        text = None
                if text is None:
                    composed = self._build_manual_prompt(prompt, system_prompt=system_prompt)
                    text = llm.generate(composed, max_tokens=max_tokens, temp=temperature)

            return {
                "success": True,
                "response": str(text or "").strip(),
                "model": resolved_model,
                "provider": self.provider_name,
                "latency_sec": round(time.time() - start, 2),
                "timestamp": datetime.utcnow().isoformat(),
            }
        except Exception as exc:
            return {
                "success": False,
                "error": str(exc),
                "provider": self.provider_name,
                "latency_sec": round(time.time() - start, 2),
            }

    def chat(
        self,
        message: str,
        model: Optional[str] = None,
        system_prompt: Optional[str] = None,
        use_history: bool = True,
        temperature: float = 0.5,
        max_tokens: int = 800,
    ) -> Dict:
        start = time.time()
        try:
            llm, resolved_model = self._ensure_model(model)
            history = self.conversation_history if use_history else []
            composed = self._build_manual_prompt(message, system_prompt=system_prompt, history=history)

            with self._lock:
                reply = llm.generate(composed, max_tokens=max_tokens, temp=temperature)

            reply = str(reply or "").strip()
            if use_history:
                self.conversation_history.append({"role": "user", "content": message})
                self.conversation_history.append({"role": "assistant", "content": reply})

            return {
                "success": True,
                "response": reply,
                "model": resolved_model,
                "provider": self.provider_name,
                "latency_sec": round(time.time() - start, 2),
                "timestamp": datetime.utcnow().isoformat(),
            }
        except Exception as exc:
            return {
                "success": False,
                "error": str(exc),
                "provider": self.provider_name,
                "latency_sec": round(time.time() - start, 2),
            }

    # -------------------------
    # Embeddings
    # -------------------------

    def generate_embedding(
        self,
        text: str,
        model: Optional[str] = None,
    ) -> Optional[List[float]]:
        try:
            if model and str(model).strip() and str(model).strip() != self.embedding_model:
                self.embedding_model = str(model).strip()
                self._embedder = None

            embedder = self._ensure_embedder()
            vector = embedder.embed(text)
            return list(vector) if vector is not None else None
        except Exception as exc:
            print(f"Embedding error: {exc}")
            return None

    # -------------------------
    # Utilities
    # -------------------------

    def clear_history(self):
        self.conversation_history = []

    def get_history(self) -> List[Dict]:
        return list(self.conversation_history)


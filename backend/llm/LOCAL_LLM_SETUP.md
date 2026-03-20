Local LLM Setup

Goal: run Sentinel and FCC AI features without installing Ollama, a Windows service, or any external `.exe`.

Recommended provider
- Use `gpt4all` for the locked-down bank-laptop scenario.
- Keep `ollama` as the alternative provider when a local daemon is allowed.

Why `gpt4all`
- `pip install gpt4all` is enough for the Python dependency.
- It runs the model inside the app process.
- It can also provide local embeddings through `Embed4All`, which helps RAG and case comparison.

Suggested model sizes
- Text generation: an 8B instruct GGUF model is realistic on a 32 GB RAM laptop.
- Suggested starting point: `Meta-Llama-3-8B-Instruct.Q4_0.gguf`
- Embeddings for RAG and similarity: `nomic-embed-text-v1.5.f16.gguf`

Environment variables
```powershell
$env:LLM_PROVIDER='gpt4all'
$env:LLM_MODEL_DIR='E:\\VS CODE Backup\\Trae\\AI_AML_tool\\backend\\data\\local_models'
$env:GPT4ALL_DEFAULT_MODEL='Meta-Llama-3-8B-Instruct.Q4_0.gguf'
$env:GPT4ALL_EMBED_MODEL='nomic-embed-text-v1.5.f16.gguf'
$env:LLM_ALLOW_DOWNLOAD='false'
```

Optional one-time download on a developer laptop
```powershell
$env:LLM_ALLOW_DOWNLOAD='true'
pip install gpt4all
```

Production-friendly flow
1. Install the Python package with `pip install gpt4all`.
2. Place approved `.gguf` files in `backend/data/local_models` or your configured `LLM_MODEL_DIR`.
3. Set `LLM_PROVIDER=gpt4all`.
4. Restart the backend.

Switch back to Ollama
```powershell
$env:LLM_PROVIDER='ollama'
$env:OLLAMA_BASE_URL='http://localhost:11435'
$env:OLLAMA_DEFAULT_MODEL='llama3.2:1b'
```

Notes
- `gpt4all` removes the daemon requirement, but you still need the model files.
- For bank environments, the safest pattern is to pre-stage approved GGUF files and keep `LLM_ALLOW_DOWNLOAD=false`.

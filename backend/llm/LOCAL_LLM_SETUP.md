AI Provider Setup

Goal: run Sentinel and FCC AI features locally and in Cloud Run without depending on Ollama.

Recommended provider
- Use OpenAI when `OPENAI_API_KEY` is available. This is the fastest path for case explanations, report text, and embeddings.
- Use `gpt4all` as the local fallback for locked-down laptops or offline demos.
- Ollama is disabled by default and should only be enabled if a local daemon is explicitly allowed.

OpenAI setup
```powershell
$env:OPENAI_API_KEY='sk-...'
$env:OPENAI_MODEL='gpt-4o-mini'
$env:OPENAI_EMBED_MODEL='text-embedding-3-small'
$env:LLM_PROVIDER='openai'
$env:LLM_ENABLE_OLLAMA_FALLBACK='false'
```

If `LLM_PROVIDER` is empty and `OPENAI_API_KEY` exists, the app selects OpenAI automatically. If OpenAI is not reachable during provider startup, it falls back to GPT4All.

Why `gpt4all`
- `pip install gpt4all` is enough for the Python dependency.
- It runs the model inside the app process.
- It can also provide local embeddings through `Embed4All`, which helps RAG and case comparison.

Suggested model sizes
- Text generation: an 8B instruct GGUF model is realistic on a 32 GB RAM laptop.
- Fast demo starting point: `qwen2-1_5b-instruct-q4_0.gguf`
- Higher quality, slower CPU option: `Meta-Llama-3-8B-Instruct.Q4_0.gguf`
- Embeddings for RAG and similarity: `nomic-embed-text-v1.5.f16.gguf`

Environment variables
```powershell
$env:LLM_PROVIDER='gpt4all'
$env:LLM_MODEL_DIR='E:\\VS CODE Backup\\Trae\\AI_AML_tool\\backend\\data\\local_models'
$env:GPT4ALL_DEFAULT_MODEL='qwen2-1_5b-instruct-q4_0.gguf'
$env:LLM_CONTEXT_WINDOW='2048'
$env:LLM_MAX_TOKENS='320'
$env:LLM_TOKEN_CAP='320'
$env:GPT4ALL_EMBED_MODEL='nomic-embed-text-v1.5.f16.gguf'
$env:LLM_ALLOW_DOWNLOAD='false'
```

Optional one-time download on a developer laptop
```powershell
$env:LLM_ALLOW_DOWNLOAD='true'
pip install gpt4all
```

Production-friendly flow
1. Prefer OpenAI in Cloud Run by storing `OPENAI_API_KEY` in Secret Manager and setting `LLM_PROVIDER=openai`.
2. For local offline use, install `gpt4all`.
3. Place approved `.gguf` files in `backend/data/local_models` or your configured `LLM_MODEL_DIR`.
4. Set `LLM_PROVIDER=gpt4all`.
5. Restart the backend.

Optional Ollama opt-in
```powershell
$env:LLM_PROVIDER='ollama'
$env:OLLAMA_BASE_URL='http://localhost:11435'
$env:OLLAMA_DEFAULT_MODEL='llama3.2:1b'
$env:LLM_ENABLE_OLLAMA_FALLBACK='true'
```

Notes
- OpenAI is best for speed and Cloud Run reliability.
- `gpt4all` removes the daemon requirement, but you still need the model files.
- For bank environments, the safest pattern is to pre-stage approved GGUF files and keep `LLM_ALLOW_DOWNLOAD=false`.

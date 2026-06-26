# build_docs_index.py
#
# Reads docs, generates embeddings with the configured AI provider, and saves a
# FAISS index for the chat assistant.
#
# Usage from backend/: python build_docs_index.py

import os
import pickle
from pathlib import Path

from core.optional_imports import safe_import
from llm.provider_factory import load_llm_provider


faiss, _FAISS_OK = safe_import("faiss")
np, _NUMPY_OK = safe_import("numpy")

DOCS_DIR = "docs"
INDEX_PATH = "data/faiss_docs_index.bin"
METADATA_PATH = "data/faiss_docs_metadata.pkl"
EMBED_MODEL = os.getenv("OPENAI_EMBED_MODEL") or os.getenv("LLM_EMBED_MODEL") or "nomic-embed-text-v1.5.f16.gguf"


def get_text_files(directory):
    files = []
    for path in Path(directory).rglob("*"):
        if path.suffix.lower() in {".txt", ".md"}:
            files.append(path)
    return files


def build_index(llm_provider):
    print(f"Starting index build from '{DOCS_DIR}'...")
    files = get_text_files(DOCS_DIR)
    if not files:
        print(f"No .txt or .md files found in {DOCS_DIR}. Aborting.")
        return

    all_chunks = []
    metadata = {}
    for path in files:
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
        all_chunks.append(text)
        metadata[len(all_chunks) - 1] = (str(path), text)

    print(f"Generating embeddings for {len(all_chunks)} docs with '{EMBED_MODEL}'...")
    embeddings = []
    for idx, chunk in enumerate(all_chunks, start=1):
        print(f"  Embedding chunk {idx}/{len(all_chunks)}...")
        emb = llm_provider.generate_embedding(chunk, model=EMBED_MODEL)
        if emb:
            embeddings.append(np.array(emb, dtype=np.float32))
        else:
            print(f"  Failed to embed chunk {idx}. Skipping.")

    if not embeddings:
        print("No embeddings were generated. Aborting.")
        return

    embeddings_matrix = np.vstack(embeddings)
    index = faiss.IndexFlatL2(embeddings_matrix.shape[1])
    index.add(embeddings_matrix)

    Path("data").mkdir(exist_ok=True)
    faiss.write_index(index, INDEX_PATH)
    with open(METADATA_PATH, "wb") as f:
        pickle.dump(metadata, f)

    print(f"Saved index to '{INDEX_PATH}' with {len(embeddings)} document chunks.")


if __name__ == "__main__":
    if not _FAISS_OK or not _NUMPY_OK:
        print("Optional dependencies missing for doc index build: faiss/numpy.")
    else:
        provider = load_llm_provider()
        if not provider or not provider.check_connection():
            print("No AI provider is ready. Configure OpenAI or GPT4All first.")
        else:
            build_index(provider)

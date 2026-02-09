# build_docs_index.py
# ---
# This script reads your documentation, generates embeddings,
# and saves them to a separate FAISS index for the chat assistant.
# Run this script from your terminal: python build_docs_index.py
# ---

import os
import pickle
from core.optional_imports import safe_import
faiss, _FAISS_OK = safe_import("faiss")
np, _NUMPY_OK = safe_import("numpy")
from pathlib import Path
from llm.ollama_wrapper import OllamaWrapper # Uses your existing wrapper

# --- Configuration ---
DOCS_DIR = "docs"
INDEX_PATH = "data/faiss_docs_index.bin"
METADATA_PATH = "data/faiss_docs_metadata.pkl"
EMBED_MODEL = "nomic-embed-text" # Use the same model as your RAG setup
# ---------------------

ollama = OllamaWrapper()

def get_text_files(directory):
    """Get all .txt and .md files from the docs directory."""
    files = []
    for f in Path(directory).rglob("*"):
        if f.suffix.lower() in [".txt", ".md"]:
            files.append(f)
    return files

def build_index():
    print(f"🔨 Starting index build from '{DOCS_DIR}'...")
    
    # 1. Read files
    files = get_text_files(DOCS_DIR)
    if not files:
        print(f"❌ No .txt or .md files found in {DOCS_DIR}. Aborting.")
        return

    print(f"Found {len(files)} documentation files.")
    
    all_chunks = []
    metadata = {} # { index: (filepath, chunk_text) }
    
    for f_path in files:
        with open(f_path, 'r', encoding='utf-8') as f:
            text = f.read()
            # Simple chunking (can be made more complex later)
            # For now, we treat each file as one chunk
            all_chunks.append(text)
            metadata[len(all_chunks) - 1] = (str(f_path), text)

    # 2. Generate embeddings
    print(f"Generating embeddings using '{EMBED_MODEL}'...")
    embeddings = []
    for i, chunk in enumerate(all_chunks):
        print(f"  Embedding chunk {i+1}/{len(all_chunks)}...")
        emb = ollama.generate_embedding(chunk, model=EMBED_MODEL)
        if emb:
            embeddings.append(np.array(emb, dtype=np.float32))
        else:
            print(f"⚠️ Failed to embed chunk {i+1}. Skipping.")

    if not embeddings:
        print("❌ No embeddings were generated. Aborting.")
        return

    # 3. Build FAISS Index
    embeddings_matrix = np.vstack(embeddings)
    dim = embeddings_matrix.shape[1]
    
    index = faiss.IndexFlatL2(dim)
    index.add(embeddings_matrix)
    
    # 4. Save Index and Metadata
    Path("data").mkdir(exist_ok=True)
    faiss.write_index(index, INDEX_PATH)
    
    with open(METADATA_PATH, 'wb') as f:
        pickle.dump(metadata, f)
        
    print(f"\n✅ Successfully built and saved index to '{INDEX_PATH}'")
    print(f"Indexed {len(embeddings)} document chunks.")

if __name__ == "__main__":
    if not _FAISS_OK or not _NUMPY_OK:
        print("❌ Optional dependencies missing for doc index build (faiss/numpy).")
    else:
        if not ollama.check_connection():
            print("❌ Ollama is not running. Please start it first with 'ollama serve'.")
        else:
            models = ollama.list_models()

            # FIXED HERE
            if EMBED_MODEL not in models:
                print(f"⚠️ Embedding model '{EMBED_MODEL}' not found. Pulling...")
                os.system(f"ollama pull {EMBED_MODEL}")

            build_index()

try:
    import faiss
except Exception:
    faiss = None

import os
import pickle
import numpy as np
from pathlib import Path
from typing import List


class DocRAGSystem:
    def __init__(self, ollama_wrapper, root_dir: str = "."):
        self.ollama = ollama_wrapper
        self.root_dir = root_dir

        # Paths
        self.data_dir = Path("data")
        self.data_dir.mkdir(exist_ok=True)

        self.index_path = self.data_dir / "docs_faiss.index"
        self.embeddings_path = self.data_dir / "docs_embeddings.npy"
        self.metadata_path = self.data_dir / "docs_metadata.pkl"

        self.embed_model = "nomic-embed-text"

        self.index = None
        self.embeddings = None
        self.metadata = {}

        self._load_index()

    # --------------------------------------------------
    # LOAD
    # --------------------------------------------------
    def _load_index(self):
        try:
            if faiss is not None and self.index_path.exists():
                self.index = faiss.read_index(str(self.index_path))
                print(f"✅ FAISS index loaded ({self.index.ntotal} docs)")
            elif self.embeddings_path.exists():
                self.embeddings = np.load(self.embeddings_path)
                print(f"✅ NumPy embeddings loaded ({len(self.embeddings)} docs)")

            if self.metadata_path.exists():
                with open(self.metadata_path, "rb") as f:
                    self.metadata = pickle.load(f)

        except Exception as e:
            print(f"❌ Failed loading DocRAG index: {e}")

    # --------------------------------------------------
    # BUILD INDEX
    # --------------------------------------------------
    def build_documentation_index(self):
        print("📚 Building documentation RAG index...")

        extensions = [".py", ".md", ".sql", ".js", ".jsx"]
        ignore_dirs = {
            "node_modules", "__pycache__", "venv", ".git",
            "data", "dist", "build"
        }

        documents = []

        for root, dirs, files in os.walk(self.root_dir):
            dirs[:] = [d for d in dirs if d not in ignore_dirs]

            for file in files:
                if any(file.endswith(ext) for ext in extensions):
                    path = Path(root) / file
                    try:
                        text = path.read_text(encoding="utf-8", errors="ignore")
                        if text.strip():
                            wrapped = (
                                f"File: {file}\n"
                                f"Path: {path}\n"
                                f"Content:\n{text[:3000]}"
                            )
                            documents.append((str(path), wrapped))
                    except Exception:
                        continue

        if not documents:
            print("❌ No documents found to index.")
            return

        embeddings = []
        metadata = {}

        print(f"🧠 Generating embeddings for {len(documents)} docs...")
        for idx, (fname, text) in enumerate(documents):
            vec = self.ollama.generate_embedding(text, model=self.embed_model)
            if vec:
                embeddings.append(np.asarray(vec, dtype=np.float32))
                metadata[idx] = (fname, text)

        if not embeddings:
            print("❌ Embedding generation failed.")
            return

        matrix = np.vstack(embeddings)
        dim = matrix.shape[1]

        self.metadata = metadata

        if faiss is not None:
            self.index = faiss.IndexFlatL2(dim)
            self.index.add(matrix)
            faiss.write_index(self.index, str(self.index_path))
            print("⚡ FAISS index created")
        else:
            self.embeddings = matrix
            np.save(self.embeddings_path, matrix)
            print("🐢 NumPy fallback index created")

        with open(self.metadata_path, "wb") as f:
            pickle.dump(self.metadata, f)

        print(f"✅ DocRAG ready with {len(self.metadata)} documents")

    # --------------------------------------------------
    # SEARCH
    # --------------------------------------------------
    def search_docs(self, query_text: str, top_k: int = 3) -> str:
        if not self.metadata:
            return ""

        query_vec = self.ollama.generate_embedding(
            query_text, model=self.embed_model
        )
        if query_vec is None:
            return ""

        q = np.asarray(query_vec, dtype=np.float32).reshape(1, -1)

        if faiss is not None and self.index is not None:
            _, idxs = self.index.search(q, top_k)
            hits = idxs[0]
        else:
            norms = np.linalg.norm(self.embeddings, axis=1) * np.linalg.norm(q)
            scores = np.dot(self.embeddings, q.T).flatten() / norms
            hits = scores.argsort()[-top_k:][::-1]

        context = []
        for idx in hits:
            if idx in self.metadata:
                fname, text = self.metadata[idx]
                context.append(
                    f"--- SOURCE: {fname} ---\n{text}\n"
                )

        return "\n".join(context)

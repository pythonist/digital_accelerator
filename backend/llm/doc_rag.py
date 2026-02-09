try:
    import faiss
except Exception:
    faiss = None

import pickle
import os
from pathlib import Path


class DocRAGSystem:
    def __init__(self, ollama_wrapper, root_dir: str = "."):
        self.ollama = ollama_wrapper
        self.root_dir = root_dir

        self.index_path = "data/faiss_docs_index.bin"
        self.metadata_path = "data/faiss_docs_metadata.pkl"
        self.embed_model = "nomic-embed-text"

        self.index = None
        self.metadata = {}

        if faiss is None:
            print("⚠️ FAISS not available.")
            return

        self._load_index()

    # ==========================================================
    # SAFE LOAD
    # ==========================================================
    def _load_index(self):
        try:
            if not Path(self.index_path).exists() or not Path(self.metadata_path).exists():
                print("⚠️ RAG index missing. Build required.")
                return

            self.index = faiss.read_index(self.index_path)

            with open(self.metadata_path, "rb") as f:
                self.metadata = pickle.load(f)

            # consistency check
            if self.index.ntotal != len(self.metadata):
                print("❌ RAG corruption detected (ntotal mismatch).")
                self.index = None
                self.metadata = {}
                return

            print(f"✅ RAG ready: {self.index.ntotal} docs.")

        except Exception as e:
            print(f"❌ Failed loading RAG: {e}")
            self.index = None
            self.metadata = {}

    # ==========================================================
    # BUILD
    # ==========================================================
    def build_documentation_index(self):
        if faiss is None:
            return

        print("📚 Building documentation index...")

        extensions = [".py", ".md", ".sql", ".jsx", ".js"]
        ignore_dirs = [
            "node_modules",
            "__pycache__",
            "venv",
            ".git",
            "data",
            "dist",
        ]

        documents = []

        for root, dirs, files in os.walk(self.root_dir):
            dirs[:] = [d for d in dirs if d not in ignore_dirs]

            for file in files:
                if any(file.endswith(ext) for ext in extensions):
                    filepath = Path(root) / file
                    try:
                        with open(filepath, "r", encoding="utf-8") as f:
                            content = f.read()

                        if content.strip():
                            doc_text = f"File: {file}\nPath: {filepath}\nContent:\n{content[:3000]}"
                            documents.append((str(filepath), doc_text))
                            print(f"  - {file}")

                    except Exception as e:
                        print(f"  - Skip {file}: {e}")

        if not documents:
            print("❌ Nothing to index.")
            return

        print(f"🧠 Embedding {len(documents)} docs...")

        embeddings = []
        metadata = {}

        for idx, (fname, text) in enumerate(documents):
            emb = self.ollama.generate_embedding(text, model=self.embed_model)
            if emb is None:
                continue

            vec = np.array(emb, dtype=np.float32)
            embeddings.append(vec)
            metadata[idx] = (fname, text)

        if not embeddings:
            print("❌ Embedding failed.")
            return

        matrix = np.vstack(embeddings)
        dim = matrix.shape[1]

        index = faiss.IndexFlatL2(dim)
        index.add(matrix)

        # atomic save
        os.makedirs("data", exist_ok=True)
        faiss.write_index(index, self.index_path)
        with open(self.metadata_path, "wb") as f:
            pickle.dump(metadata, f)

        self.index = index
        self.metadata = metadata

        print(f"✅ Build complete: {len(metadata)} docs.")

    # ==========================================================
    # SEARCH
    # ==========================================================
    def search_docs(self, query_text: str, top_k: int = 3) -> str:
        if faiss is None:
            return ""

        if self.index is None or self.index.ntotal == 0:
            return "No context available."

        try:
            emb = self.ollama.generate_embedding(query_text, model=self.embed_model)
            if emb is None:
                return ""

            q = np.array(emb, dtype=np.float32).reshape(1, -1)
            distances, indices = self.index.search(q, top_k)

            parts = []
            for idx in indices[0]:
                if idx in self.metadata:
                    fname, text = self.metadata[idx]
                    parts.append(f"--- SOURCE: {fname} ---\n{text}\n")

            return "\n".join(parts)

        except Exception as e:
            print(f"❌ Search failed: {e}")
            return ""

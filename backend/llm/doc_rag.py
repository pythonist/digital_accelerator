try:
    import faiss
except Exception:
    faiss = None
import pickle
import numpy as np
import os
from pathlib import Path
from typing import List, Tuple

class DocRAGSystem:
    def __init__(self, ollama_wrapper, root_dir: str = "."):
        self.ollama = ollama_wrapper
        self.root_dir = root_dir
        
        # Configuration
        self.index_path = "data/faiss_docs_index.bin"
        self.metadata_path = "data/faiss_docs_metadata.pkl"
        self.embed_model = "nomic-embed-text" # Best for retrieval, distinct from chat model
        
        self.index = None
        self.metadata = {} # Maps index_id -> (filename, content_snippet)
        if faiss is None:
            return
        self._load_index()

    def _load_index(self):
        """Loads the document index from disk."""
        if faiss is None:
            return
        try:
            if Path(self.index_path).exists() and Path(self.metadata_path).exists():
                self.index = faiss.read_index(self.index_path)
                with open(self.metadata_path, 'rb') as f:
                    self.metadata = pickle.load(f)
                print(f"✅ Document RAG loaded: {self.index.ntotal} documents indexed.")
            else:
                print("⚠️ Document RAG index not found. Run build_documentation_index() to create it.")
        except Exception as e:
            print(f"❌ Error loading document RAG index: {e}")

    def build_documentation_index(self):
        """Scans codebase and DB schema to build the knowledge base."""
        if faiss is None:
            return
        print("📚 Starting documentation index build...")
        
        # 1. Define what to scan
        extensions = ['.py', '.md', '.sql', '.jsx', '.js']
        ignore_dirs = ['node_modules', '__pycache__', 'venv', '.git', 'data', 'dist']
        
        documents = [] # (filename, content)
        
        # 2. Walk the directory
        for root, dirs, files in os.walk(self.root_dir):
            # Remove ignored directories
            dirs[:] = [d for d in dirs if d not in ignore_dirs]
            
            for file in files:
                if any(file.endswith(ext) for ext in extensions):
                    filepath = Path(root) / file
                    try:
                        with open(filepath, 'r', encoding='utf-8') as f:
                            content = f.read()
                            
                        # Simple chunking: If file is huge, just take first 2000 chars for now
                        # For better RAG, you'd implement a sliding window here.
                        if len(content.strip()) > 0:
                            # Add file context wrapper
                            doc_text = f"File: {file}\nPath: {filepath}\nContent:\n{content[:3000]}"
                            documents.append((str(filepath), doc_text))
                            print(f"  - Indexed: {file}")
                    except Exception as e:
                        print(f"  - Skipped {file}: {e}")

        if not documents:
            print("❌ No documents found to index.")
            return

        # 3. Generate Embeddings using Ollama
        embeddings_list = []
        valid_metadata = {}
        
        print(f"🧠 Generating embeddings for {len(documents)} files...")
        for idx, (fname, text) in enumerate(documents):
            emb = self.ollama.generate_embedding(text, model=self.embed_model)
            if emb:
                embeddings_list.append(np.array(emb, dtype=np.float32))
                valid_metadata[idx] = (fname, text)
            else:
                print(f"Failed to embed {fname}")

        if not embeddings_list:
            print("❌ Embedding generation failed.")
            return

        # 4. Save to FAISS
        embeddings_matrix = np.vstack(embeddings_list)
        dimension = embeddings_matrix.shape[1]
        
        self.index = faiss.IndexFlatL2(dimension)
        self.index.add(embeddings_matrix)
        self.metadata = valid_metadata
        
        faiss.write_index(self.index, self.index_path)
        with open(self.metadata_path, 'wb') as f:
            pickle.dump(self.metadata, f)
            
        print(f"✅ Documentation Index built successfully with {len(valid_metadata)} entries.")

    def search_docs(self, query_text: str, top_k: int = 3) -> str:
        """Search the doc index and return formatted context."""
        if faiss is None:
            return ""
        if self.index is None or self.index.ntotal == 0:
            return "No tool context is available (Index empty)."

        try:
            query_emb = self.ollama.generate_embedding(query_text, model=self.embed_model)
            if query_emb is None:
                return ""
            
            query_vector = np.array(query_emb, dtype=np.float32).reshape(1, -1)
            distances, indices = self.index.search(query_vector, top_k)
            
            context_parts = []
            for dist, idx in zip(distances[0], indices[0]):
                if idx in self.metadata:
                    filename, text = self.metadata[idx]
                    # Only include if similarity is reasonable (L2 distance check)
                    context_parts.append(f"--- SOURCE: {filename} ---\n{text}\n")
            
            return "\n".join(context_parts)
        
        except Exception as e:
            print(f"Error searching docs: {e}")
            return ""

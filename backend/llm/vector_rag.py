# llm/vector_rag.py

from core.optional_imports import safe_import
np, _NUMPY_OK = safe_import("numpy")
import pickle
import requests
import json
import os
import time
from pathlib import Path
from typing import List, Dict, Tuple, Optional
from datetime import datetime
import sqlite3

faiss, _FAISS_OK = safe_import("faiss")

class VectorRAGSystem:
    """
    Enhanced offline vector search system for case retrieval using Cosine Similarity.
    Includes batch operations, metrics tracking, and LLM explanations.
    """
    
    def __init__(
        self,
        db_manager,
        vector_store_path: str,
        ollama_base_url='http://localhost:11434',
        embedding_model=None,
        llm_provider=None,
    ):
        self.db_manager = db_manager
        self.base_path = vector_store_path
        self.ollama_base_url = ollama_base_url
        self.llm_provider = llm_provider
        self.embedding_model = (
            embedding_model
            or getattr(llm_provider, "embedding_model", None)
            or 'nomic-embed-text'
        )
        
        self.index = None
        self.fallback_matrix = None
        self.case_id_map = {}  # Maps Index ID -> Case ID
        self.case_metadata_map = {}  # Maps Case ID -> Summary Text (for display)
        self.embedding_dim = None 
        self.embedding_dim = None 
        self.id_col_name = 'case_id'
        self.last_build_time = None
        self.build_metrics = {}
        
        os.makedirs(self.base_path, exist_ok=True)
        self.index_path = os.path.join(self.base_path, 'cases_faiss.bin')
        self.fallback_path = os.path.join(self.base_path, 'cases_embeddings.npy')
        self.metadata_path = os.path.join(self.base_path, 'cases_meta.pkl')
        self.metrics_path = os.path.join(self.base_path, 'build_metrics.json')

    def _table_exists(self, table_name, cursor):
        """Helper to safely check if table exists"""
        try:
            cursor.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?", (table_name,))
            return cursor.fetchone()[0] > 0
        except:
            return False

    def generate_embeddings_batch(self, texts: List[str], batch_size: int = 32) -> Optional[List[np.ndarray]]:
        """
        Generates embeddings with the active provider.
        Falls back to Ollama HTTP batch mode for backward compatibility.
        """
        if not _NUMPY_OK:
            return None
        if not texts: 
            return []

        if self.llm_provider and hasattr(self.llm_provider, 'generate_embedding'):
            all_embeddings = []
            total = len(texts)
            for idx, text in enumerate(texts, start=1):
                try:
                    if idx == 1 or idx % 50 == 0 or idx == total:
                        print(f"  -> Embedding {idx}/{total} with local provider...")
                    emb = self.llm_provider.generate_embedding(text, model=self.embedding_model)
                    if emb:
                        all_embeddings.append(np.array(emb, dtype=np.float32))
                except Exception as exc:
                    print(f"    Warning: local embedding failed for item {idx}: {exc}")
            return all_embeddings if all_embeddings else None
        
        all_embeddings = []
        total_batches = (len(texts) + batch_size - 1) // batch_size
        
        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            batch_num = (i // batch_size) + 1
            
            try:
                print(f"  → Processing batch {batch_num}/{total_batches} ({len(batch)} texts)...")
                response = requests.post(
                    f"{self.ollama_base_url}/api/embed",
                    json={'model': self.embedding_model, 'input': batch},
                    timeout=300
                )
                
                if response.status_code == 200:
                    data = response.json()
                    if 'embeddings' in data:
                        batch_embeddings = [np.array(e, dtype=np.float32) for e in data['embeddings']]
                        all_embeddings.extend(batch_embeddings)
                    else:
                        print(f"    ⚠️ No embeddings in response for batch {batch_num}")
                else:
                    print(f"    ❌ Batch {batch_num} failed: HTTP {response.status_code}")
                    
            except requests.Timeout:
                print(f"    ⏱️ Batch {batch_num} timed out, retrying with smaller chunks...")
                # Retry with smaller batch
                if len(batch) > 1:
                    mid = len(batch) // 2
                    sub_batch_1 = batch[:mid]
                    sub_batch_2 = batch[mid:]
                    for sub_batch in [sub_batch_1, sub_batch_2]:
                        try:
                            response = requests.post(
                                f"{self.ollama_base_url}/api/embed",
                                json={'model': self.embedding_model, 'input': sub_batch},
                                timeout=180
                            )
                            if response.status_code == 200:
                                data = response.json()
                                if 'embeddings' in data:
                                    sub_embeddings = [np.array(e, dtype=np.float32) for e in data['embeddings']]
                                    all_embeddings.extend(sub_embeddings)
                        except Exception as sub_e:
                            print(f"      ❌ Sub-batch failed: {sub_e}")
                            
            except Exception as e:
                print(f"    ⚠️ Batch {batch_num} error: {e}")
        
        return all_embeddings if all_embeddings else None

    def generate_embedding(self, text: str) -> Optional[np.ndarray]:
        """Single string embedding with retry logic"""
        if not _NUMPY_OK:
            return None
        if self.llm_provider and hasattr(self.llm_provider, 'generate_embedding'):
            try:
                emb = self.llm_provider.generate_embedding(text, model=self.embedding_model)
                if emb:
                    return np.array(emb, dtype=np.float32)
            except Exception as exc:
                print(f"  Warning: local embedding failed: {exc}")
        max_retries = 3
        for attempt in range(max_retries):
            try:
                response = requests.post(
                    f"{self.ollama_base_url}/api/embeddings",
                    json={'model': self.embedding_model, 'prompt': text},
                    timeout=30
                )
                if response.status_code == 200:
                    embedding = response.json().get('embedding', [])
                    if embedding:
                        return np.array(embedding, dtype=np.float32)
            except Exception as e:
                if attempt < max_retries - 1:
                    print(f"  ⚠️ Embedding attempt {attempt + 1} failed, retrying...")
                    time.sleep(1)
                else:
                    print(f"  ❌ Error generating embedding after {max_retries} attempts: {e}")
        return None

    def build_case_embeddings(self, force_rebuild=False):
        """Builds normalized FAISS index for Cosine Similarity with enhanced metrics."""
        if not _NUMPY_OK:
            return {'success': False, 'error': 'numpy not installed'}
        
        if os.path.exists(self.index_path) and not force_rebuild:
            self.load_index()
            return {'success': True, 'message': 'Index already exists', 'loaded': True}
        
        build_start = time.time()
        print(f"🔨 Building enriched case embeddings...")
        
        conn = self.db_manager.connect()
        cursor = conn.cursor()
        
        temp_id_map = {}     # Index -> CaseID
        temp_meta_map = {}   # CaseID -> Summary Text
        
        try:
            # 1. CRITICAL CHECK: Does 'cases' table exist?
            if not self._table_exists('cases', cursor):
                print("⚠️ Table 'cases' not found. Skipping embedding build (Data not loaded yet).")
                return {'success': False, 'error': 'No cases table found'}

            # 2. Detect ID Column
            cursor.execute("PRAGMA table_info(cases)")
            columns = [c[1] for c in cursor.fetchall()]
            candidates = ['caseid', 'case_id', 'Case_ID', 'ID', 'id']
            self.id_col_name = next((c for c in candidates if c in columns), 'case_id')
            print(f"  ℹ️ Using ID column: {self.id_col_name}")

            # 3. Fetch All Cases
            cursor.execute(f'SELECT "{self.id_col_name}" FROM cases')
            cases = cursor.fetchall()
            
            total_cases = len(cases)
            if total_cases == 0:
                print("⚠️ No cases found in table.")
                return {'success': False, 'error': 'Table empty'}

            print(f"  📊 Found {total_cases} cases. Generating rich summaries...")
            
            texts_to_embed = []
            valid_case_ids = []

            for idx, row in enumerate(cases):
                c_id = row[0]
                if (idx + 1) % 100 == 0:
                    print(f"    → Processed {idx + 1}/{total_cases} summaries...")
                    
                # Rich Summary Generation
                summary = self._generate_rich_case_summary(c_id, cursor, self.id_col_name)
                if summary:
                    texts_to_embed.append(summary)
                    valid_case_ids.append(c_id)
                    temp_meta_map[str(c_id)] = summary

            if not texts_to_embed:
                return {'success': False, 'error': 'No valid cases to embed'}

            # 4. Generate Embeddings with Progress
            print(f"  🧠 Embedding {len(texts_to_embed)} vectors...")
            embedding_start = time.time()
            embeddings_list = self.generate_embeddings_batch(texts_to_embed, batch_size=32)
            embedding_time = time.time() - embedding_start
            
            if not embeddings_list or len(embeddings_list) == 0:
                return {'success': False, 'error': 'Failed to generate embeddings'}

            # 5. Create Normalized Index (Cosine Similarity)
            if _FAISS_OK:
                print(f"  🔢 Building FAISS index...")
            else:
                print(f"  🔢 Building fallback cosine matrix (FAISS not available)...")
            embeddings_matrix = np.vstack(embeddings_list)
            
            # CRITICAL STEP: Normalize vectors to length 1
            norms = np.linalg.norm(embeddings_matrix, axis=1, keepdims=True)
            norms[norms == 0] = 1.0
            embeddings_matrix = embeddings_matrix / norms
            
            self.embedding_dim = embeddings_matrix.shape[1] 
            
            if _FAISS_OK:
                # Use Inner Product (IP) index. With normalized vectors, IP == Cosine Similarity
                self.index = faiss.IndexFlatIP(self.embedding_dim)
                self.index.add(embeddings_matrix)
            else:
                self.fallback_matrix = embeddings_matrix
            
            # Update Maps
            self.case_id_map = {i: cid for i, cid in enumerate(valid_case_ids)}
            self.case_metadata_map = temp_meta_map
            self.last_build_time = datetime.now().isoformat()
            
            # Calculate metrics
            build_time = time.time() - build_start
            self.build_metrics = {
                'total_cases': total_cases,
                'indexed_cases': len(valid_case_ids),
                'embedding_dim': self.embedding_dim,
                'build_time_seconds': round(build_time, 2),
                'embedding_time_seconds': round(embedding_time, 2),
                'last_build': self.last_build_time,
                'model': self.embedding_model
            }
            
            self.save_index()
            
            print(f"✅ Index built successfully!")
            print(f"  📈 Metrics: {self.embedding_dim}D space, {self.index.ntotal} vectors")
            print(f"  ⏱️ Build time: {build_time:.2f}s (embedding: {embedding_time:.2f}s)")
            
            return {
                'success': True,
                'case_count': len(valid_case_ids),
                'dimension': self.embedding_dim,
                'build_time': build_time,
                'metrics': self.build_metrics
            }

        except Exception as e:
            print(f"❌ Build Error: {e}")
            return {'success': False, 'error': str(e)}
        finally:
            self.db_manager.close_connection(conn)

    def _generate_rich_case_summary(self, case_id: str, cursor, id_col) -> str:
        """
        Creates a dense textual representation of the case for semantic matching.
        Enhanced with more contextual information.
        """
        parts = [f"Case {case_id}"]
        
        # 1. Fetch Basic Case Details
        try:
            q = f'SELECT risk_rating, total_amount, disposition, status FROM cases WHERE "{id_col}" = ?'
            cursor.execute(q, [case_id])
            res = cursor.fetchone()
            if res:
                risk, amt, disp, status = res
                if risk:
                    parts.append(f"Risk: {risk}")
                if amt:
                    parts.append(f"Amount: {amt}")
                if disp:
                    parts.append(f"Disposition: {disp}")
                if status:
                    parts.append(f"Status: {status}")
        except Exception as e:
            pass

        # 2. Fetch Alert Types
        try:
            q_alert = f'SELECT alert_type, alert_description FROM alerts WHERE "{id_col}" = ?'
            cursor.execute(q_alert, [case_id])
            rows = cursor.fetchall()
            if rows:
                alert_types = [str(r[0]) for r in rows if r[0]]
                if alert_types:
                    parts.append(f"Alerts: {', '.join(set(alert_types))}")
        except:
            pass

        # 3. Fetch Transaction Patterns
        try:
            q_txn = f'SELECT transaction_type, COUNT(*) as cnt FROM transactions WHERE "{id_col}" = ? GROUP BY transaction_type'
            cursor.execute(q_txn, [case_id])
            rows = cursor.fetchall()
            if rows:
                txn_summary = [f"{r[0]}({r[1]})" for r in rows if r[0]]
                if txn_summary:
                    parts.append(f"Transactions: {', '.join(txn_summary)}")
        except:
            pass

        # Combine into semantic text
        return ". ".join(parts) + "."

    def search_similar_cases(self, query_case_id: str, top_k: int = 5) -> List[Dict]:
        """Finds similar cases. Returns Case ID, Score, and Summary."""
        if not self.index and self.fallback_matrix is None: 
            self.load_index()
        if not self.index and self.fallback_matrix is None: 
            return []
        
        # Get the summary text for the query case
        query_text = self.case_metadata_map.get(str(query_case_id))
        
        # If not in memory (new case), fetch from DB
        if not query_text:
            conn = self.db_manager.connect()
            query_text = self._generate_rich_case_summary(query_case_id, conn.cursor(), self.id_col_name)
            self.db_manager.close_connection(conn)
        
        if not query_text: 
            return []

        query_vec = self.generate_embedding(query_text)
        if query_vec is None: 
            return []

        return self._search_index(query_vec, top_k, exclude_id=query_case_id)

    def search_by_text(self, query_text: str, top_k: int = 5) -> List[Dict]:
        """Search by natural language hypothesis"""
        if not self.index and self.fallback_matrix is None: 
            self.load_index()
        if not self.index and self.fallback_matrix is None:
            return []
            
        query_vec = self.generate_embedding(query_text)
        if query_vec is None: 
            return []
        return self._search_index(query_vec, top_k)

    def batch_compare_cases(self, case_ids: List[str], top_k: int = 5) -> Dict:
        """
        Compare multiple cases and return similarity matrix.
        Returns comparison scores between all pairs.
        """
        if not self.index and self.fallback_matrix is None:
            self.load_index()
        if not self.index and self.fallback_matrix is None:
            return {'error': 'Index not loaded'}
        
        results = []
        
        for source_id in case_ids:
            similar = self.search_similar_cases(source_id, top_k=len(case_ids))
            # Filter to only include cases in our batch
            filtered = [s for s in similar if s['case_id'] in case_ids]
            results.append({
                'case_id': source_id,
                'comparisons': filtered
            })
        
        return {'comparison_matrix': results}

    def _search_index(self, vector, k, exclude_id=None):
        """Internal search with normalized vectors"""
        if vector.shape[0] != self.embedding_dim: 
            return []

        # Normalize query vector for Cosine Similarity
        query_vector = vector.reshape(1, -1)
        qn = np.linalg.norm(query_vector, axis=1, keepdims=True)
        qn[qn == 0] = 1.0
        query_vector = query_vector / qn

        if self.index is not None and _FAISS_OK:
            distances, indices = self.index.search(query_vector, k + 5)
        elif self.fallback_matrix is not None:
            scores = np.dot(self.fallback_matrix, query_vector.T).reshape(-1)
            order = np.argsort(scores)[::-1][: (k + 5)]
            distances = scores[order].reshape(1, -1)
            indices = order.reshape(1, -1)
        else:
            return []
        
        results = []
        for score, idx in zip(distances[0], indices[0]):
            if idx < 0: 
                continue
            
            found_case_id = self.case_id_map.get(idx)
            if exclude_id and str(found_case_id) == str(exclude_id): 
                continue
            
            # Score is already Cosine Similarity (-1 to 1) due to InnerProduct + Normalization
            # Clip to 0-1 for display
            final_score = max(0.0, min(1.0, float(score)))
            
            results.append({
                'case_id': found_case_id,
                'similarity_score': final_score,
                'summary': self.case_metadata_map.get(str(found_case_id), "No summary available")
            })
            
            if len(results) >= k:
                break
        
        return results

    def explain_similarity(self, case_id_1: str, case_id_2: str, similarity_score: float, model: str = 'llama3.2:1b') -> str:
        """
        Generate natural language explanation of why two cases are similar using LLM.
        """
        try:
            try:
                similarity_value = float(similarity_score)
            except Exception:
                similarity_value = 0.0
            # Get summaries for both cases
            summary_1 = self.case_metadata_map.get(str(case_id_1), "Case details unavailable")
            summary_2 = self.case_metadata_map.get(str(case_id_2), "Case details unavailable")
            
            # Create prompt for LLM
            prompt = f"""Analyze why these two AML cases are similar (similarity score: {similarity_value:.2%}):

Case 1: {summary_1}

Case 2: {summary_2}

Provide a concise explanation (2-3 sentences) highlighting the key patterns, risk factors, or behaviors that make these cases similar. Focus on specific details like transaction types, amounts, risk levels, and alert patterns."""

            if self.llm_provider and hasattr(self.llm_provider, 'generate'):
                result = self.llm_provider.generate(
                    prompt=prompt,
                    model=model,
                    temperature=0.7,
                    max_tokens=150,
                )
                if result.get('success'):
                    explanation = str(result.get('response') or '').strip()
                    return explanation if explanation else "Unable to generate explanation."
                return f"LLM Error: {result.get('error', 'Unknown error')}"

            response = requests.post(
                f"{self.ollama_base_url}/api/generate",
                json={
                    'model': model,
                    'prompt': prompt,
                    'stream': False,
                    'options': {
                        'temperature': 0.7,
                        'num_predict': 150
                    }
                },
                timeout=30
            )

            if response.status_code == 200:
                data = response.json()
                explanation = data.get('response', '').strip()
                return explanation if explanation else "Unable to generate explanation."
            try:
                err_json = response.json()
                err_msg = err_json.get('error', 'Unknown error')
                return f"LLM Error: {err_msg} (HTTP {response.status_code})"
            except Exception:
                return f"LLM service unavailable (HTTP {response.status_code})"
                
        except requests.Timeout:
            return "Explanation generation timed out. The LLM service may be busy."
        except Exception as e:
            print(f"❌ LLM Explanation Failed: {e}")
            return f"Could not generate explanation. (Error: {e})"

    def get_index_status(self) -> Dict:
        """Return current index status and metrics"""
        if not self.index and self.fallback_matrix is None:
            self.load_index()
        
        return {
            'index_loaded': self.index is not None or self.fallback_matrix is not None,
            'total_vectors': self.index.ntotal if self.index else (self.fallback_matrix.shape[0] if self.fallback_matrix is not None else 0),
            'embedding_dim': self.embedding_dim,
            'last_updated': self.last_build_time,
            'model': self.embedding_model,
            'metrics': self.build_metrics
        }

    def save_index(self):
        """Save index and metadata with metrics"""
        if not self.index and self.fallback_matrix is None: 
            return
        
        if self.index is not None and _FAISS_OK:
            faiss.write_index(self.index, self.index_path)
        elif self.fallback_matrix is not None:
            np.save(self.fallback_path, self.fallback_matrix)
        
        with open(self.metadata_path, 'wb') as f:
            pickle.dump({
                'case_id_map': self.case_id_map, 
                'case_metadata_map': self.case_metadata_map,
                'embedding_dim': self.embedding_dim,
                'id_col_name': self.id_col_name,
                'last_build_time': self.last_build_time
            }, f)
        
        # Save build metrics separately
        with open(self.metrics_path, 'w') as f:
            json.dump(self.build_metrics, f, indent=2)
        
        print(f"💾 Index saved: {self.index_path}")

    def load_index(self):
        """Load index and metadata"""
        if not _NUMPY_OK:
            print("❌ numpy not available; cannot load index")
            return False
        if not os.path.exists(self.index_path) and not os.path.exists(self.fallback_path): 
            print("ℹ️ No index file found. Build index first.")
            return False
        
        try:
            if _FAISS_OK and os.path.exists(self.index_path):
                self.index = faiss.read_index(self.index_path)
            elif os.path.exists(self.fallback_path):
                self.fallback_matrix = np.load(self.fallback_path)
            
            with open(self.metadata_path, 'rb') as f:
                meta = pickle.load(f)
            
            self.case_id_map = meta['case_id_map']
            self.case_metadata_map = meta.get('case_metadata_map', {})
            self.embedding_dim = meta.get('embedding_dim', 768)
            self.id_col_name = meta.get('id_col_name', 'case_id')
            self.last_build_time = meta.get('last_build_time')
            
            # Load build metrics if available
            if os.path.exists(self.metrics_path):
                with open(self.metrics_path, 'r') as f:
                    self.build_metrics = json.load(f)
            
            if self.index is not None:
                print(f"✅ Index loaded: {self.index.ntotal} vectors in {self.embedding_dim}D space")
            elif self.fallback_matrix is not None:
                print(f"✅ Fallback index loaded: {self.fallback_matrix.shape[0]} vectors in {self.embedding_dim}D space")
            return True
            
        except Exception as e:
            print(f"❌ Failed to load vector index: {e}")
            return False

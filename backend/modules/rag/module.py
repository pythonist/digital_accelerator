import os
import threading
import traceback


def load_docs_rag(ollama):
    try:
        from llm.doc_rag import DocRAGSystem
    except Exception as e:
        print(f"⚠️ Doc RAG deps missing: {e}")
        traceback.print_exc()
        return None
    sys_inst = DocRAGSystem(ollama) if ollama else DocRAGSystem(None)
    try:
        if not getattr(sys_inst, "index", None):
            threading.Thread(target=sys_inst.build_documentation_index, daemon=True).start()
    except Exception:
        traceback.print_exc()
    return sys_inst


def load_vector_rag(investigation_db, vector_store_path=None, llm_provider=None):
    try:
        from llm.vector_rag import VectorRAGSystem
    except Exception as e:
        print(f"⚠️ Vector RAG deps missing: {e}")
        traceback.print_exc()
        return None
    if not investigation_db:
        raise RuntimeError("Investigation DB required for vector RAG")
    rag = VectorRAGSystem(
        investigation_db,
        vector_store_path=vector_store_path,
        llm_provider=llm_provider,
    )
    try:
        rag.load_index()
    except Exception:
        traceback.print_exc()
    return rag


import traceback


def load_graph_builder(investigation_db):
    try:
        from graph_engine.graph_builder import TransactionGraphBuilder
    except Exception as e:
        print(f"⚠️ Graph module unavailable: {e}")
        traceback.print_exc()
        return None
    if not investigation_db:
        raise RuntimeError("Investigation DB required for graph builder")
    return TransactionGraphBuilder(investigation_db)


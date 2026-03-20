import traceback


def load_ollama():
    try:
        from llm.provider_factory import load_llm_provider

        return load_llm_provider()
    except Exception as e:
        print(f"⚠️ AI module unavailable: {e}")
        traceback.print_exc()
        return None


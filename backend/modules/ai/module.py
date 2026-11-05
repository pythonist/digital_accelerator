import traceback


def load_openai():
    try:
        from llm.provider_factory import load_llm_provider

        return load_llm_provider()
    except Exception as e:
        print(f"OpenAI provider unavailable: {e}")
        traceback.print_exc()
        return None


# Backward-compatible alias
load_ollama = load_openai
load_llm = load_openai

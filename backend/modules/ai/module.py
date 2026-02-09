import traceback


def load_ollama():
    try:
        from llm.ollama_wrapper import OllamaWrapper
        return OllamaWrapper()
    except Exception as e:
        print(f"⚠️ AI module unavailable: {e}")
        traceback.print_exc()
        return None


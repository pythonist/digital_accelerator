class MissingDependency:
    def __init__(self, name: str, error: Exception | None = None):
        self._name = name
        self._error = error

    def __getattr__(self, item):
        msg = f"Optional dependency '{self._name}' is not available"
        if self._error:
            msg = f"{msg}: {self._error}"
        raise ImportError(msg)

    def __call__(self, *args, **kwargs):
        msg = f"Optional dependency '{self._name}' is not available"
        if self._error:
            msg = f"{msg}: {self._error}"
        raise ImportError(msg)


def safe_import(module_name: str):
    try:
        import importlib
        module = importlib.import_module(module_name)
        return module, True
    except Exception as e:
        return MissingDependency(module_name, e), False

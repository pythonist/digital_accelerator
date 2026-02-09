class ModuleUnavailable(RuntimeError):
    pass


class ModuleProxy:
    def __init__(self, registry, module_name: str):
        self._registry = registry
        self._module_name = module_name

    def _get(self):
        mod = self._registry.get(self._module_name)
        if mod is None:
            raise ModuleUnavailable(f"Module '{self._module_name}' is unavailable")
        return mod

    def __getattr__(self, item):
        mod = self._get()
        return getattr(mod, item)

    def __call__(self, *args, **kwargs):
        mod = self._get()
        return mod(*args, **kwargs)

    def __bool__(self):
        try:
            return self._registry.available(self._module_name)
        except Exception:
            return False

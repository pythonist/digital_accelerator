"""Profile-aware service binding.

Routes should import `services` from this module when they need to support
AML_BACKEND_PROFILE=mlops without loading full backend services.
"""

import os

_BACKEND_PROFILE = str(os.getenv("AML_BACKEND_PROFILE", "full") or "").strip().lower()

if _BACKEND_PROFILE in {"mlops", "mlops_only"}:
    from api.services_mlops import services
else:
    from api.services import services

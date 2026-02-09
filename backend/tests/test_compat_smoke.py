import json
from app import create_app

def run_smoke():
    app = create_app()
    with app.test_client() as c:
        r1 = c.get("/health")
        print("health:", r1.status_code, r1.get_json())

        r2 = c.get("/health/deep")
        deep = r2.get_json()
        print("deep.modules:", json.dumps(deep.get("modules", {}), indent=2, default=str))

        r3 = c.get("/system/compatibility")
        compat = r3.get_json()
        print("compat.python:", compat.get("python"))
        print("compat.optional_libs:", json.dumps(compat.get("optional_libs", {}), indent=2, default=str))
        print("compat.features:", json.dumps(compat.get("features", {}), indent=2, default=str))

if __name__ == "__main__":
    run_smoke()

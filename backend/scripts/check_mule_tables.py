import os
import sys
import duckdb
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from services.mule_detection.feature_workbench_service import FeatureWorkbenchService
from api.routes.mule_detection.platform_routes import _to_jsonable

db_path = r"data/environments/fcip_env/mule_detection/duckdb/mule_detection.duckdb"
conn = duckdb.connect(db_path)
tables = conn.execute("SHOW TABLES").df()
print(tables.to_string(index=False))
for t in ["mule_transactions", "mule_accounts", "mule_transactions_raw", "mule_accounts_raw", "mule_account_features"]:
    try:
        cnt = conn.execute(f"SELECT COUNT(*) FROM {t} WHERE environment_id = 'fcip_env'").fetchone()[0]
        cols = conn.execute(f"PRAGMA table_info('{t}')").df()
        print(t, "rows", cnt, "cols", len(cols))
    except Exception as e:
        print(t, "error", str(e))
conn.close()

svc = FeatureWorkbenchService("fcip_env")
catalog = svc.features_catalog(target_name="is_mule")
print("catalog_success", catalog.get("success"), "features", len(catalog.get("features") or []))
features = catalog.get("features") or []
bad = 0
for row in features:
    for v in row.values():
        if isinstance(v, float) and (v != v or v == float("inf") or v == float("-inf")):
            bad += 1
            break
print("catalog_nan_rows", bad)
clean = _to_jsonable(catalog)
clean_features = clean.get("features") or []
clean_bad = 0
for row in clean_features:
    for v in row.values():
        if isinstance(v, float) and (v != v or v == float("inf") or v == float("-inf")):
            clean_bad += 1
            break
print("catalog_nan_rows_sanitized", clean_bad)

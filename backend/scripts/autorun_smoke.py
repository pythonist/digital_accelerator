import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import time
import duckdb

from api.tools.btsy.service import get_btsy_service
from api.tools.btsy.autorun.autorun_registry import AutoRunRegistry
from api.tools.btsy.autorun.autorun_executor import AutoRunExecutor
from api.tools.btsy.autorun.autorun_service import AutoRunService


def main():
    btsy = get_btsy_service()
    folders = btsy.init_env_structure('default', 'default')
    index_db = folders['duckdb'] / 'calibration_workbench.duckdb'

    reg = AutoRunRegistry(index_db)
    exe = AutoRunExecutor(reg, max_workers=1)
    svc = AutoRunService(folders, reg, exe, tenant_id='default', env_id='default')

    con = duckdb.connect(str(index_db))
    row = con.execute("select session_id from calibration_sessions order by session_id desc limit 1").fetchone()
    con.close()
    if not row:
        raise SystemExit("No calibration_sessions found")
    sid = int(row[0])

    res = svc.create_run(snapshot_id="FS_default_20260126", session_id=sid, mode="simulation", created_by="smoke")
    run_id = int(res['run_id'])
    print("run_id:", run_id)

    for i in range(30):
        r = reg.get_run(run_id)
        print(i, r['status'], r['progress_pct'], r['current_step'])
        if r['status'] in ('COMPLETED', 'FAILED'):
            print("final:", r.get('error'))
            break
        time.sleep(1)


if __name__ == "__main__":
    main()

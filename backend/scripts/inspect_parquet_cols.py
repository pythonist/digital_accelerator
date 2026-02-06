import sys
from pathlib import Path

import duckdb


def main():
    if len(sys.argv) < 2:
        raise SystemExit("usage: inspect_parquet_cols.py <path-to-parquet>")
    p = Path(sys.argv[1]).resolve()
    p_sql = str(p).replace("'", "''")
    con = duckdb.connect()
    cols = con.execute(f"DESCRIBE SELECT * FROM read_parquet('{p_sql}')").fetchall()
    print("columns", len(cols))
    for c in cols:
        print(c[0], c[1])
    row = con.execute(f"SELECT * FROM read_parquet('{p_sql}') LIMIT 1").df()
    print("sample", row.to_dict(orient="records")[0] if not row.empty else None)


if __name__ == "__main__":
    main()

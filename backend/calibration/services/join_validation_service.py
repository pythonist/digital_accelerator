"""
Join Validation Service - STEP 0 (FIXED)
Performs DRY-RUN join quality validation using MAPPED SOURCE COLUMNS ONLY
Adds identifier sanity checks to prevent wrong mappings
"""

import json

class JoinValidationService:
    """
    STEP 0 Join Validator
    - No table creation
    - No materialization
    - Mapping-driven only
    """
    def get_validation_results(self, env_id):
        """
        Retrieve last persisted join validation results for UI display
        """
        conn = self.db.connect()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT join_step,
                   total_rows,
                   matched_rows,
                   unmatched_rows,
                   match_rate,
                   has_warning
            FROM join_validation_results
            WHERE env_id = ?
            ORDER BY join_step
        """, (env_id,))

        rows = cursor.fetchall()
        conn.close()

        results = []
        for r in rows:
            results.append({
                "step": r[0],
                "total_rows": r[1],
                "matched": r[2],
                "unmatched": r[3],
                "match_rate": r[4],
                "has_warning": bool(r[5]),
                "join_type": "LEFT JOIN"
            })

        return results
    WARNING_THRESHOLD = 80.0          # <80% = warning
    ID_UNIQUENESS_THRESHOLD = 0.90    # <90% = NOT an ID

    def __init__(self, db_manager):
        self.db = db_manager

    # =========================================================
    # PUBLIC API
    # =========================================================
    def validate_joins(self, env_id):
        """
        Validate join quality using mapping config

        Returns:
        {
            success,
            validation_results,
            overall_quality,
            avg_match_rate
        }
        """
        mapping = self._get_mapping(env_id)
        if not mapping:
            raise ValueError("Schema mapping not found")

        self._validate_join_keys_exist(mapping)

        txn_table = f"{env_id}_transactions"
        acc_table = f"{env_id}_accounts"
        cust_table = f"{env_id}_customers"

        conn = self.db.connect()

        # ---- ID SANITY CHECKS (CRITICAL FIX) ----
        # self._validate_identifier_sanity(
        #     conn, acc_table, mapping["accounts"]["customer_id"],
        #     "accounts.customer_id"
        # )
        self._validate_identifier_sanity(
            conn, cust_table, mapping["customers"]["customer_id"],
            "customers.customer_id"
        )

        # ---- JOIN VALIDATION ----
        txn_acc = self._validate_join_step(
            conn,
            txn_table, acc_table,
            mapping["transactions"]["account_id"],
            mapping["accounts"]["account_id"],
            "Transactions → Accounts"
        )

        acc_cust = self._validate_join_step(
            conn,
            acc_table, cust_table,
            mapping["accounts"]["customer_id"],
            mapping["customers"]["customer_id"],
            "Accounts → Customers"
        )

        conn.close()

        results = [txn_acc, acc_cust]
        avg_match_rate = round(
            sum(r["match_rate"] for r in results) / len(results), 2
        )

        overall_quality = (
            "EXCELLENT" if avg_match_rate >= 95 else
            "GOOD" if avg_match_rate >= 80 else
            "POOR"
        )

        self._save_validation_results(env_id, results)

        return {
            "success": True,
            "validation_results": results,
            "avg_match_rate": avg_match_rate,
            "overall_quality": overall_quality
        }

    # =========================================================
    # CORE LOGIC
    # =========================================================
    def _validate_join_step(self, conn, left_table, right_table,
                            left_key, right_key, step_name):
        cursor = conn.cursor()

        cursor.execute(f'SELECT COUNT(*) FROM "{left_table}"')
        total_rows = cursor.fetchone()[0]

        cursor.execute(f'''
            SELECT COUNT(*)
            FROM "{left_table}" l
            LEFT JOIN "{right_table}" r
              ON l."{left_key}" = r."{right_key}"
            WHERE r."{right_key}" IS NOT NULL
        ''')
        matched_rows = cursor.fetchone()[0]

        unmatched_rows = total_rows - matched_rows
        match_rate = round(
            (matched_rows / total_rows * 100), 2
        ) if total_rows else 0

        return {
            "join_step": step_name,
            "join_type": "LEFT JOIN",
            "total_rows": total_rows,
            "matched_rows": matched_rows,
            "unmatched_rows": unmatched_rows,
            "match_rate": match_rate,
            "has_warning": match_rate < self.WARNING_THRESHOLD
        }

    # =========================================================
    # ID SANITY CHECK (THE REAL FIX)
    # =========================================================
    def _validate_identifier_sanity(self, conn, table, column, label):
        """
        Ensures mapped join key is actually an identifier.
        Prevents mapping customer_id → risk_rating, etc.
        """
        cursor = conn.cursor()
        cursor.execute(f'''
            SELECT
                COUNT(DISTINCT "{column}") * 1.0 / COUNT(*)
            FROM "{table}"
            WHERE "{column}" IS NOT NULL
        ''')
        uniqueness_ratio = cursor.fetchone()[0] or 0

        if uniqueness_ratio < self.ID_UNIQUENESS_THRESHOLD:
            raise ValueError(
                f"Invalid mapping detected: {label} is not a true identifier "
                f"(uniqueness={round(uniqueness_ratio, 2)}). "
                f"Please remap correctly."
            )

    # =========================================================
    # MAPPING / METADATA
    # =========================================================
    def _get_mapping(self, env_id):
        conn = self.db.connect()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT mapping_config
            FROM schema_mappings
            WHERE env_id = ? AND mapping_type = 'golden_source'
        """, (env_id,))
        row = cursor.fetchone()
        conn.close()
        return json.loads(row[0]) if row and row[0] else None

    def _validate_join_keys_exist(self, mapping):
        required = [
            ("transactions", "account_id"),
            ("accounts", "account_id"),
            ("accounts", "customer_id"),
            ("customers", "customer_id")
        ]
        for table, key in required:
            if not mapping.get(table, {}).get(key):
                raise ValueError(f"Missing required mapping: {table}.{key}")

    def _save_validation_results(self, env_id, results):
        conn = self.db.connect()
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM join_validation_results WHERE env_id = ?",
            (env_id,)
        )

        for r in results:
            cursor.execute("""
                INSERT INTO join_validation_results
                (env_id, join_step, total_rows, matched_rows,
                 unmatched_rows, match_rate, has_warning)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                env_id,
                r["join_step"],
                r["total_rows"],
                r["matched_rows"],
                r["unmatched_rows"],
                r["match_rate"],
                r["has_warning"]
            ))

        conn.commit()
        conn.close()

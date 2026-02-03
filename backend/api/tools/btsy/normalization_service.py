# backend/api/tools/btsy/normalization_service.py
"""
Normalization Service - FIXED
Applies type transformations only where needed, no TRIM on numeric fields
"""
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional
import time

logger = logging.getLogger(__name__)


class NormalizationService:
    """
    Transforms raw data to canonical format based on mapping contract.
    Applies validation rules and type coercion.
    """
    
    def __init__(self, output_path: Path, snapshot_id: Optional[str] = None):
        self.output_path = output_path
        self.output_path.mkdir(parents=True, exist_ok=True)
        self.snapshot_id = snapshot_id
    
    def normalize_domain(self, domain: str, file_path: Path, mapping_state: Dict, conn, extension_lock_types: Optional[Dict[str, str]] = None) -> Dict:
        """
        Normalize a domain file to canonical format.
        Returns normalization result with statistics.
        """
        start_time = time.time()
        
        logger.info(f"[BTSY] Starting normalization for {domain}")
        
        try:
            p = str(file_path).replace("'", "''")
            ext = file_path.suffix.lower()
            rel = f"read_parquet('{p}')" if ext in ('.parquet', '.pq') else f"read_csv_auto('{p}')"
            # Extract mapping contract
            canonical_to_bank = {}
            for field in mapping_state.get('canonical_fields', []):
                if field['status'] == 'mapped' and field['mapped_column']:
                    canonical_to_bank[field['canonical_name']] = field['mapped_column']
            
            if not canonical_to_bank:
                raise ValueError(f"No mapped fields found for {domain}")
            
            # Build SELECT clause for transformation
            select_parts = []
            transformations = []
            field_stats = {}
            
            for canonical_field, bank_col in canonical_to_bank.items():
                # Get field metadata
                field_meta = next(
                    (f for f in mapping_state['canonical_fields'] if f['canonical_name'] == canonical_field),
                    None
                )
                
                if not field_meta:
                    continue
                
                expected_type = field_meta.get('locked_datatype') or field_meta.get('expected_type') or 'STRING'
                canonical_is_identifier = canonical_field in ('account_id', 'transaction_id', 'customer_id')
                source_datatype = (
                    (mapping_state.get("bank_column_info") or {}).get(bank_col, {}) or {}
                ).get("datatype") or field_meta.get("source_datatype")

                try:
                    raw_nulls = conn.execute(
                        f"""SELECT COUNT(*) FROM {rel} WHERE "{bank_col}" IS NULL"""
                    ).fetchone()[0]
                except Exception:
                    raw_nulls = None
                field_stats[canonical_field] = {
                    "source_column_name": bank_col,
                    "source_type": source_datatype,
                    "expected_type": expected_type,
                    "before": {
                        "nulls": int(raw_nulls) if raw_nulls is not None else None,
                    },
                    "after": {},
                    "changed_rows": None,
                    "nulls_introduced": None,
                }
                
                # Apply type transformations based on expected type
                if 'TIMESTAMP' in expected_type or 'timestamp' in expected_type:
                    # Date parsing with fallback
                    transform = f"""TRY_CAST("{bank_col}" AS TIMESTAMP) AS {canonical_field}"""
                    transformations.append({
                        'field': canonical_field,
                        'transformation': 'timestamp_parse',
                        'success': True
                    })
                
                elif canonical_is_identifier:
                    transform = f"""CAST("{bank_col}" AS VARCHAR) AS {canonical_field}"""
                    transformations.append({
                        'field': canonical_field,
                        'transformation': 'identifier_string',
                        'success': True
                    })

                elif 'float' in expected_type or 'DOUBLE' in expected_type or 'DECIMAL' in expected_type:
                    # Numeric - clean currency symbols and parse
                    target = expected_type if str(expected_type).upper().startswith('DECIMAL') else 'DECIMAL(38,10)'
                    transform = f"""TRY_CAST(REGEXP_REPLACE(CAST("{bank_col}" AS VARCHAR), '[^0-9.-]', '', 'g') AS {target}) AS {canonical_field}"""
                    transformations.append({
                        'field': canonical_field,
                        'transformation': 'numeric_parse',
                        'success': True
                    })
                
                elif 'BOOLEAN' in expected_type or 'bool' in expected_type:
                    # Boolean coercion
                    transform = f"""
                        CASE 
                            WHEN UPPER(CAST("{bank_col}" AS VARCHAR)) IN ('TRUE', 'YES', '1', 'Y') THEN TRUE
                            WHEN UPPER(CAST("{bank_col}" AS VARCHAR)) IN ('FALSE', 'NO', '0', 'N') THEN FALSE
                            ELSE NULL
                        END AS {canonical_field}
                    """
                    transformations.append({
                        'field': canonical_field,
                        'transformation': 'boolean_coerce',
                        'success': True
                    })
                
                else:
                    # String - just cast and trim
                    transform = f"""TRIM(CAST("{bank_col}" AS VARCHAR)) AS {canonical_field}"""
                    transformations.append({
                        'field': canonical_field,
                        'transformation': 'string_normalize',
                        'success': True
                    })
                
                select_parts.append(transform)
            
            # Build query
            select_clause = ',\n            '.join(select_parts)
            
            query = f"""
                SELECT 
                    {select_clause}
                FROM {rel}
            """
            
            logger.info(f"[BTSY] Normalization query:\n{query}")
            
            # Execute transformation
            result_df = conn.execute(query).fetchdf()
            output_rows = len(result_df)
            
            # Get input row count
            input_query = f"SELECT COUNT(*) FROM {rel}"
            input_rows = conn.execute(input_query).fetchone()[0]

            if int(input_rows) != int(output_rows):
                raise ValueError(f"Row count mismatch: input_rows={int(input_rows)} output_rows={int(output_rows)}")
            
            # Validate results
            validation_errors = 0
            validation_warnings = []
            
            for canonical_field in canonical_to_bank.keys():
                if canonical_field in result_df.columns:
                    null_count = result_df[canonical_field].isnull().sum()
                    null_pct = (null_count / output_rows * 100) if output_rows > 0 else 0
                    
                    # Get field requirement
                    field_meta = next(
                        (f for f in mapping_state['canonical_fields'] if f['canonical_name'] == canonical_field),
                        None
                    )
                    
                    if field_meta and field_meta['requirement'] == 'CRITICAL' and null_pct > 0:
                        validation_errors += 1
                        validation_warnings.append(
                            f"{canonical_field}: {null_pct:.1f}% nulls in critical field"
                        )
                    elif null_pct > 50:
                        validation_warnings.append(
                            f"{canonical_field}: {null_pct:.1f}% nulls"
                        )

                    try:
                        if canonical_field in ('transaction_amount',):
                            series = pd.to_numeric(result_df[canonical_field], errors='coerce')
                            field_stats[canonical_field]["after"] = {
                                "nulls": int(series.isna().sum()),
                                "min": float(series.min()) if series.notna().any() else None,
                                "max": float(series.max()) if series.notna().any() else None,
                            }
                        elif canonical_field in ('transaction_datetime', 'account_open_date', 'account_close_date', 'last_dormant_date'):
                            series = pd.to_datetime(result_df[canonical_field], errors='coerce', utc=True)
                            field_stats[canonical_field]["after"] = {
                                "nulls": int(series.isna().sum()),
                                "min": str(series.min()) if series.notna().any() else None,
                                "max": str(series.max()) if series.notna().any() else None,
                            }
                        else:
                            series = result_df[canonical_field].astype("string")
                            field_stats[canonical_field]["after"] = {
                                "nulls": int(series.isna().sum()),
                                "distinct": int(series.nunique(dropna=True)),
                                "max_length": int(series.dropna().map(lambda x: len(str(x))).max()) if series.dropna().shape[0] else None,
                            }
                    except Exception:
                        pass

            try:
                for canonical_field, bank_col in canonical_to_bank.items():
                    raw_expr = f'CAST("{bank_col}" AS VARCHAR)'
                    cast_expr = None
                    expected_type = (field_stats.get(canonical_field) or {}).get("expected_type") or "STRING"
                    canonical_is_identifier = canonical_field in ('account_id', 'transaction_id', 'customer_id')
                    if canonical_is_identifier:
                        cast_expr = f'CAST("{bank_col}" AS VARCHAR)'
                    elif 'TIMESTAMP' in str(expected_type).upper():
                        cast_expr = f'TRY_CAST("{bank_col}" AS TIMESTAMP)'
                    elif str(expected_type).upper().startswith('DECIMAL'):
                        cast_expr = f"TRY_CAST(REGEXP_REPLACE(CAST(\"{bank_col}\" AS VARCHAR), '[^0-9.-]', '', 'g') AS {str(expected_type).upper()})"
                    elif 'DOUBLE' in str(expected_type).upper() or 'FLOAT' in str(expected_type).upper():
                        cast_expr = f"TRY_CAST(REGEXP_REPLACE(CAST(\"{bank_col}\" AS VARCHAR), '[^0-9.-]', '', 'g') AS DECIMAL(38,10))"
                    elif 'BOOLEAN' in str(expected_type).upper():
                        cast_expr = f"""
                            CASE 
                                WHEN UPPER(CAST("{bank_col}" AS VARCHAR)) IN ('TRUE', 'YES', '1', 'Y') THEN TRUE
                                WHEN UPPER(CAST("{bank_col}" AS VARCHAR)) IN ('FALSE', 'NO', '0', 'N') THEN FALSE
                                ELSE NULL
                            END
                        """
                    else:
                        cast_expr = f'TRIM(CAST("{bank_col}" AS VARCHAR))'

                    changed = conn.execute(
                        f"""
                        SELECT COUNT(*)
                        FROM {rel}
                        WHERE "{bank_col}" IS NOT NULL
                          AND {cast_expr} IS NOT NULL
                          AND {raw_expr} != CAST({cast_expr} AS VARCHAR)
                        """
                    ).fetchone()[0]
                    nulls_introduced = conn.execute(
                        f"""
                        SELECT COUNT(*)
                        FROM {rel}
                        WHERE "{bank_col}" IS NOT NULL
                          AND {cast_expr} IS NULL
                        """
                    ).fetchone()[0]
                    if canonical_field in field_stats:
                        field_stats[canonical_field]["changed_rows"] = int(changed)
                        field_stats[canonical_field]["nulls_introduced"] = int(nulls_introduced)

                    if canonical_is_identifier and (int(changed) > 0 or int(nulls_introduced) > 0):
                        raise ValueError(f"Normalization aborted: {canonical_field} is a locked identifier field.")
            except Exception as e:
                raise

            breakdown = []
            try:
                timestamp_fields = [f for f, meta in field_stats.items() if "TIMESTAMP" in str(meta.get("expected_type") or "").upper()]
                numeric_fields = [f for f, meta in field_stats.items() if str(meta.get("expected_type") or "").upper().startswith("DECIMAL")]
                string_fields = [
                    f for f, meta in field_stats.items()
                    if (str(meta.get("expected_type") or "").upper() in ("STRING", "VARCHAR") or "STRING" in str(meta.get("expected_type") or "").upper())
                    and f not in ('account_id', 'transaction_id', 'customer_id')
                ]

                ts_rows = 0
                for f in timestamp_fields:
                    col = field_stats[f]["source_column_name"]
                    ts_rows += int(conn.execute(f'SELECT COUNT(*) FROM {rel} WHERE "{col}" IS NOT NULL').fetchone()[0])

                amt_rows = 0
                for f in numeric_fields:
                    col = field_stats[f]["source_column_name"]
                    amt_rows += int(conn.execute(
                        f"""
                        SELECT COUNT(*)
                        FROM {rel}
                        WHERE "{col}" IS NOT NULL
                          AND REGEXP_REPLACE(CAST("{col}" AS VARCHAR), '[^0-9.-]', '', 'g') != CAST("{col}" AS VARCHAR)
                        """
                    ).fetchone()[0])

                trim_rows = 0
                for f in string_fields:
                    col = field_stats[f]["source_column_name"]
                    trim_rows += int(conn.execute(
                        f"""
                        SELECT COUNT(*)
                        FROM {rel}
                        WHERE "{col}" IS NOT NULL
                          AND TRIM(CAST("{col}" AS VARCHAR)) != CAST("{col}" AS VARCHAR)
                        """
                    ).fetchone()[0])

                null_rows = int(sum((field_stats[f].get("nulls_introduced") or 0) for f in field_stats.keys()))

                breakdown = [
                    {"normalization_type": "Timestamp UTC alignment", "applied": bool(timestamp_fields), "rows_affected": ts_rows},
                    {"normalization_type": "Amount standardization", "applied": bool(numeric_fields), "rows_affected": amt_rows},
                    {"normalization_type": "Null handling", "applied": True, "rows_affected": null_rows},
                    {"normalization_type": "Categorical cleanup", "applied": bool(string_fields), "rows_affected": trim_rows},
                ]
            except Exception:
                breakdown = []
            
            out_dir = self.output_path / str(self.snapshot_id or "latest")
            out_dir.mkdir(parents=True, exist_ok=True)
            output_file = out_dir / f'{domain}.parquet'
            result_df.to_parquet(output_file, index=False)

            extensions_file = None
            try:
                ignored = set(mapping_state.get("ignored_columns") or [])
                bank_cols = set((mapping_state.get("bank_column_info") or {}).keys())
                mapped_bank_cols = set(
                    canonical_to_bank.values()
                )
                ext_cols = [c for c in sorted(bank_cols) if c not in mapped_bank_cols and c not in ignored]

                id_field = None
                if domain == "transactions":
                    id_field = "transaction_id"
                elif domain == "accounts":
                    id_field = "account_id"
                elif domain == "customers":
                    id_field = "customer_id"
                elif domain == "str":
                    id_field = "str_id" if "str_id" in canonical_to_bank else None

                if id_field and id_field in canonical_to_bank and ext_cols:
                    id_bank_col = canonical_to_bank[id_field]
                    p2 = str(file_path).replace("'", "''")
                    ext2 = file_path.suffix.lower()
                    rel2 = f"read_parquet('{p2}')" if ext2 in ('.parquet', '.pq') else f"read_csv_auto('{p2}')"
                    json_args = []
                    for c in ext_cols:
                        safe = c.replace("'", "''")
                        json_args.append(f"'{safe}'")
                        lock_t = (extension_lock_types or {}).get(c)
                        t = str(lock_t or "").upper()
                        if t.startswith("DECIMAL"):
                            json_args.append(f"""TRY_CAST(REGEXP_REPLACE(CAST("{c}" AS VARCHAR), '[^0-9.-]', '', 'g') AS {t})""")
                        elif t == "TIMESTAMP":
                            json_args.append(f"""TRY_CAST("{c}" AS TIMESTAMP)""")
                        elif t == "BOOLEAN":
                            json_args.append(f"""
                                CASE 
                                    WHEN UPPER(CAST("{c}" AS VARCHAR)) IN ('TRUE', 'YES', '1', 'Y') THEN TRUE
                                    WHEN UPPER(CAST("{c}" AS VARCHAR)) IN ('FALSE', 'NO', '0', 'N') THEN FALSE
                                    ELSE NULL
                                END
                            """)
                        else:
                            json_args.append(f"""CAST("{c}" AS VARCHAR)""")
                    ext_query = f"""
                        SELECT
                          CAST("{id_bank_col}" AS VARCHAR) AS {id_field},
                          json_object({", ".join(json_args)}) AS extensions
                        FROM {rel2}
                    """
                    extensions_file = out_dir / f"{domain}_extensions.parquet"
                    dest = str(extensions_file).replace("'", "''")
                    conn.execute(f"COPY ({ext_query}) TO '{dest}' (FORMAT PARQUET)")
            except Exception:
                extensions_file = None
            
            duration_ms = (time.time() - start_time) * 1000
            
            result = {
                'domain': domain,
                'status': 'success',
                'input_rows': int(input_rows),
                'output_rows': int(output_rows),
                'validation_errors': int(validation_errors),
                'validation_warnings': validation_warnings,
                'transformations': transformations,
                'breakdown': breakdown,
                'field_stats': field_stats,
                'integrity': {
                    'row_count_match': int(input_rows) == int(output_rows),
                },
                'output_file': str(output_file),
                'extensions_file': str(extensions_file) if extensions_file else None,
                'duration_ms': int(duration_ms),
                'normalized_at': datetime.now().isoformat()
            }
            
            logger.info(f"[BTSY] Normalization complete: {output_rows} rows, {validation_errors} errors")
            
            return result
            
        except Exception as e:
            logger.error(f"[BTSY] Normalization failed: {str(e)}", exc_info=True)
            
            duration_ms = (time.time() - start_time) * 1000
            
            return {
                'domain': domain,
                'status': 'failed',
                'error': str(e),
                'input_rows': 0,
                'output_rows': 0,
                'validation_errors': 0,
                'validation_warnings': [],
                'transformations': [],
                'duration_ms': int(duration_ms),
                'normalized_at': datetime.now().isoformat()
            }

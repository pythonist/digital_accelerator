"""
Schema Mapping Service - FIXED FOR DATA-DRIVEN EXAMPLES
Manages the mapping between bank schemas and canonical model.

FIX SUMMARY:
1. ✅ Categorical field examples pulled from actual data
2. ✅ Replaces hardcoded examples with real distinct values
3. ✅ Helps ensure correct transaction_type vs transaction_category mapping
"""
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

from .canonical_model import CanonicalAMLModel, FieldRequirement
from .schema_detector import SchemaDetector

logger = logging.getLogger(__name__)


class MappingService:
    """
    Manages schema mapping lifecycle:
    1. Detection of candidates
    2. User confirmation
    3. Validation
    4. Verification
    5. Persistence
    """
    
    def __init__(self, state_path: Path):
        self.state_path = state_path
        self.state_path.mkdir(parents=True, exist_ok=True)

    def _relation_expr(self, file_path: Path) -> str:
        p = str(file_path).replace("'", "''")
        ext = file_path.suffix.lower()
        if ext in ('.parquet', '.pq'):
            return f"read_parquet('{p}')"
        return f"read_csv_auto('{p}')"
    
    def get_mapping_path(self, domain: str) -> Path:
        """Get path to mapping state file"""
        return self.state_path / f'{domain}_mapping.json'
    
    def _get_categorical_samples(self, conn, file_path: Path, column_name: str, max_samples: int = 20) -> List[str]:
        """
        FIX: Get actual distinct values from categorical columns in the data
        Returns real examples instead of hardcoded ones
        """
        try:
            rel = self._relation_expr(file_path)
            query = f'''
                SELECT DISTINCT "{column_name}"
                FROM {rel}
                WHERE "{column_name}" IS NOT NULL
                LIMIT {max_samples}
            '''
            result = conn.execute(query).fetchall()
            samples = [str(row[0]) for row in result if row[0]]
            logger.debug(f"[BTSY] Got {len(samples)} categorical samples for {column_name}")
            return samples
        except Exception as e:
            logger.warning(f"Failed to get categorical samples for {column_name}: {e}")
            return []
    
    def _replace_examples_with_data(
        self, 
        canonical_field, 
        suggested_col: Optional[str],
        bank_column_samples: Dict[str, List[str]]
    ) -> List[str]:
        """
        FIX: Replace canonical examples with actual data for categorical fields
        This helps users see what's REALLY in their data
        """
        # If no mapping suggested, use canonical examples
        if not suggested_col:
            return canonical_field.examples or []
        
        # If not a categorical field, use canonical examples
        if canonical_field.category.value != 'category':
            return canonical_field.examples or []
        
        # Get actual samples from the data
        actual_samples = bank_column_samples.get(suggested_col, [])
        
        # If we have actual samples, use them; otherwise fall back to canonical
        if actual_samples:
            logger.info(
                f"[BTSY] Using data-driven examples for {canonical_field.name}: "
                f"{actual_samples[:5]}"
            )
            return actual_samples
        else:
            return canonical_field.examples or []
    
    def detect_and_suggest(self, domain: str, file_path: Path, conn) -> Dict:
        """
        Detect candidates and suggest mapping.
        FIX: Guaranteed to include ALL canonical fields in the returned state.
        """
        detector = SchemaDetector(conn)
        
        # 1. Get ALL defined fields for this domain from the model
        all_canonical_fields = CanonicalAMLModel.get_schema(domain)
        canonical_field_names = [f.name for f in all_canonical_fields]
        
        # 2. Run detection logic
        candidates = detector.detect_candidates(file_path, canonical_field_names)
        suggested_mapping = detector.auto_suggest_mapping(file_path, canonical_field_names)
        
        # 3. Get source metadata
        rel = self._relation_expr(file_path)
        bank_columns_query = f"DESCRIBE SELECT * FROM {rel}"
        bank_columns_result = conn.execute(bank_columns_query).fetchall()
        all_bank_columns = {col[0]: col[1] for col in bank_columns_result}
        
        # Pre-fetch samples for all columns
        bank_column_samples = {}
        for col_name, col_type in all_bank_columns.items():
            limit = 20 if col_type in ['VARCHAR', 'STRING', 'TEXT'] else 5
            bank_column_samples[col_name] = self._get_categorical_samples(conn, file_path, col_name, limit)
        
        # 4. Build mapping state ensuring NO fields are dropped
        mapping_state = {
            'domain': domain,
            'status': 'pending_confirmation',
            'canonical_fields': [],
            'bank_column_info': {
                name: {'datatype': dtype, 'sample_values': bank_column_samples.get(name, [])}
                for name, dtype in all_bank_columns.items()
            },
            'detected_at': datetime.now().isoformat(),
            'verification_confirmed': False
        }
        
        for field in all_canonical_fields:
            suggested_col = suggested_mapping.get(field.name)
            
            # Extract source datatype if we found a suggestion
            source_dtype = all_bank_columns.get(suggested_col) if suggested_col else None
            
            # Map samples if suggested
            samples = bank_column_samples.get(suggested_col, []) if suggested_col else []
            
            # FIX: Force add the field to the list even if suggested_col is None
            field_state = {
                'canonical_name': field.name,
                'requirement': field.requirement.value,
                'description': field.description,
                'expected_type': str(field.arrow_type),
                'category': field.category.value,
                'degradation_impact': field.degradation_impact,
                'mapped_column': suggested_col,  # May be None, that's okay!
                'source_datatype': source_dtype,
                'sample_values': samples,
                'status': 'mapped' if suggested_col else 'not_present',
                'candidates': candidates.get(field.name, []),
                'expected_distinct_value_range': field.expected_distinct_value_range,
            }
            mapping_state['canonical_fields'].append(field_state)
        
        self.save_mapping(domain, mapping_state)
        return mapping_state
    
    def save_mapping(self, domain: str, mapping_state: Dict) -> None:
        """Persist mapping state to disk"""
        mapping_path = self.get_mapping_path(domain)
        with open(mapping_path, 'w') as f:
            json.dump(mapping_state, f, indent=2)
        logger.info(f"Saved mapping state for {domain}")
    
    def load_mapping(self, domain: str) -> Optional[Dict]:
        """Load saved mapping state"""
        mapping_path = self.get_mapping_path(domain)
        if not mapping_path.exists():
            return None
        
        with open(mapping_path, 'r') as f:
            return json.load(f)
    
    def _validate_no_column_conflicts(self, mapping_state: Dict) -> None:
        """
        Enforce one-to-one mapping
        Prevents same bank column from mapping to multiple canonical fields
        """
        column_to_canonicals = {}
        
        for field in mapping_state['canonical_fields']:
            col = field.get('mapped_column')
            if col and field['status'] == 'mapped':
                if col not in column_to_canonicals:
                    column_to_canonicals[col] = []
                column_to_canonicals[col].append(field['canonical_name'])
        
        # Find conflicts
        conflicts = {col: cans for col, cans in column_to_canonicals.items() if len(cans) > 1}
        
        if conflicts:
            conflict_details = '; '.join([f"{col} → {', '.join(cans)}" for col, cans in conflicts.items()])
            raise ValueError(
                f"Column mapping conflicts detected: {conflict_details}. "
                "Each bank column can only map to ONE canonical field."
            )
    
    def _validate_all_columns_accounted(self, mapping_state: Dict) -> None:
        """
        Mandatory column accounting
        Ensures all source columns are either mapped or explicitly ignored
        """
        all_source_columns = set(mapping_state.get('bank_column_info', {}).keys())
        
        mapped = set(
            f['mapped_column'] 
            for f in mapping_state['canonical_fields'] 
            if f.get('mapped_column') and f['status'] == 'mapped'
        )
        
        ignored = set(mapping_state.get('ignored_columns', []))
        
        unmapped = all_source_columns - mapped - ignored
        
        if unmapped:
            raise ValueError(
                f"Unmapped columns must be explicitly marked as 'Ignored': {sorted(unmapped)}. "
                "All source columns must be accounted for to prevent silent data loss."
            )
    
    def _validate_semantic_constraints(self, mapping_state: Dict, conn, file_path: Path) -> List[Dict]:
        """
        Semantic validation - validates that mapped columns have correct distinct value counts
        Returns list of warnings (not blocking, but logged)
        """
        warnings = []
        rel = self._relation_expr(file_path)
        
        for field in mapping_state['canonical_fields']:
            if field['status'] != 'mapped' or not field.get('mapped_column'):
                continue
            
            expected_range = field.get('expected_distinct_value_range')
            if not expected_range:
                continue
            
            min_expected, max_expected = expected_range
            mapped_col = field['mapped_column']
            
            try:
                # Query distinct count
                query = f'''
                    SELECT COUNT(DISTINCT "{mapped_col}") as distinct_count
                    FROM {rel}
                    WHERE "{mapped_col}" IS NOT NULL
                '''
                result = conn.execute(query).fetchone()
                actual_distinct = result[0] if result else 0
                
                if not (min_expected <= actual_distinct <= max_expected):
                    # Also get sample values for the warning
                    sample_values = self._get_categorical_samples(conn, file_path, mapped_col, 10)
                    
                    warning = {
                        'canonical_field': field['canonical_name'],
                        'mapped_column': mapped_col,
                        'expected_range': f"{min_expected}-{max_expected}",
                        'actual_distinct': actual_distinct,
                        'sample_values': sample_values[:5],
                        'severity': 'WARNING',
                        'message': (
                            f"⚠️ Semantic validation warning: {field['canonical_name']} "
                            f"has {actual_distinct} distinct values in '{mapped_col}', "
                            f"expected {min_expected}-{max_expected}. "
                            f"Sample values: {', '.join(sample_values[:5])}. "
                            f"Possible incorrect field mapping!"
                        )
                    }
                    warnings.append(warning)
                    logger.warning(warning['message'])
            
            except Exception as e:
                logger.error(f"Failed to validate semantic constraints for {field['canonical_name']}: {e}")
        
        return warnings
    
    def update_field_mapping(
        self, 
        domain: str, 
        canonical_field: str, 
        mapped_column: Optional[str], 
        status: str,
        missing_reason: Optional[str] = None,
        locked_datatype: Optional[str] = None
    ) -> Dict:
        """
        Update mapping for a single field.
        FIX: Updates examples with actual data when mapping changes
        """
        mapping_state = self.load_mapping(domain)
        if not mapping_state:
            raise ValueError(f"No mapping state found for {domain}")
        
        # Find and update the field
        field_found = False
        old_mapped_column = None
        
        for field in mapping_state['canonical_fields']:
            if field['canonical_name'] == canonical_field:
                old_mapped_column = field.get('mapped_column')
                field['mapped_column'] = mapped_column
                field['status'] = status
                field['mapping_source'] = 'user_confirmed'
                field['confirmed_at'] = datetime.now().isoformat()
                field['missing_reason'] = missing_reason
                
                # Type locking
                if locked_datatype:
                    field['locked_datatype'] = locked_datatype
                
                # Update sample values and examples if mapped
                if mapped_column and mapped_column in mapping_state.get('bank_column_info', {}):
                    bank_info = mapping_state['bank_column_info'][mapped_column]
                    field['sample_values'] = bank_info.get('sample_values', [])
                    field['source_datatype'] = bank_info.get('datatype')
                    
                    # FIX: Update examples with actual data for categorical fields
                    if field['category'] == 'category':
                        actual_samples = bank_info.get('sample_values', [])
                        if actual_samples:
                            field['examples'] = actual_samples
                            logger.info(
                                f"[BTSY] Updated {canonical_field} examples with data: "
                                f"{actual_samples[:5]}"
                            )
                
                field_found = True
                break
        
        if not field_found:
            raise ValueError(f"Field {canonical_field} not found in mapping")
        
        # Update unmapped/ignored column tracking
        if mapped_column and mapped_column in mapping_state.get('unmapped_columns', []):
            mapping_state['unmapped_columns'].remove(mapped_column)
        
        if old_mapped_column and old_mapped_column != mapped_column:
            is_used_elsewhere = any(
                f['mapped_column'] == old_mapped_column and f['canonical_name'] != canonical_field
                for f in mapping_state['canonical_fields']
            )
            if not is_used_elsewhere:
                if old_mapped_column not in mapping_state.get('ignored_columns', []):
                    if old_mapped_column not in mapping_state.get('unmapped_columns', []):
                        mapping_state.setdefault('unmapped_columns', []).append(old_mapped_column)
        
        # Validate no conflicts after update
        try:
            self._validate_no_column_conflicts(mapping_state)
        except ValueError as e:
            # Revert the change
            for field in mapping_state['canonical_fields']:
                if field['canonical_name'] == canonical_field:
                    field['mapped_column'] = old_mapped_column
                    break
            raise e
        
        mapping_state['updated_at'] = datetime.now().isoformat()
        mapping_state['verification_confirmed'] = False
        mapping_state['verification_confirmed_at'] = None
        
        self.save_mapping(domain, mapping_state)
        logger.info(f"[BTSY] Updated {domain}.{canonical_field}: {status} -> {mapped_column}")
        
        return mapping_state
    
    def set_column_disposition(self, domain: str, column_name: str, disposition: str) -> Dict:
        """
        Mark column as ignored or re-enable it
        disposition: 'ignored' or 'available'
        """
        mapping_state = self.load_mapping(domain)
        if not mapping_state:
            raise ValueError(f"No mapping state found for {domain}")
        
        if disposition == 'ignored':
            if column_name in mapping_state.get('unmapped_columns', []):
                mapping_state['unmapped_columns'].remove(column_name)
            
            if column_name not in mapping_state.get('ignored_columns', []):
                mapping_state.setdefault('ignored_columns', []).append(column_name)
            
            logger.info(f"[BTSY] Marked {domain}.{column_name} as ignored")
        
        elif disposition == 'available':
            if column_name in mapping_state.get('ignored_columns', []):
                mapping_state['ignored_columns'].remove(column_name)
            
            mapped_columns = set(
                f['mapped_column'] 
                for f in mapping_state['canonical_fields'] 
                if f.get('mapped_column')
            )
            if column_name not in mapped_columns:
                if column_name not in mapping_state.get('unmapped_columns', []):
                    mapping_state.setdefault('unmapped_columns', []).append(column_name)
            
            logger.info(f"[BTSY] Marked {domain}.{column_name} as available")
        
        else:
            raise ValueError(f"Invalid disposition: {disposition}. Must be 'ignored' or 'available'")
        
        mapping_state['updated_at'] = datetime.now().isoformat()
        self.save_mapping(domain, mapping_state)
        
        return mapping_state
    
    def get_verification_summary(self, domain: str, conn, file_path: Path) -> Dict:
        """
        Generate verification summary for user review
        Shows complete mapping with sample values for final confirmation
        """
        mapping_state = self.load_mapping(domain)
        if not mapping_state:
            raise ValueError(f"No mapping state found for {domain}")
        
        # Build verification rows
        verification_rows = []
        
        for field in mapping_state['canonical_fields']:
            if field['status'] == 'mapped' and field.get('mapped_column'):
                verification_rows.append({
                    'canonical_field': field['canonical_name'],
                    'canonical_type': field['locked_datatype'],
                    'bank_column': field['mapped_column'],
                    'bank_type': field.get('source_datatype', 'Unknown'),
                    'sample_values': ', '.join(field.get('sample_values', [])[:5]),
                    'requirement': field['requirement'],
                    'distinct_value_range': field.get('expected_distinct_value_range')
                })
        
        # Run semantic validation
        semantic_warnings = self._validate_semantic_constraints(mapping_state, conn, file_path)
        
        summary = {
            'domain': domain,
            'verification_rows': verification_rows,
            'semantic_warnings': semantic_warnings,
            'total_canonical_fields': len(mapping_state['canonical_fields']),
            'mapped_fields': len([f for f in mapping_state['canonical_fields'] if f['status'] == 'mapped']),
            'unmapped_columns': mapping_state.get('unmapped_columns', []),
            'ignored_columns': mapping_state.get('ignored_columns', []),
            'has_conflicts': False,
            'has_unmapped': len(mapping_state.get('unmapped_columns', [])) > 0,
            'verification_confirmed': mapping_state.get('verification_confirmed', False)
        }
        
        # Check for conflicts
        try:
            self._validate_no_column_conflicts(mapping_state)
        except ValueError as e:
            summary['has_conflicts'] = True
            summary['conflict_error'] = str(e)
        
        return summary
    
    def confirm_verification(self, domain: str, confirmed_by: str = 'user') -> Dict:
        """
        Record that user has reviewed and confirmed the mapping
        Required before finalization
        """
        mapping_state = self.load_mapping(domain)
        if not mapping_state:
            raise ValueError(f"No mapping state found for {domain}")
        
        # Validate before allowing confirmation
        self._validate_no_column_conflicts(mapping_state)
        
        mapping_state['verification_confirmed'] = True
        mapping_state['verification_confirmed_at'] = datetime.now().isoformat()
        mapping_state['verification_confirmed_by'] = confirmed_by
        
        self.save_mapping(domain, mapping_state)
        logger.info(f"[BTSY] Verification confirmed for {domain} by {confirmed_by}")
        
        return mapping_state
    
    def validate_mapping(self, domain: str) -> Dict:
        """
        Validate that mapping is complete and correct.
        Returns validation result.
        """
        mapping_state = self.load_mapping(domain)
        if not mapping_state:
            return {
                'valid': False,
                'error': 'No mapping found',
                'blocking_issues': [],
                'degradations': [],
                'mapped_count': 0,
                'total_canonical': 0
            }
        
        # Get mapped fields
        mapped_fields = {}
        for field in mapping_state['canonical_fields']:
            if field['status'] == 'mapped' and field.get('mapped_column'):
                mapped_fields[field['canonical_name']] = field['mapped_column']
        
        # Use canonical model validation
        validation = CanonicalAMLModel.validate_mapping(domain, mapped_fields)
        
        # Add conflict check
        has_conflicts = False
        conflict_error = None
        try:
            self._validate_no_column_conflicts(mapping_state)
        except ValueError as e:
            has_conflicts = True
            conflict_error = str(e)
        
        return {
            'valid': validation['valid'] and not has_conflicts,
            'blocking_issues': validation.get('blocking_issues', []),
            'degradations': validation.get('degradations', []),
            'mapped_count': validation.get('mapped_count', len(mapped_fields)),
            'total_canonical': len(mapping_state['canonical_fields']),
            'critical_count': validation.get('critical_count', 0),
            'standard_count': validation.get('standard_count', 0),
            'has_conflicts': has_conflicts,
            'conflict_error': conflict_error
        }
    
    def finalize_mapping(self, domain: str) -> Dict:
        """
        Finalize mapping after validation and verification.
        Returns final mapping contract.
        """
        mapping_state = self.load_mapping(domain)
        if not mapping_state:
            raise ValueError(f"No mapping state found for {domain}")
        
        # Require verification confirmation
        if not mapping_state.get('verification_confirmed', False):
            raise ValueError(
                "Mapping must be verified before finalization. "
                "Please review the verification summary and confirm."
            )
        
        # Check for column conflicts
        self._validate_no_column_conflicts(mapping_state)
        
        # Validate completeness
        validation = self.validate_mapping(domain)
        if not validation['valid']:
            blocking = validation.get('blocking_issues', [])
            conflicts = validation.get('conflict_error', '')
            raise ValueError(
                f"Cannot finalize invalid mapping. "
                f"Missing critical fields: {blocking}. "
                f"Conflicts: {conflicts}"
            )
        
        mapping_state['status'] = 'confirmed'
        mapping_state['finalized_at'] = datetime.now().isoformat()
        
        self.save_mapping(domain, mapping_state)
        
        # Build mapping contract
        contract = {
            'domain': domain,
            'canonical_to_bank': {},
            'bank_to_canonical': {},
            'canonical_to_locked_type': {},
            'ignored_columns': mapping_state.get('ignored_columns', []),
            'finalized_at': mapping_state['finalized_at'],
            'verification_confirmed_at': mapping_state.get('verification_confirmed_at'),
            'verification_confirmed_by': mapping_state.get('verification_confirmed_by'),
            'validation': validation
        }
        
        for field in mapping_state['canonical_fields']:
            if field['status'] == 'mapped' and field['mapped_column']:
                canonical = field['canonical_name']
                bank_col = field['mapped_column']
                locked_type = field.get('locked_datatype', field['expected_type'])
                
                contract['canonical_to_bank'][canonical] = bank_col
                contract['bank_to_canonical'][bank_col] = canonical
                contract['canonical_to_locked_type'][canonical] = locked_type
        
        logger.info(
            f"[BTSY] Finalized mapping for {domain}: "
            f"{len(contract['canonical_to_bank'])} fields mapped, "
            f"{len(contract['ignored_columns'])} columns ignored"
        )
        
        return contract
    
    def clear_mapping(self, domain: str) -> None:
        """Clear mapping state for a domain"""
        mapping_path = self.get_mapping_path(domain)
        if mapping_path.exists():
            mapping_path.unlink()
            logger.info(f"Cleared mapping for {domain}")

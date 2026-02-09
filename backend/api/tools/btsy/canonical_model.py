"""
Canonical AML Model Definition - FIXED
Fixes:
1. Separated transaction_category (payment method) from transaction_type (debit/credit)
2. Correct examples for each field
3. Examples will be replaced with actual data during mapping detection
"""
from dataclasses import dataclass
from typing import List, Optional, Dict, Any
from enum import Enum

try:
    import pyarrow as pa
    HAS_PYARROW = True
except ImportError:
    HAS_PYARROW = False
    class pa:
        DataType = object
        Schema = object
        @staticmethod
        def string():
            return "STRING"
        @staticmethod
        def float64():
            return "FLOAT64"
        @staticmethod
        def int64():
            return "INT64"
        @staticmethod
        def bool_():
            return "BOOLEAN"
        @staticmethod
        def timestamp(unit, tz=None):
            return f"TIMESTAMP[{unit}]"
        @staticmethod
        def schema(fields):
            return {"fields": fields}


class FieldRequirement(Enum):
    """
    CRITICAL: Critical for calibration - must exist
    STANDARD: Standard field - should exist but calibration can degrade gracefully
    ENRICHMENT: Nice to have - calibration works fine without it
    """
    CRITICAL = "CRITICAL"
    STANDARD = "STANDARD"
    ENRICHMENT = "ENRICHMENT"


class FieldCategory(Enum):
    """Semantic categories for fields"""
    IDENTIFIER = "identifier"
    TEMPORAL = "temporal"
    AMOUNT = "amount"
    CATEGORY = "category"
    FLAG = "flag"
    RATING = "rating"
    STATUS = "status"


@dataclass
class ValidationRule:
    """Validation rule for a canonical field"""
    rule_type: str
    parameters: Dict[str, Any]
    failure_behavior: str  # 'reject', 'warn', 'coerce_null'
    description: str


@dataclass
class CanonicalField:
    """Definition of a canonical field with comprehensive metadata"""
    name: str
    requirement: FieldRequirement
    arrow_type: pa.DataType
    description: str
    category: FieldCategory
    
    # What happens if this field is missing?
    degradation_impact: str  # Human readable impact
    
    # UI hints
    show_if_missing: bool = True  # Should we show this in UI if not detected?
    auto_accept_threshold: float = 0.85  # Auto-accept if confidence above this
    
    validation_rules: Optional[List[ValidationRule]] = None
    allowed_nulls: bool = True
    parse_formats: Optional[List[str]] = None
    coercion_rules: Optional[Dict[str, Any]] = None
    examples: Optional[List[str]] = None
    business_definition: Optional[str] = None
    expected_distinct_value_range: Optional[tuple] = None  # (min, max) for validation
    
    def to_dict(self) -> Dict:
        """Convert to dictionary for serialization"""
        return {
            'name': self.name,
            'requirement': self.requirement.value,
            'arrow_type': str(self.arrow_type),
            'description': self.description,
            'category': self.category.value,
            'degradation_impact': self.degradation_impact,
            'show_if_missing': self.show_if_missing,
            'auto_accept_threshold': self.auto_accept_threshold,
            'allowed_nulls': self.allowed_nulls,
            'parse_formats': self.parse_formats,
            'coercion_rules': self.coercion_rules,
            'examples': self.examples,
            'business_definition': self.business_definition,
            'expected_distinct_value_range': self.expected_distinct_value_range,
            'validation_rules': [
                {
                    'rule_type': r.rule_type,
                    'parameters': r.parameters,
                    'failure_behavior': r.failure_behavior,
                    'description': r.description
                } for r in (self.validation_rules or [])
            ]
        }


class CanonicalAMLModel:
    """
    Minimal canonical schema for AML calibration.
    Philosophy: Define what's CRITICAL, gracefully degrade for the rest.
    """
    
    # Transaction Schema - The CORE of AML analysis
    TRANSACTIONS = [
        # === CRITICAL FIELDS - Calibration cannot proceed without these ===
        CanonicalField(
            name="transaction_datetime",
            requirement=FieldRequirement.CRITICAL,
            arrow_type=pa.timestamp('us', tz='UTC'),
            description="When the transaction occurred",
            category=FieldCategory.TEMPORAL,
            degradation_impact="BLOCKS CALIBRATION: Cannot perform temporal analysis without dates",
            show_if_missing=True,
            auto_accept_threshold=0.85,
            allowed_nulls=False,
            parse_formats=['%Y-%m-%d %H:%M:%S', '%Y-%m-%d', '%d/%m/%Y', '%m/%d/%Y', 'ISO8601'],
            examples=["2024-01-15 14:30:00", "2024-01-15", "15/01/2024"],
            business_definition="Date and time when the transaction occurred",
            coercion_rules={
                'date_to_timestamp': 'Add 00:00:00 UTC if only date provided',
                'invalid_format': 'Null with warning'
            },
            validation_rules=[
                ValidationRule(
                    rule_type='range',
                    parameters={'min_year': 2000, 'max_year': 2100},
                    failure_behavior='warn',
                    description='Transaction date should be between 2000-2100'
                ),
                ValidationRule(
                    rule_type='null_tolerance',
                    parameters={'max_null_pct': 0.0},
                    failure_behavior='reject',
                    description='No nulls allowed - critical field'
                )
            ]
        ),
        CanonicalField(
            name="transaction_amount",
            requirement=FieldRequirement.CRITICAL,
            arrow_type=pa.float64(),
            description="Transaction monetary value",
            category=FieldCategory.AMOUNT,
            degradation_impact="BLOCKS CALIBRATION: Cannot perform amount-based analysis without amounts",
            show_if_missing=True,
            auto_accept_threshold=0.85,
            allowed_nulls=False,
            examples=["1500.50", "-250.00", "0.01"],
            business_definition="Monetary value; negative = debit/outflow, positive = credit/inflow",
            coercion_rules={
                'currency_symbols': 'Strip $ £ € symbols',
                'comma_separators': 'Remove thousand separators',
                'non_numeric': 'Null with warning'
            },
            validation_rules=[
                ValidationRule(
                    rule_type='null_tolerance',
                    parameters={'max_null_pct': 0.0},
                    failure_behavior='reject',
                    description='No nulls allowed - critical field'
                )
            ]
        ),
        CanonicalField(
            name="account_id",
            requirement=FieldRequirement.CRITICAL,
            arrow_type=pa.string(),
            description="Account identifier",
            category=FieldCategory.IDENTIFIER,
            degradation_impact="BLOCKS CALIBRATION: Cannot group transactions by account",
            show_if_missing=True,
            auto_accept_threshold=0.85,
            allowed_nulls=False,
            examples=["ACC-123456", "A-987654", "1234567890"],
            business_definition="Links transaction to account",
            validation_rules=[
                ValidationRule(
                    rule_type='null_tolerance',
                    parameters={'max_null_pct': 0.0},
                    failure_behavior='reject',
                    description='No nulls allowed - critical field'
                )
            ]
        ),
        
        # === STANDARD FIELDS - Important but calibration can adapt ===
        CanonicalField(
            name="transaction_type",
            requirement=FieldRequirement.STANDARD,
            arrow_type=pa.string(),
            description="Transaction direction: DEBIT (outflow) or CREDIT (inflow)",
            category=FieldCategory.CATEGORY,
            degradation_impact="DEGRADES: Directional flow analysis disabled, cannot distinguish inflows from outflows",
            show_if_missing=True,
            auto_accept_threshold=0.80,
            allowed_nulls=False,
            examples=["DEBIT", "CREDIT", "DR", "CR"],  # FIX: Only debit/credit direction
            business_definition="Direction of money flow: DEBIT (money out) or CREDIT (money in). Should have exactly 2 distinct values.",
            coercion_rules={
                'case_normalization': 'Convert to uppercase',
                'dr_cr_mapping': 'Map DR→DEBIT, CR→CREDIT, D→DEBIT, C→CREDIT'
            },
            expected_distinct_value_range=(2, 4)  # FIX: Should have 2-4 distinct values
        ),
        CanonicalField(
            name="transaction_category",
            requirement=FieldRequirement.STANDARD,
            arrow_type=pa.string(),
            description="Payment method or channel (RTGS, NEFT, CASH, Wire, etc.)",
            category=FieldCategory.CATEGORY,
            degradation_impact="DEGRADES: Channel-based rules disabled, payment method analysis unavailable",
            show_if_missing=True,
            auto_accept_threshold=0.80,
            allowed_nulls=False,
            examples=["RTGS", "NEFT", "CASH", "WIRE", "ACH", "CHECK"],  # FIX: Payment methods
            business_definition="Payment channel or method used for transaction. Examples: RTGS, NEFT, CASH, Wire Transfer, ACH, Check, Card Payment",
            coercion_rules={
                'case_normalization': 'Convert to uppercase'
            },
            expected_distinct_value_range=(3, 50)  # Typically 3-50 different payment types
        ),
        
        # === ENRICHMENT FIELDS - Nice to have, don't show if missing ===
        CanonicalField(
            name="transaction_id",
            requirement=FieldRequirement.CRITICAL,
            arrow_type=pa.string(),
            description="Unique transaction identifier",
            category=FieldCategory.IDENTIFIER,
            degradation_impact="BLOCKS CALIBRATION: Cannot preserve extensions without transaction_id",
            show_if_missing=True,
            auto_accept_threshold=0.90,
            allowed_nulls=False,
            examples=["TXN-123456", "T20240101-001"]
        ),
        CanonicalField(
            name="customer_id",
            requirement=FieldRequirement.ENRICHMENT,
            arrow_type=pa.string(),
            description="Customer identifier",
            category=FieldCategory.IDENTIFIER,
            degradation_impact="MINOR: Customer-level aggregation disabled, uses account-level only",
            show_if_missing=False,
            auto_accept_threshold=0.85,
            allowed_nulls=True,
            examples=["CUST-123456", "C-987654"]
        ),
    ]
    
    # Account Schema
    ACCOUNTS = [
        # CRITICAL
        CanonicalField(
            name="account_id",
            requirement=FieldRequirement.CRITICAL,
            arrow_type=pa.string(),
            description="Unique account identifier",
            category=FieldCategory.IDENTIFIER,
            degradation_impact="BLOCKS CALIBRATION: Cannot join to transactions",
            show_if_missing=True,
            auto_accept_threshold=0.90,
            allowed_nulls=False
        ),
        CanonicalField(
            name="customer_id",
            requirement=FieldRequirement.CRITICAL,
            arrow_type=pa.string(),
            description="Customer identifier",
            category=FieldCategory.IDENTIFIER,
            degradation_impact="BLOCKS CALIBRATION: Cannot link accounts to customers",
            show_if_missing=True,
            auto_accept_threshold=0.85,
            allowed_nulls=False
        ),
        
        # ENRICHMENT
        CanonicalField(
            name="account_status",
            requirement=FieldRequirement.ENRICHMENT,
            arrow_type=pa.string(),
            description="Account status (ACTIVE, CLOSED, etc.)",
            category=FieldCategory.STATUS,
            degradation_impact="MINOR: Status-based filtering disabled",
            show_if_missing=False,
            auto_accept_threshold=0.80,
            allowed_nulls=True,
            examples=["ACTIVE", "CLOSED", "DORMANT"],
            expected_distinct_value_range=(2, 10)
        ),
        CanonicalField(
            name="account_open_date",
            requirement=FieldRequirement.ENRICHMENT,
            arrow_type=pa.timestamp('us', tz='UTC'),
            description="Account opening date",
            category=FieldCategory.TEMPORAL,
            degradation_impact="MINOR: Account age analysis disabled",
            show_if_missing=False,
            auto_accept_threshold=0.75,
            allowed_nulls=True,
            parse_formats=['%Y-%m-%d', '%d/%m/%Y', '%m/%d/%Y']
        ),
        CanonicalField(
            name="account_close_date",
            requirement=FieldRequirement.ENRICHMENT,
            arrow_type=pa.timestamp('us', tz='UTC'),
            description="Account closing date",
            category=FieldCategory.TEMPORAL,
            degradation_impact="MINOR: Closed account detection less reliable",
            show_if_missing=False,
            auto_accept_threshold=0.75,
            allowed_nulls=True,
            parse_formats=['%Y-%m-%d', '%d/%m/%Y', '%m/%d/%Y']
        ),
            CanonicalField(
            name="account_type",
            requirement=FieldRequirement.ENRICHMENT,
            arrow_type=pa.string(),
            description="Type of account (SAVINGS, CURRENT, etc.)",
            category=FieldCategory.CATEGORY,
            degradation_impact="MINOR: Account type segmentation disabled",
            show_if_missing=False
        ),
        CanonicalField(
            name="dormancy_flag",
            requirement=FieldRequirement.ENRICHMENT,
            arrow_type=pa.bool_(),
            description="Flag indicating if account is dormant",
            category=FieldCategory.FLAG,
            degradation_impact="MINOR: Dormancy analysis restricted",
            show_if_missing=False
        ),
        CanonicalField(
            name="last_dormant_date",
            requirement=FieldRequirement.ENRICHMENT,
            arrow_type=pa.timestamp('us', tz='UTC'),
            description="Date when account last became dormant",
            category=FieldCategory.TEMPORAL,
            degradation_impact="MINOR: Historical dormancy tracking disabled",
            show_if_missing=False
        ),
        ]
    
    # Customer Schema
    # backend/api/tools/btsy/canonical_model.py

    # Customer Schema - EXTENDED
    CUSTOMERS = [
        # === CRITICAL ===
        CanonicalField(
            name="customer_id",
            requirement=FieldRequirement.CRITICAL,
            arrow_type=pa.string(),
            description="Unique customer identifier",
            category=FieldCategory.IDENTIFIER,
            degradation_impact="BLOCKS CALIBRATION: Cannot join to accounts",
            show_if_missing=True,
            auto_accept_threshold=0.90,
            allowed_nulls=False
        ),
        
        # === NEW FIELDS FROM YOUR DATA ===
        CanonicalField(
            name="customer_type",
            requirement=FieldRequirement.STANDARD,
            arrow_type=pa.string(),
            description="Individual, Corporate, NPO, etc.",
            category=FieldCategory.CATEGORY,
            degradation_impact="DEGRADES: Cannot apply entity-specific risk thresholds",
            show_if_missing=True,
            examples=["INDIVIDUAL", "CORPORATE", "NPO"]
        ),
        CanonicalField(
            name="kyc_status",
            requirement=FieldRequirement.STANDARD,
            arrow_type=pa.string(),
            description="Status of KYC documentation",
            category=FieldCategory.STATUS,
            degradation_impact="DEGRADES: Cannot filter by non-compliant customers",
            show_if_missing=True,
            examples=["KYC_COMPLETE", "PENDING", "EXPIRED"]
        ),
        CanonicalField(
            name="income_bracket",
            requirement=FieldRequirement.ENRICHMENT,
            arrow_type=pa.string(),
            description="Customer income range",
            category=FieldCategory.RATING,
            degradation_impact="MINOR: Socio-economic profiling disabled",
            show_if_missing=False,
            examples=["<5L", "10-25L", ">25L"]
        ),
        CanonicalField(
            name="gender",
            requirement=FieldRequirement.ENRICHMENT,
            arrow_type=pa.string(),
            description="Customer gender classification",
            category=FieldCategory.CATEGORY,
            degradation_impact="MINOR: Demographic segmentation disabled",
            show_if_missing=True,
            examples=["MALE", "FEMALE", "OTHER"],
            expected_distinct_value_range=(2, 5)
        ),
        CanonicalField(
            name="customer_segment",
            requirement=FieldRequirement.ENRICHMENT,
            arrow_type=pa.string(),
            description="Bank-defined customer segment (Retail, SME, Corporate, etc.)",
            category=FieldCategory.CATEGORY,
            degradation_impact="MINOR: Segment-based controls disabled",
            show_if_missing=True,
            examples=["RETAIL", "SME", "CORPORATE", "WEALTH"],
            expected_distinct_value_range=(2, 20)
        ),
        CanonicalField(
            name="internal_watchlist_flag",
            requirement=FieldRequirement.ENRICHMENT,
            arrow_type=pa.bool_(),
            description="Internal watchlist flag",
            category=FieldCategory.FLAG,
            degradation_impact="MINOR: Internal watchlist filtering disabled",
            show_if_missing=True,
            expected_distinct_value_range=(2, 2)
        ),
        CanonicalField(
            name="dob_or_incorporation_date",
            requirement=FieldRequirement.ENRICHMENT,
            arrow_type=pa.timestamp('us', tz='UTC'),
            description="Date of birth or business incorporation",
            category=FieldCategory.TEMPORAL,
            degradation_impact="MINOR: Age-based risk analysis disabled",
            show_if_missing=False
        ),

        # === EXISTING ENRICHMENT ===
        CanonicalField(
            name="customer_risk_rating",
            requirement=FieldRequirement.ENRICHMENT,
            arrow_type=pa.string(),
            description="Customer risk rating (LOW, MEDIUM, HIGH)",
            category=FieldCategory.RATING,
            degradation_impact="MINOR: Risk-based segmentation disabled",
            show_if_missing=False,
            auto_accept_threshold=0.80,
            allowed_nulls=True,
            examples=["LOW", "MEDIUM", "HIGH"],
            expected_distinct_value_range=(3, 5)
        ),
        CanonicalField(
            name="pep_flag",
            requirement=FieldRequirement.ENRICHMENT,
            arrow_type=pa.bool_(),
            description="Politically Exposed Person flag",
            category=FieldCategory.FLAG,
            degradation_impact="MINOR: PEP-specific rules disabled",
            show_if_missing=False,
            auto_accept_threshold=0.85,
            allowed_nulls=True,
            expected_distinct_value_range=(2, 2)
        ),
        CanonicalField(
            name="sanction_flag",
            requirement=FieldRequirement.ENRICHMENT,
            arrow_type=pa.bool_(),
            description="Sanctions list flag",
            category=FieldCategory.FLAG,
            degradation_impact="MINOR: Sanctions-specific rules disabled",
            show_if_missing=False,
            auto_accept_threshold=0.85,
            allowed_nulls=True,
            expected_distinct_value_range=(2, 2)
        ),
    ]
    
    # STR Schema
    STR = [
        CanonicalField(
            name="account_id",
            requirement=FieldRequirement.CRITICAL,
            arrow_type=pa.string(),
            description="Account identifier",
            category=FieldCategory.IDENTIFIER,
            degradation_impact="BLOCKS CALIBRATION: Cannot link STRs to accounts",
            show_if_missing=True,
            auto_accept_threshold=0.90,
            allowed_nulls=False
        ),
        CanonicalField(
            name="str_filed_date",
            requirement=FieldRequirement.ENRICHMENT,
            arrow_type=pa.timestamp('us', tz='UTC'),
            description="STR filing date",
            category=FieldCategory.TEMPORAL,
            degradation_impact="MINOR: STR timeline analysis less accurate",
            show_if_missing=False,
            auto_accept_threshold=0.80,
            allowed_nulls=True,
            parse_formats=['%Y-%m-%d', '%d/%m/%Y', '%m/%d/%Y']
        ),
    ]
    
    @classmethod
    def get_schema(cls, domain: str) -> List[CanonicalField]:
        """Get canonical schema for a domain"""
        domain_map = {
            'transactions': cls.TRANSACTIONS,
            'accounts': cls.ACCOUNTS,
            'customers': cls.CUSTOMERS,
            'str': cls.STR,
        }
        return domain_map.get(domain, [])
    
    @classmethod
    def get_critical_fields(cls, domain: str) -> List[str]:
        """Get list of critical field names"""
        fields = cls.get_schema(domain)
        return [f.name for f in fields if f.requirement == FieldRequirement.CRITICAL]
    
    @classmethod
    def get_standard_fields(cls, domain: str) -> List[str]:
        """Get list of standard field names"""
        fields = cls.get_schema(domain)
        return [f.name for f in fields if f.requirement == FieldRequirement.STANDARD]
    
    @classmethod
    def get_enrichment_fields(cls, domain: str) -> List[str]:
        """Get list of enrichment field names"""
        fields = cls.get_schema(domain)
        return [f.name for f in fields if f.requirement == FieldRequirement.ENRICHMENT]
    
    @classmethod
    def get_fields_to_show_in_ui(cls, domain: str, detected_mappings: Dict[str, str]) -> List[CanonicalField]:
        """
        Get fields that should be shown in UI based on detection.
        Philosophy: Only show what's relevant to the user's data.
        """
        all_fields = cls.get_schema(domain)
        fields_to_show = []
        
        for field in all_fields:
            # Always show CRITICAL fields
            if field.requirement == FieldRequirement.CRITICAL:
                fields_to_show.append(field)
            # Show STANDARD if detected OR if show_if_missing=True
            elif field.requirement == FieldRequirement.STANDARD:
                if field.name in detected_mappings or field.show_if_missing:
                    fields_to_show.append(field)
            # Show ENRICHMENT only if detected (unless show_if_missing=True)
            elif field.requirement == FieldRequirement.ENRICHMENT:
                if field.name in detected_mappings:
                    fields_to_show.append(field)
                elif field.show_if_missing:
                    fields_to_show.append(field)
        
        return fields_to_show
    
    @classmethod
    def validate_mapping(cls, domain: str, mapped_fields: Dict[str, str]) -> Dict:
        """
        Validate mapping completeness.
        Only CRITICAL fields are blocking.
        """
        critical = set(cls.get_critical_fields(domain))
        standard = set(cls.get_standard_fields(domain))
        mapped = set(mapped_fields.keys())
        
        missing_critical = critical - mapped
        missing_standard = standard - mapped
        
        # Get degradation info
        degradations = []
        for field_name in missing_standard:
            field = next((f for f in cls.get_schema(domain) if f.name == field_name), None)
            if field:
                degradations.append({
                    'field': field_name,
                    'impact': field.degradation_impact
                })
        
        return {
            'valid': len(missing_critical) == 0,
            'blocking_issues': list(missing_critical),
            'degradations': degradations,
            'mapped_count': len(mapped),
            'critical_count': len(critical),
            'standard_count': len(standard)
        }
    
    @classmethod
    def get_arrow_schema(cls, domain: str) -> pa.Schema:
        """Get PyArrow schema for a domain"""
        fields = cls.get_schema(domain)
        return pa.schema([(f.name, f.arrow_type) for f in fields])

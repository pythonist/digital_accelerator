# backend/calibration/shared/calibration_helpers.py
"""
Shared utilities for calibration system
Handles caching, contracts, and common computations
"""
import pandas as pd
import numpy as np
from functools import lru_cache
from datetime import datetime
import pickle
import json
class CalibrationContracts:
    """Standard contracts for calibration responses"""
    
    @staticmethod
    def alert_grain(level="ACCOUNT_DATE"):
        """Standard alert grain contract"""
        descriptions = {
            "ACCOUNT_DATE": "One alert = one account flagged on one date",
            "ACCOUNT": "One alert = one account flagged (date-aggregated)",
            "CUSTOMER": "One alert = one customer flagged (account/date-aggregated)"
        }
        return {
            "unit": level,
            "description": descriptions.get(level, "Custom grain")
        }
    
    @staticmethod
    def binning_metadata(bin_type="equal_width", bins=50):
        """Standard binning metadata"""
        return {
            "type": bin_type,
            "bins": bins,
            "version": "1.0"
        }
    
    @staticmethod
    def near_miss_band(threshold, band_pct=10.0):
        """Standard near-miss band definition"""
        lower = threshold * (1 - band_pct/100)
        return {
            "definition": f"threshold - {band_pct}%",
            "band_pct": band_pct,
            "lower_bound": round(lower, 2),
            "upper_bound": round(threshold, 2)
        }


class CalibrationCache:
    """In-memory cache for aggregated populations"""
    
    _cache = {}
    
    @classmethod
    def get_population(cls, run_id):
        """Get cached aggregated population"""
        return cls._cache.get(run_id)
    
    @classmethod
    def set_population(cls, run_id, df, metadata):
        """Cache aggregated population with metadata"""
        cls._cache[run_id] = {
            'df': df,
            'metadata': metadata,
            'cached_at': datetime.now()
        }
    
    @classmethod
    def clear(cls, run_id=None):
        """Clear cache for specific run or all"""
        if run_id:
            cls._cache.pop(run_id, None)
        else:
            cls._cache.clear()


class DistributionAnalyzer:
    """Analyzes distribution shape and characteristics"""
    
    @staticmethod
    def analyze_shape(values):
        """
        Analyze distribution shape
        Returns skewness, tail characteristics, and notes
        """
        if len(values) < 10:
            return {
                "skewness": None,
                "heavy_tail": False,
                "notes": "Insufficient data for shape analysis"
            }
        
        skew = float(values.skew())
        
        # Check for heavy tail (compare p99 vs p90)
        p90 = values.quantile(0.90)
        p99 = values.quantile(0.99)
        p50 = values.quantile(0.50)
        
        tail_ratio = (p99 - p90) / (p90 - p50) if (p90 - p50) > 0 else 0
        heavy_tail = tail_ratio > 2.0
        
        # Generate notes
        notes = []
        if abs(skew) > 2:
            notes.append("Highly skewed distribution")
        if skew > 1:
            notes.append("Long right tail driven by extreme values")
        elif skew < -1:
            notes.append("Long left tail")
        if heavy_tail:
            notes.append("Heavy tail: threshold changes near top percentiles have large impact")
        
        return {
            "skewness": round(skew, 2),
            "heavy_tail": heavy_tail,
            "tail_ratio": round(tail_ratio, 2),
            "notes": " | ".join(notes) if notes else "Normal distribution"
        }
    
    @staticmethod
    def calculate_sensitivity(df, metric_col, current_percentile, current_threshold):
        """
        Calculate threshold sensitivity
        Returns alerts per 1% percentile shift and per ₹1000 currency shift
        """
        values = df[metric_col].dropna()
        total = len(values)
        
        # Calculate alerts at p-1 and p+1
        p_minus = max(50, current_percentile - 1)
        p_plus = min(99.9, current_percentile + 1)
        
        threshold_minus = values.quantile(p_minus / 100)
        threshold_plus = values.quantile(p_plus / 100)
        
        alerts_minus = len(values[values >= threshold_minus])
        alerts_plus = len(values[values >= threshold_plus])
        alerts_current = len(values[values >= current_threshold])
        
        # Alerts per 1% percentile
        alerts_per_pct = abs(alerts_current - alerts_minus)
        
        # Alerts per ₹1000 currency
        currency_diff = abs(current_threshold - threshold_minus)
        if currency_diff > 0:
            alerts_per_1000 = int((alerts_per_pct / currency_diff) * 1000)
        else:
            alerts_per_1000 = 0
        
        # Stability assessment
        if alerts_per_pct < 50:
            stability = "STABLE"
        elif alerts_per_pct < 200:
            stability = "MODERATE"
        else:
            stability = "SENSITIVE"
        
        return {
            "alerts_per_1pct": int(alerts_per_pct),
            "alerts_per_1000_currency": alerts_per_1000,
            "stability": stability
        }
    
    @staticmethod
    def assess_confidence(sample_size, sensitivity_stability, temporal_volatility=None):
        """
        Assess calibration confidence based on multiple factors
        """
        score = 0
        factors = {}
        
        # Sample size
        if sample_size > 10000:
            score += 3
            factors["sample_size"] = "EXCELLENT"
        elif sample_size > 1000:
            score += 2
            factors["sample_size"] = "ADEQUATE"
        else:
            score += 1
            factors["sample_size"] = "LIMITED"
        
        # Sensitivity
        if sensitivity_stability == "STABLE":
            score += 2
            factors["sensitivity"] = "STABLE"
        elif sensitivity_stability == "MODERATE":
            score += 1
            factors["sensitivity"] = "MODERATE"
        else:
            factors["sensitivity"] = "SENSITIVE"
        
        # Temporal volatility (if available)
        if temporal_volatility is not None:
            if temporal_volatility < 0.2:
                score += 1
                factors["temporal"] = "STABLE"
            else:
                factors["temporal"] = "VOLATILE"
        
        # Overall confidence
        if score >= 5:
            level = "HIGH"
        elif score >= 3:
            level = "MEDIUM"
        else:
            level = "LOW"
        
        return {
            "level": level,
            "score": score,
            "factors": factors
        }


class ExplorationPathSuggester:
    """Suggests optimal percentile ranges for exploration"""
    
    @staticmethod
    def suggest_path(percentile_ladder):
        """
        Analyze ladder and suggest exploration path
        Looks for rapid alert drop-off or inflection points
        """
        if len(percentile_ladder) < 5:
            return None
        
        # Calculate rate of change
        deltas = []
        for i in range(1, len(percentile_ladder)):
            prev = percentile_ladder[i-1]
            curr = percentile_ladder[i]
            delta_alerts = prev['alerts'] - curr['alerts']
            delta_pct = curr['percentile'] - prev['percentile']
            rate = delta_alerts / delta_pct if delta_pct > 0 else 0
            deltas.append({
                'percentile': curr['percentile'],
                'rate': rate
            })
        
        # Find steepest drop-off
        if deltas:
            max_drop = max(deltas, key=lambda x: x['rate'])
            focus_pct = max_drop['percentile']
            
            # Suggest range around this point
            start = max(75, focus_pct - 5)
            end = min(99, focus_pct + 5)
            
            return {
                "start": int(start),
                "focus_range": [int(focus_pct - 2), int(focus_pct + 3)],
                "reason": f"Rapid alert drop-off observed near p{focus_pct}"
            }
        
        # Default suggestion
        return {
            "start": 85,
            "focus_range": [90, 97],
            "reason": "Standard high-percentile exploration range"
        }


def load_calibration_population(run_id, db_manager):
    """
    Load aggregated population from cache
    
    CRITICAL: This function NEVER re-aggregates
    It only reads pre-computed results from Step 2
    
    Args:
        run_id: Calibration run identifier
        db_manager: Database manager instance
    
    Returns:
        tuple: (DataFrame, metadata_dict)
    
    Raises:
        ValueError: If no cached data exists for this run
    """
    conn = db_manager.connect()
    cursor = conn.cursor()
    
    try:
        cursor.execute("""
            SELECT aggregated_df, metadata_json, row_count
            FROM aggregated_populations_cache
            WHERE run_id = ?
        """, (run_id,))
        
        row = cursor.fetchone()
        
        if not row:
            raise ValueError(
                f"No aggregated population found for run {run_id}. "
                f"Please complete Step 2 (Aggregation) first."
            )
        
        # Deserialize DataFrame
        df = pickle.loads(row['aggregated_df'])
        
        # Parse metadata
        metadata = json.loads(row['metadata_json']) if row['metadata_json'] else {}
        
        # Add row count to metadata
        metadata['cached_row_count'] = row['row_count']
        
        print(f"✅ Loaded {len(df)} rows from cache for run {run_id}")
        
        return df, metadata
        
    except ValueError:
        raise
    except Exception as e:
        raise ValueError(
            f"Failed to load cached aggregation for run {run_id}: {e}"
        )
    finally:
        conn.close()


def cache_aggregated_population(run_id, df, metadata, db_manager):
    """
    Cache aggregated population for fast retrieval
    
    This should be called after aggregation is complete in Step 2
    
    Args:
        run_id: Calibration run identifier
        df: Aggregated pandas DataFrame
        metadata: Dictionary containing aggregation config metadata
        db_manager: Database manager instance
    
    Returns:
        bool: True if caching succeeded, False otherwise
    """
    conn = db_manager.connect()
    cursor = conn.cursor()
    
    try:
        # Serialize DataFrame to binary
        df_blob = pickle.dumps(df, protocol=pickle.HIGHEST_PROTOCOL)
        
        # Serialize metadata to JSON
        metadata_json = json.dumps(metadata)
        
        # Get row count
        row_count = len(df)
        
        # Delete existing cache for this run
        cursor.execute("""
            DELETE FROM aggregated_populations_cache 
            WHERE run_id = ?
        """, (run_id,))
        
        # Insert new cache
        cursor.execute("""
            INSERT INTO aggregated_populations_cache 
            (run_id, aggregated_df, metadata_json, row_count)
            VALUES (?, ?, ?, ?)
        """, (run_id, df_blob, metadata_json, row_count))
        
        conn.commit()
        
        blob_size_kb = len(df_blob) / 1024.0
        print(f"✅ Cached {row_count} rows ({blob_size_kb:.2f} KB) for run {run_id}")
        
        return True
        
    except Exception as e:
        conn.rollback()
        print(f"⚠️ Failed to cache aggregated population: {e}")
        return False
    finally:
        conn.close()


def clear_aggregation_cache(run_id, db_manager):
    """
    Clear cached aggregation for a specific run
    
    Use this when you need to re-aggregate (e.g., config changed)
    
    Args:
        run_id: Calibration run identifier
        db_manager: Database manager instance
    
    Returns:
        bool: True if cache was cleared, False otherwise
    """
    conn = db_manager.connect()
    cursor = conn.cursor()
    
    try:
        cursor.execute("""
            DELETE FROM aggregated_populations_cache 
            WHERE run_id = ?
        """, (run_id,))
        
        deleted_count = cursor.rowcount
        conn.commit()
        
        if deleted_count > 0:
            print(f"✅ Cleared cache for run {run_id}")
            return True
        else:
            print(f"⚠️ No cache found for run {run_id}")
            return False
            
    except Exception as e:
        conn.rollback()
        print(f"⚠️ Failed to clear cache: {e}")
        return False
    finally:
        conn.close()


def check_cache_exists(run_id, db_manager):
    """
    Check if aggregation cache exists for a run
    
    Args:
        run_id: Calibration run identifier
        db_manager: Database manager instance
    
    Returns:
        bool: True if cache exists, False otherwise
    """
    conn = db_manager.connect()
    cursor = conn.cursor()
    
    try:
        cursor.execute("""
            SELECT COUNT(*) as count
            FROM aggregated_populations_cache
            WHERE run_id = ?
        """, (run_id,))
        
        row = cursor.fetchone()
        return row['count'] > 0
        
    except Exception as e:
        print(f"⚠️ Failed to check cache existence: {e}")
        return False
    finally:
        conn.close()
# ADD TO: backend/calibration/shared/calibration_helpers.py
# Place after existing classes (CalibrationContracts, DistributionAnalyzer, etc.)

class ThresholdApplicator:
    """
    Single source of truth for threshold application
    Ensures consistent entity set computation across all services
    """
    
    @staticmethod
    def apply_threshold(df, metric_col, threshold, near_miss_pct=0.1):
        """
        Apply threshold to aggregated population
        
        Args:
            df: Aggregated dataframe
            metric_col: Column name to threshold on (e.g. 'aggregated_amount')
            threshold: Threshold value
            near_miss_pct: Near-miss band percentage (default 10%)
        
        Returns:
            {
                alerted_df, suppressed_df, near_miss_df,
                summary: {...},
                near_miss_band: {...}
            }
        """
        if df.empty:
            return ThresholdApplicator._empty_result(threshold, near_miss_pct)
        
        if metric_col not in df.columns:
            raise ValueError(f"Metric column '{metric_col}' not found in dataframe")
        
        values = df[metric_col]
        total_rows = len(df)
        
        # Calculate near-miss band
        near_miss_lower = threshold * (1 - near_miss_pct)
        
        # Split populations
        alerted_df = df[values >= threshold].copy()
        suppressed_df = df[values < near_miss_lower].copy()
        near_miss_df = df[(values >= near_miss_lower) & (values < threshold)].copy()
        
        # Entity counts
        alerted_accounts = 0
        alerted_customers = 0
        total_accounts = 0
        total_customers = 0
        
        if 'account_id' in df.columns:
            total_accounts = int(df['account_id'].nunique())
            alerted_accounts = int(alerted_df['account_id'].nunique())
        
        if 'customer_id' in df.columns:
            total_customers = int(df['customer_id'].nunique())
            alerted_customers = int(alerted_df['customer_id'].nunique())
        
        # Calculate percentages
        suppression_pct = round((len(suppressed_df) / total_rows) * 100, 2) if total_rows > 0 else 0
        alert_pct = round((len(alerted_df) / total_rows) * 100, 2) if total_rows > 0 else 0
        near_miss_pct_actual = round((len(near_miss_df) / total_rows) * 100, 2) if total_rows > 0 else 0
        
        pct_customers_impacted = round((alerted_customers / total_customers) * 100, 2) if total_customers > 0 else 0
        pct_accounts_impacted = round((alerted_accounts / total_accounts) * 100, 2) if total_accounts > 0 else 0
        
        # Summary stats
        summary = {
            "total_rows": int(total_rows),
            "alerted_count": int(len(alerted_df)),
            "suppressed_count": int(len(suppressed_df)),
            "near_miss_count": int(len(near_miss_df)),
            "alerted_accounts": alerted_accounts,
            "alerted_customers": alerted_customers,
            "total_accounts": total_accounts,
            "total_customers": total_customers,
            "suppression_pct": float(suppression_pct),
            "alert_pct": float(alert_pct),
            "near_miss_pct": float(near_miss_pct_actual),
            "pct_customers_impacted": float(pct_customers_impacted),
            "pct_accounts_impacted": float(pct_accounts_impacted)
        }
        
        return {
            "alerted_df": alerted_df,
            "suppressed_df": suppressed_df,
            "near_miss_df": near_miss_df,
            "summary": summary,
            "near_miss_band": {
                "lower": round(near_miss_lower, 2),
                "upper": float(threshold),
                "pct": near_miss_pct * 100
            }
        }
    
    @staticmethod
    def _empty_result(threshold, near_miss_pct):
        """Return empty result structure"""
        import pandas as pd
        return {
            "alerted_df": pd.DataFrame(),
            "suppressed_df": pd.DataFrame(),
            "near_miss_df": pd.DataFrame(),
            "summary": {
                "total_rows": 0,
                "alerted_count": 0,
                "suppressed_count": 0,
                "near_miss_count": 0,
                "alerted_accounts": 0,
                "alerted_customers": 0,
                "total_accounts": 0,
                "total_customers": 0,
                "suppression_pct": 0.0,
                "alert_pct": 0.0,
                "near_miss_pct": 0.0,
                "pct_customers_impacted": 0.0,
                "pct_accounts_impacted": 0.0
            },
            "near_miss_band": {
                "lower": threshold * (1 - near_miss_pct),
                "upper": threshold,
                "pct": near_miss_pct * 100
            }
        }
    
    @staticmethod
    def get_customer_rollup(alerted_df):
        """
        Rollup alerted entities by customer
        
        Returns:
            {
                customers_with_1_account: int,
                customers_with_2_accounts: int,
                customers_with_3plus_accounts: int,
                top_customers: [{customer_id, account_count, total_exposure}, ...]
            }
        """
        if alerted_df.empty or 'customer_id' not in alerted_df.columns:
            return {
                "customers_with_1_account": 0,
                "customers_with_2_accounts": 0,
                "customers_with_3plus_accounts": 0,
                "top_customers": []
            }
        
        # Count accounts per customer
        customer_groups = alerted_df.groupby('customer_id').agg({
            'account_id': 'nunique'
        }).reset_index()
        customer_groups.columns = ['customer_id', 'account_count']
        
        # Categorize
        customers_1 = len(customer_groups[customer_groups['account_count'] == 1])
        customers_2 = len(customer_groups[customer_groups['account_count'] == 2])
        customers_3plus = len(customer_groups[customer_groups['account_count'] >= 3])
        
        # Top customers by exposure (if amount column exists)
        top_customers = []
        amount_cols = [c for c in alerted_df.columns if 'amount' in c.lower()]
        
        if amount_cols:
            amount_col = amount_cols[0]
            customer_exposure = alerted_df.groupby('customer_id').agg({
                'account_id': 'nunique',
                amount_col: 'sum'
            }).reset_index()
            customer_exposure.columns = ['customer_id', 'account_count', 'total_exposure']
            customer_exposure = customer_exposure.sort_values('total_exposure', ascending=False).head(10)
            
            top_customers = [
                {
                    "customer_id": row['customer_id'],
                    "account_count": int(row['account_count']),
                    "total_exposure": float(row['total_exposure'])
                }
                for _, row in customer_exposure.iterrows()
            ]
        
        return {
            "customers_with_1_account": int(customers_1),
            "customers_with_2_accounts": int(customers_2),
            "customers_with_3plus_accounts": int(customers_3plus),
            "top_customers": top_customers
        }
    
from core.optional_imports import safe_import

np, _NP_OK = safe_import("numpy")
stats, _SCIPY_OK = safe_import("scipy.stats")


class KSStatisticsHelper:
    """
    Helper functions for Kolmogorov-Smirnov statistical analysis.
    Provides utilities for KS computation, interpretation, and visualization prep.
    
    CRITICAL: All methods operate ONLY on aggregated data.
    Never uses STR or external data sources.
    """
    
    @staticmethod
    def compute_ks_statistic(alerted_values, suppressed_values):
        """
        Compute KS statistic between two populations.
        
        Args:
            alerted_values: numpy array of values above threshold
            suppressed_values: numpy array of values below threshold
        
        Returns:
            {
                'ks_statistic': float [0, 1],
                'p_value': float,
                'interpretation': str,
                'max_separation_point': float
            }
        """
        if len(alerted_values) < 10 or len(suppressed_values) < 10:
            return {
                'ks_statistic': None,
                'p_value': None,
                'interpretation': 'insufficient_data',
                'max_separation_point': None,
                'note': 'Need at least 10 entities in each population'
            }
        
        # Compute KS test
        ks_stat, p_value = stats.ks_2samp(alerted_values, suppressed_values)
        
        # Find max separation point
        max_sep_point = KSStatisticsHelper._find_max_separation_point(
            alerted_values, suppressed_values
        )
        
        # Interpret
        interpretation = KSStatisticsHelper._interpret_ks_value(ks_stat)
        
        return {
            'ks_statistic': float(ks_stat),
            'p_value': float(p_value),
            'interpretation': interpretation,
            'max_separation_point': float(max_sep_point)
        }
    
    @staticmethod
    def _find_max_separation_point(alerted_values, suppressed_values):
        """
        Find the value where ECDFs have maximum vertical distance.
        This is where the two distributions are most different.
        """
        # Combine and sort all values
        all_values = np.concatenate([alerted_values, suppressed_values])
        sorted_values = np.sort(all_values)
        
        max_diff = 0
        max_point = sorted_values[0]
        
        # Compute ECDF distance at each unique value
        for val in sorted_values:
            ecdf_alerted = (alerted_values <= val).mean()
            ecdf_suppressed = (suppressed_values <= val).mean()
            
            diff = abs(ecdf_alerted - ecdf_suppressed)
            
            if diff > max_diff:
                max_diff = diff
                max_point = val
        
        return max_point
    
    @staticmethod
    def _interpret_ks_value(ks_stat):
        """
        Map KS value to interpretation level.
        
        Ranges:
        - 0.0-0.2: weak (populations very similar)
        - 0.2-0.4: moderate (some difference)
        - 0.4-0.7: strong (clear separation)
        - 0.7+: very_strong (highly distinct)
        """
        if ks_stat < 0.2:
            return 'weak'
        elif ks_stat < 0.4:
            return 'moderate'
        elif ks_stat < 0.7:
            return 'strong'
        else:
            return 'very_strong'
    
    @staticmethod
    def generate_ecdf_points(values, num_points=100):
        """
        Generate empirical CDF points for visualization.
        
        Args:
            values: numpy array of values
            num_points: number of evaluation points
        
        Returns:
            List of {'value': x, 'ecdf': F(x)} dictionaries
        """
        if len(values) == 0:
            return []
        
        # Generate evaluation points
        min_val = float(values.min())
        max_val = float(values.max())
        
        eval_points = np.linspace(min_val, max_val, num_points)
        
        ecdf_data = []
        for val in eval_points:
            ecdf = float((values <= val).mean())
            ecdf_data.append({
                'value': round(val, 2),
                'ecdf': round(ecdf, 4)
            })
        
        return ecdf_data
    
    @staticmethod
    def compute_ks_sensitivity(df, metric_col, percentiles=None):
        """
        Compute KS across multiple percentile thresholds.
        
        Args:
            df: Aggregated dataframe
            metric_col: Column to threshold on
            percentiles: List of percentiles to test
        
        Returns:
            List of {'percentile': p, 'threshold': t, 'ks_statistic': ks, ...}
        """
        if percentiles is None:
            percentiles = [75, 80, 85, 90, 92, 94, 95, 96, 97, 98, 99]
        
        values = df[metric_col].dropna().values
        
        sensitivity_curve = []
        
        for p in percentiles:
            threshold = np.percentile(values, p)
            
            alerted = values[values >= threshold]
            suppressed = values[values < threshold]
            
            if len(alerted) >= 10 and len(suppressed) >= 10:
                ks_stat, _ = stats.ks_2samp(alerted, suppressed)
                
                sensitivity_curve.append({
                    'percentile': float(p),
                    'threshold': round(float(threshold), 2),
                    'ks_statistic': round(float(ks_stat), 4),
                    'interpretation': KSStatisticsHelper._interpret_ks_value(ks_stat),
                    'alerted_count': int(len(alerted)),
                    'suppressed_count': int(len(suppressed))
                })
        
        return sensitivity_curve
    
    @staticmethod
    def find_optimal_ks_percentile(sensitivity_curve):
        """
        Find percentile with maximum KS separation.
        
        Args:
            sensitivity_curve: Output from compute_ks_sensitivity
        
        Returns:
            Dictionary with optimal percentile info
        """
        if not sensitivity_curve:
            return None
        
        optimal = max(sensitivity_curve, key=lambda x: x['ks_statistic'])
        
        return {
            'percentile': optimal['percentile'],
            'threshold': optimal['threshold'],
            'ks_statistic': optimal['ks_statistic'],
            'interpretation': optimal['interpretation']
        }
    
    @staticmethod
    def validate_ks_quality(ks_stat, sample_size_alerted, sample_size_suppressed):
        """
        Assess quality/reliability of KS statistic.
        
        Returns:
            {
                'quality': str (high/medium/low),
                'warnings': [str, ...],
                'recommendations': [str, ...]
            }
        """
        warnings = []
        recommendations = []
        
        # Sample size checks
        min_sample = min(sample_size_alerted, sample_size_suppressed)
        
        if min_sample < 30:
            warnings.append('Small sample size may reduce KS reliability')
            recommendations.append('Consider lowering threshold or increasing population')
        
        # Imbalance check
        ratio = max(sample_size_alerted, sample_size_suppressed) / min_sample
        if ratio > 10:
            warnings.append('Severe population imbalance detected')
            recommendations.append('Extreme imbalance may inflate KS - verify with visual inspection')
        
        # KS interpretation
        if ks_stat < 0.2:
            warnings.append('Weak separation - threshold may not create meaningful distinction')
            recommendations.append('Try higher percentiles for stronger separation')
        
        # Overall quality
        if min_sample >= 100 and ks_stat >= 0.4:
            quality = 'high'
        elif min_sample >= 30 and ks_stat >= 0.2:
            quality = 'medium'
        else:
            quality = 'low'
        
        return {
            'quality': quality,
            'warnings': warnings,
            'recommendations': recommendations
        }


class KSNarrativeGenerator:
    """
    Generates investigator-friendly narratives for KS statistics.
    Translates statistical concepts into actionable insights.
    """
    
    @staticmethod
    def generate_headline(ks_stat, interpretation):
        """Generate concise headline for KS result"""
        if interpretation == 'insufficient_data':
            return 'Insufficient Data for KS Analysis'
        
        headlines = {
            'weak': f'Weak Separation (KS = {ks_stat:.3f})',
            'moderate': f'Moderate Separation (KS = {ks_stat:.3f})',
            'strong': f'Strong Separation (KS = {ks_stat:.3f})',
            'very_strong': f'Very Strong Separation (KS = {ks_stat:.3f})'
        }
        
        return headlines.get(interpretation, 'Unknown')
    
    @staticmethod
    def generate_explanation(ks_stat, interpretation, threshold, populations):
        """Generate detailed explanation"""
        if interpretation == 'insufficient_data':
            return (
                'Not enough entities in one or both populations to compute KS statistic reliably. '
                'KS requires at least 10 entities in each population.'
            )
        
        alerted_size = populations.get('alerted_size', 0)
        suppressed_size = populations.get('suppressed_size', 0)
        
        explanations = {
            'weak': (
                f'The alerted ({alerted_size:,}) and suppressed ({suppressed_size:,}) populations '
                f'are structurally very similar. Entities just above the threshold of ₹{threshold:,.0f} '
                f'behave much like entities just below it. This suggests the threshold may not be '
                f'identifying a distinct risk cohort.'
            ),
            'moderate': (
                f'The threshold creates some structural difference between alerted ({alerted_size:,}) '
                f'and suppressed ({suppressed_size:,}) populations. Entities above ₹{threshold:,.0f} '
                f'show detectably different patterns, though the separation is not dramatic.'
            ),
            'strong': (
                f'The threshold creates clear structural separation. Entities above ₹{threshold:,.0f} '
                f'({alerted_size:,} total) form a distinctly different cohort from those below '
                f'({suppressed_size:,} total), indicating the threshold successfully isolates a '
                f'behaviorally distinct population.'
            ),
            'very_strong': (
                f'The threshold creates exceptional structural separation. The alerted population '
                f'({alerted_size:,} entities) is highly distinct from the suppressed population '
                f'({suppressed_size:,} entities), suggesting ₹{threshold:,.0f} identifies a '
                f'fundamentally different risk profile.'
            )
        }
        
        return explanations.get(interpretation, '')
    
    @staticmethod
    def generate_recommendation(interpretation):
        """Generate actionable recommendation"""
        recommendations = {
            'insufficient_data': (
                'Adjust threshold to increase population sizes, or use percentile analysis instead.'
            ),
            'weak': (
                'Consider testing higher percentiles or alternative aggregation strategies. '
                'A stronger KS would indicate clearer behavioral separation.'
            ),
            'moderate': (
                'This level of separation is workable but could be strengthened. Review the percentile '
                'ladder to see if nearby thresholds offer better KS values.'
            ),
            'strong': (
                'This is strong evidence the threshold creates meaningful segmentation. '
                'Combine with entity impact and STR evaluation for final calibration decision.'
            ),
            'very_strong': (
                'This is excellent separation. Verify this threshold aligns with operational capacity '
                'and regulatory coverage goals.'
            )
        }
        
        return recommendations.get(interpretation, '')
    
    @staticmethod
    def generate_technical_note(ks_stat, interpretation):
        """Generate technical context"""
        notes = {
            'insufficient_data': 'KS requires at least 10 entities in each population.',
            'weak': f'KS < 0.2 indicates minimal distributional difference.',
            'moderate': f'KS 0.2-0.4 suggests moderate distributional divergence.',
            'strong': f'KS 0.4-0.7 indicates substantial distributional difference.',
            'very_strong': f'KS > 0.7 indicates populations are highly divergent.'
        }
        
        return notes.get(interpretation, '')
    
    @staticmethod
    def generate_full_narrative(ks_result, threshold, populations):
        """
        Generate complete narrative bundle.
        
        Returns:
            {
                'headline': str,
                'explanation': str,
                'recommendation': str,
                'technical_note': str
            }
        """
        ks_stat = ks_result.get('ks_statistic')
        interpretation = ks_result.get('interpretation')
        
        return {
            'headline': KSNarrativeGenerator.generate_headline(ks_stat, interpretation),
            'explanation': KSNarrativeGenerator.generate_explanation(
                ks_stat, interpretation, threshold, populations
            ),
            'recommendation': KSNarrativeGenerator.generate_recommendation(interpretation),
            'technical_note': KSNarrativeGenerator.generate_technical_note(ks_stat, interpretation)
        }


class KSVisualizationHelper:
    """
    Helper functions for preparing KS visualization data.
    Ensures data is ready for frontend charting libraries.
    """
    
    @staticmethod
    def prepare_cdf_comparison(alerted_values, suppressed_values, threshold, num_points=100):
        """
        Prepare dual CDF comparison data for charting.
        
        Returns data ready for Recharts LineChart.
        
        Returns:
            {
                'cdf_data': [{'value': x, 'alerted_cdf': F_a(x), 'suppressed_cdf': F_s(x), 'separation': |F_a - F_s|}, ...],
                'max_separation': {'value': x*, 'separation': max_sep, ...},
                'threshold_marker': {'value': threshold, 'alerted_cdf': F_a(t), 'suppressed_cdf': F_s(t)}
            }
        """
        if len(alerted_values) == 0 or len(suppressed_values) == 0:
            return {
                'cdf_data': [],
                'max_separation': None,
                'threshold_marker': None
            }
        
        # Generate evaluation points
        min_val = min(alerted_values.min(), suppressed_values.min())
        max_val = max(alerted_values.max(), suppressed_values.max())
        
        eval_points = np.linspace(min_val, max_val, num_points)
        
        cdf_data = []
        max_sep = {'separation': 0, 'value': min_val}
        
        for val in eval_points:
            alerted_cdf = float((alerted_values <= val).mean())
            suppressed_cdf = float((suppressed_values <= val).mean())
            separation = abs(alerted_cdf - suppressed_cdf)
            
            cdf_data.append({
                'value': round(float(val), 2),
                'alerted_cdf': round(alerted_cdf, 4),
                'suppressed_cdf': round(suppressed_cdf, 4),
                'separation': round(separation, 4)
            })
            
            # Track max separation
            if separation > max_sep['separation']:
                max_sep = {
                    'value': float(val),
                    'separation': separation,
                    'alerted_cdf': alerted_cdf,
                    'suppressed_cdf': suppressed_cdf
                }
        
        # Threshold marker
        threshold_marker = {
            'value': float(threshold),
            'alerted_cdf': float((alerted_values <= threshold).mean()),
            'suppressed_cdf': float((suppressed_values <= threshold).mean())
        }
        
        return {
            'cdf_data': cdf_data,
            'max_separation': max_sep,
            'threshold_marker': threshold_marker
        }
    
    @staticmethod
    def prepare_sensitivity_chart(sensitivity_curve, current_percentile=None):
        """
        Prepare KS sensitivity data for line chart.
        
        Adds color coding and highlights current percentile.
        """
        if not sensitivity_curve:
            return []
        
        chart_data = []
        
        for point in sensitivity_curve:
            ks = point['ks_statistic']
            
            # Color coding
            if ks >= 0.7:
                color = '#2e7d32'  # green - very strong
            elif ks >= 0.4:
                color = '#1976d2'  # blue - strong
            elif ks >= 0.2:
                color = '#ed6c02'  # orange - moderate
            else:
                color = '#d32f2f'  # red - weak
            
            # Highlight if current
            is_current = (current_percentile and 
                         abs(point['percentile'] - current_percentile) < 0.1)
            
            chart_data.append({
                **point,
                'color': color,
                'is_current': is_current,
                'marker_size': 6 if is_current else 3
            })
        
        return chart_data
    
    @staticmethod
    def prepare_ks_heatmap(sensitivity_curve):
        """
        Prepare KS heatmap grid data.
        
        Returns data suitable for heatmap visualization.
        """
        if not sensitivity_curve:
            return []
        
        heatmap_data = []
        
        for point in sensitivity_curve:
            ks = point['ks_statistic']
            
            # Determine intensity (0-100)
            intensity = int(ks * 100)
            
            heatmap_data.append({
                'percentile': point['percentile'],
                'ks_value': ks,
                'intensity': intensity,
                'category': point['interpretation'],
                'threshold': point['threshold']
            })
        
        return heatmap_data

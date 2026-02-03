# backend/calibration/services/calibration_impact_service.py
"""
Fixed Impact Service - Ensures all data is returned properly
"""
import pandas as pd
import numpy as np
from datetime import datetime, timedelta


class CalibrationImpactService:
    """
    Provides comprehensive impact analysis for threshold selection
    """
    
    def __init__(self, db_manager):
        self.db = db_manager
    
    def get_comprehensive_impact(self, run_id, threshold, percentile, metric='amount'):
        """
        ALL-IN-ONE impact analysis with proper data structure
        """
        # Load data
        df, metadata = self._load_calibration_population(run_id)
        
        col_map = {'amount': 'aggregated_amount', 'count': 'aggregated_count'}
        target_col = col_map.get(metric, 'aggregated_amount')
        
        if target_col not in df.columns:
            numeric_cols = df.select_dtypes(include=[np.number]).columns
            target_col = numeric_cols[0] if len(numeric_cols) > 0 else None
        
        if target_col is None:
            return self._empty_response(threshold, percentile)
        
        values = df[target_col].dropna()
        breached_df = df[df[target_col] >= threshold]
        alerts_triggered = len(breached_df)
        
        # Calculate percentage of population
        pct_population = round((alerts_triggered / len(values)) * 100, 2) if len(values) > 0 else 0.0
        
        # 1. Composition Analysis
        composition = self._analyze_composition(breached_df)
        print(f"🔍 Composition returned: {composition}")
        
        # 2. Concentration Analysis
        concentration = self._analyze_concentration(breached_df, alerts_triggered)
        
        # 3. Temporal Analysis
        temporal = self._analyze_temporal(breached_df, threshold, target_col)
        print(f"📅 Temporal returned: {temporal}")
        
        # 4. Sensitivity Analysis
        sensitivity = self._calculate_sensitivity(df, target_col, percentile, threshold)
        
        # 5. Confidence Assessment
        confidence = self._assess_confidence(
            sample_size=len(df),
            sensitivity_stability=sensitivity.get('stability', 'UNKNOWN'),
            temporal_volatility=temporal.get('volatility_score', 0.5)
        )
        print(f"✅ Confidence returned: {confidence}")
        
        # 6. Near-miss Analysis
        lower_bound = threshold * 0.9
        near_miss_df = df[(df[target_col] >= lower_bound) & (df[target_col] < threshold)]
        
        # Build result with EXPLICIT keys
        result = {
            "alert_grain": metadata.get('level', 'ACCOUNT_DATE').upper().replace('_', ' '),
            "threshold": float(threshold),
            "percentile": float(percentile),
            "alerts_triggered": int(alerts_triggered),
            "pct_population": float(pct_population),
            "suppression_pct": round(100 - pct_population, 2),
            
            # ✅ CRITICAL: Ensure these are always present
            "composition": composition,
            "concentration": concentration,
            "temporal": temporal,
            "sensitivity": sensitivity,
            "confidence": confidence,
            
            "near_miss": {
                "band_pct": 10.0,
                "lower_bound": float(lower_bound),
                "upper_bound": float(threshold),
                "entity_count": int(len(near_miss_df))
            }
        }
        
        # Debug log
        print(f"📦 Final result keys: {result.keys()}")
        print(f"📦 Composition type: {type(result['composition'])}")
        print(f"📦 Temporal type: {type(result['temporal'])}")
        print(f"📦 Confidence type: {type(result['confidence'])}")
        
        return self._convert_to_native_types(result)
    
    def _load_calibration_population(self, run_id):
        """Load calibration population data"""
        # Simplified - replace with actual DB loading logic
        query = f"SELECT * FROM calibration_population WHERE run_id = {run_id}"
        df = self.db.execute_query(query)
        
        metadata = {
            'level': 'ACCOUNT_DATE',
            'frequency': '7-day',
            'lookback_days': 90
        }
        
        return df, metadata
    
    def _empty_response(self, threshold, percentile):
        """Return empty but valid response structure"""
        return {
            "alert_grain": "UNKNOWN",
            "threshold": float(threshold),
            "percentile": float(percentile),
            "alerts_triggered": 0,
            "pct_population": 0.0,
            "suppression_pct": 100.0,
            "composition": {"note": "No data available"},
            "concentration": {"warning": False, "message": "No data"},
            "temporal": {"note": "No data available"},
            "sensitivity": {"stability": "UNKNOWN", "alerts_per_1pct": 0, "alerts_per_1000_currency": 0},
            "confidence": {"level": "UNKNOWN", "factors": {}},
            "near_miss": {"band_pct": 10.0, "entity_count": 0}
        }
    
    def _convert_to_native_types(self, obj):
        """Convert numpy types to native Python types"""
        if isinstance(obj, dict):
            return {k: self._convert_to_native_types(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [self._convert_to_native_types(v) for v in obj]
        elif isinstance(obj, (np.integer, np.int64, np.int32)):
            return int(obj)
        elif isinstance(obj, (np.floating, np.float64, np.float32)):
            return float(obj)
        elif isinstance(obj, (np.bool_, bool)):
            return bool(obj)
        elif isinstance(obj, np.ndarray):
            return obj.tolist()
        elif pd.isna(obj):
            return None
        else:
            return obj
    
    def _analyze_composition(self, breached_df):
        """
        Analyze risk composition - ALWAYS returns valid dict
        """
        if breached_df.empty:
            return {"note": "No alerts to analyze"}
        
        composition = {}
        found_any = False
        
        # Customer type
        if 'customer_type' in breached_df.columns and breached_df['customer_type'].notna().any():
            comp = breached_df['customer_type'].value_counts(normalize=True) * 100
            composition['by_customer_type'] = {str(k): round(float(v), 1) for k, v in comp.to_dict().items()}
            found_any = True
        
        # Risk rating
        if 'risk_rating' in breached_df.columns and breached_df['risk_rating'].notna().any():
            comp = breached_df['risk_rating'].value_counts(normalize=True) * 100
            composition['by_risk_rating'] = {str(k): round(float(v), 1) for k, v in comp.to_dict().items()}
            found_any = True
        
        # Account type
        if 'account_type' in breached_df.columns and breached_df['account_type'].notna().any():
            comp = breached_df['account_type'].value_counts(normalize=True) * 100
            composition['by_account_type'] = {str(k): round(float(v), 1) for k, v in comp.to_dict().items()}
            found_any = True
        
        # Geography
        geo_cols = ['geography', 'region', 'state', 'country']
        for geo_col in geo_cols:
            if geo_col in breached_df.columns and breached_df[geo_col].notna().any():
                comp = breached_df[geo_col].value_counts(normalize=True) * 100
                composition['by_geography'] = {str(k): round(float(v), 1) for k, v in comp.head(10).to_dict().items()}
                found_any = True
                break
        
        if not found_any:
            return {"note": "No composition dimensions available (enable customer_type, risk_rating fields)"}
        
        return composition
    
    def _analyze_concentration(self, breached_df, total_alerts):
        """Analyze concentration risk"""
        if breached_df.empty or total_alerts == 0:
            return {
                "single_entity_pct": 0.0,
                "top_10_entities_pct": 0.0,
                "warning": False,
                "message": "Concentration analysis unavailable"
            }
        
        entity_cols = ['account_id', 'customer_id', 'entity_id']
        entity_col = None
        
        for col in entity_cols:
            if col in breached_df.columns:
                entity_col = col
                break
        
        if not entity_col:
            return {
                "single_entity_pct": 0.0,
                "top_10_entities_pct": 0.0,
                "warning": False,
                "message": "No entity column found"
            }
        
        # Count alerts per entity
        entity_counts = breached_df[entity_col].value_counts()
        
        if len(entity_counts) == 0:
            return {"single_entity_pct": 0.0, "top_10_entities_pct": 0.0, "warning": False, "message": "No entities"}
        
        # Single entity percentage
        max_entity_alerts = int(entity_counts.iloc[0])
        single_entity_pct = round((max_entity_alerts / total_alerts) * 100, 1)
        
        # Top 10 entities
        top_10_alerts = int(entity_counts.head(10).sum())
        top_10_pct = round((top_10_alerts / total_alerts) * 100, 1)
        
        # Warning threshold
        warning = bool(single_entity_pct > 5 or top_10_pct > 30)
        
        message = ""
        if single_entity_pct > 5:
            message = f"{single_entity_pct}% of alerts come from 1 entity"
        elif top_10_pct > 30:
            message = f"{top_10_pct}% of alerts come from 10 entities"
        else:
            message = "Concentration within acceptable limits"
        
        return {
            "single_entity_pct": float(single_entity_pct),
            "top_10_entities_pct": float(top_10_pct),
            "warning": warning,
            "message": message
        }
    
    def _analyze_temporal(self, breached_df, threshold, target_col):
        """
        Analyze temporal stability - ALWAYS returns valid dict
        """
        if breached_df.empty:
            return {
                "note": "No alerts to analyze",
                "daily_alerts": [],
                "avg_monthly_alerts": 0,
                "volatility_score": 0.0,
                "spike_days": [],
                "stability": "UNKNOWN"
            }
        
        # Check if date column exists
        date_cols = ['date', 'transaction_date', 'aggregation_date', 'Date', 'DATE', 'txn_date']
        date_col = None
        
        for col in date_cols:
            if col in breached_df.columns:
                date_col = col
                break
        
        if not date_col:
            return {
                "note": "Temporal analysis unavailable (no date column found)",
                "daily_alerts": [],
                "avg_monthly_alerts": int(len(breached_df)),
                "volatility_score": 0.0,
                "spike_days": [],
                "stability": "UNKNOWN"
            }
        
        # Convert to datetime
        try:
            breached_df = breached_df.copy()
            breached_df[date_col] = pd.to_datetime(breached_df[date_col], errors='coerce')
            breached_df = breached_df[breached_df[date_col].notna()]
        except Exception as e:
            print(f"⚠️ Date conversion failed: {e}")
            return {
                "note": "Temporal analysis unavailable (date conversion failed)",
                "daily_alerts": [],
                "avg_monthly_alerts": int(len(breached_df)),
                "volatility_score": 0.0,
                "spike_days": [],
                "stability": "UNKNOWN"
            }
        
        if breached_df.empty:
            return {
                "note": "No valid dates found",
                "daily_alerts": [],
                "avg_monthly_alerts": 0,
                "volatility_score": 0.0,
                "spike_days": [],
                "stability": "UNKNOWN"
            }
        
        # Daily alert counts
        daily = breached_df.groupby(date_col).size().reset_index(name='count')
        daily = daily.sort_values(date_col)
        
        if len(daily) == 0:
            return {
                "note": "No temporal data available",
                "daily_alerts": [],
                "avg_monthly_alerts": 0,
                "volatility_score": 0.0,
                "spike_days": [],
                "stability": "UNKNOWN"
            }
        
        # Calculate statistics
        avg_daily = float(daily['count'].mean())
        std_daily = float(daily['count'].std()) if len(daily) > 1 else 0.0
        volatility_score = round(std_daily / avg_daily, 2) if avg_daily > 0 else 0.0
        
        # Monthly projection
        days_in_data = (daily[date_col].max() - daily[date_col].min()).days
        if days_in_data > 0:
            avg_monthly = int((len(breached_df) / days_in_data) * 30)
        else:
            avg_monthly = int(len(breached_df))
        
        # Identify spike days
        spike_threshold = avg_daily + (2 * std_daily)
        spike_days = daily[daily['count'] > spike_threshold][date_col].tolist()
        
        # ✅ Return complete structure
        return {
            "daily_alerts": [
                {
                    "date": row[date_col].strftime('%Y-%m-%d'),
                    "count": int(row['count'])
                } for _, row in daily.iterrows()
            ][:30],
            "avg_monthly_alerts": avg_monthly,
            "volatility_score": float(volatility_score),
            "spike_days": [d.strftime('%Y-%m-%d') for d in spike_days[:5]],
            "stability": "STABLE" if volatility_score < 0.3 else "VOLATILE"
        }
    
    def _calculate_sensitivity(self, df, target_col, percentile, threshold):
        """Calculate threshold sensitivity"""
        values = df[target_col].dropna().sort_values()
        
        if len(values) == 0:
            return {
                "stability": "UNKNOWN",
                "alerts_per_1pct": 0,
                "alerts_per_1000_currency": 0
            }
        
        # Calculate nearby thresholds
        p_minus = np.percentile(values, max(0, percentile - 1))
        p_plus = np.percentile(values, min(100, percentile + 1))
        
        alerts_at_current = len(values[values >= threshold])
        alerts_at_minus = len(values[values >= p_minus])
        alerts_at_plus = len(values[values >= p_plus])
        
        # Alerts per 1-percentile shift
        alerts_per_1pct = int((alerts_at_minus - alerts_at_plus) / 2)
        
        # Alerts per currency unit shift
        if threshold > 1000:
            threshold_plus_1k = threshold + 1000
            alerts_at_plus_1k = len(values[values >= threshold_plus_1k])
            alerts_per_1000_currency = int(alerts_at_current - alerts_at_plus_1k)
        else:
            alerts_per_1000_currency = 0
        
        # Stability assessment
        if alerts_per_1pct < 5:
            stability = "STABLE"
        elif alerts_per_1pct < 20:
            stability = "MODERATE"
        else:
            stability = "SENSITIVE"
        
        return {
            "stability": stability,
            "alerts_per_1pct": alerts_per_1pct,
            "alerts_per_1000_currency": alerts_per_1000_currency
        }
    
    def _assess_confidence(self, sample_size, sensitivity_stability, temporal_volatility=None):
        """
        Assess calibration confidence - ALWAYS returns valid dict
        """
        factors = {}
        
        # Sample size factor
        if sample_size >= 1000:
            factors['sample_size'] = 'EXCELLENT'
        elif sample_size >= 500:
            factors['sample_size'] = 'ADEQUATE'
        elif sample_size >= 100:
            factors['sample_size'] = 'LIMITED'
        else:
            factors['sample_size'] = 'INSUFFICIENT'
        
        # Sensitivity factor
        if sensitivity_stability == 'STABLE':
            factors['sensitivity'] = 'STABLE'
        elif sensitivity_stability == 'MODERATE':
            factors['sensitivity'] = 'MODERATE'
        else:
            factors['sensitivity'] = 'UNSTABLE'
        
        # Temporal factor (if available)
        if temporal_volatility is not None:
            if temporal_volatility < 0.3:
                factors['temporal_stability'] = 'STABLE'
            elif temporal_volatility < 0.6:
                factors['temporal_stability'] = 'MODERATE'
            else:
                factors['temporal_stability'] = 'VOLATILE'
        
        # Overall confidence level
        excellent_count = sum(1 for v in factors.values() if 'EXCELLENT' in v or v == 'STABLE')
        adequate_count = sum(1 for v in factors.values() if 'ADEQUATE' in v or v == 'MODERATE')
        
        if excellent_count >= 2:
            level = 'HIGH'
        elif excellent_count + adequate_count >= 2:
            level = 'MEDIUM'
        else:
            level = 'LOW'
        
        return {
            "level": level,
            "factors": factors
        }
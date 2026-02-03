

class AggregationConfigService:
    """Manage aggregation configuration logic"""
    
    SUPPORTED_GRAINS = {
        'entity': ['account', 'customer'],
        'time': ['daily', 'weekly', 'monthly'],  # This is for display only
        'metrics': ['sum_amount', 'avg_amount', 'max_amount', 'count', 'velocity']
    }
    
    # Internal engine metrics for validation bypass
    ENGINE_METRICS = ['amount', 'count']
    
    LOOKBACK_UNITS = ['days', 'weeks', 'months']
    FREQUENCIES = ['daily', 'weekly', '28day', 'monthly', 'quarterly']
    
    @staticmethod
    def get_defaults():
        """Return safe defaults"""
        return {
            'level': 'account',
            'lookback_value': 30,
            'lookback_unit': 'days',
            'frequency': 'daily',
            'metrics': ['sum_amount', 'count'],
            'filter_history': True
        }
    
    @staticmethod
    def validate_config(config):
        """
        Validate aggregation config.
        Now robust to both UI-format (lookback_value) and Engine-format (lookback_days).
        """
        errors = []
        warnings = []
        
        # 1. Entity grain
        if config.get('level') not in AggregationConfigService.SUPPORTED_GRAINS['entity']:
            errors.append(f"Invalid entity grain: {config.get('level')}")
        
        # 2. Lookback Validation (Hybrid Support)
        lookback_value = config.get('lookback_value')
        lookback_days = config.get('lookback_days')
        
        has_valid_ui_lookback = isinstance(lookback_value, int) and lookback_value >= 1
        has_valid_engine_lookback = isinstance(lookback_days, int) and lookback_days >= 1
        
        if not has_valid_ui_lookback and not has_valid_engine_lookback:
            errors.append("Lookback must be integer ≥ 1 (checks lookback_value or lookback_days)")
        
        # Validate unit only if we are relying on UI format
        if has_valid_ui_lookback and not has_valid_engine_lookback:
            if config.get('lookback_unit') not in AggregationConfigService.LOOKBACK_UNITS:
                errors.append(f"Invalid lookback unit: {config.get('lookback_unit')}")
        
        # 3. Frequency
        frequency = config.get('frequency')
        if frequency and frequency not in AggregationConfigService.FREQUENCIES:
            errors.append(f"Invalid frequency: {frequency}")
        
        # 4. Metrics Validation (Hybrid Support)
        metrics = config.get('metrics', [])
        if not metrics:
            errors.append("At least one metric required")
        
        # Check if metrics match UI list OR Engine list
        invalid_metrics = []
        for m in metrics:
            is_ui_metric = m in AggregationConfigService.SUPPORTED_GRAINS['metrics']
            is_engine_metric = m in AggregationConfigService.ENGINE_METRICS
            if not (is_ui_metric or is_engine_metric):
                invalid_metrics.append(m)
                
        if invalid_metrics:
            errors.append(f"Invalid metrics: {invalid_metrics}")
        
        # Warnings (not errors)
        final_days = lookback_days if has_valid_engine_lookback else lookback_value
        if final_days and final_days > 365:
            warnings.append("Lookback > 1 year may cause performance issues")
        
        return {
            'valid': len(errors) == 0,
            'errors': errors,
            'warnings': warnings
        }
    
    @staticmethod
    def normalize_to_days(value, unit):
        """Convert lookback to days for engine"""
        if value is None:
            return 30
        if unit == 'days':
            return value
        elif unit == 'weeks':
            return value * 7
        elif unit == 'months':
            return value * 30  # Approximate
        return value
    
    @staticmethod
    def prepare_for_engine(config):
        """
        Transform config to engine format.
        Idempotent: works if config is already in engine format.
        """
        # 1. Handle Lookback
        if 'lookback_days' in config:
            lookback_days = config['lookback_days']
        else:
            lookback_days = AggregationConfigService.normalize_to_days(
                config.get('lookback_value', 30),
                config.get('lookback_unit', 'days')
            )
        
        # 2. Handle Metrics
        metrics = []
        input_metrics = config.get('metrics', [])
        
        # Check for UI metrics
        if any(m in input_metrics for m in ['sum_amount', 'avg_amount', 'max_amount']):
            metrics.append('amount')
        
        # Check for Engine metrics (pass-through)
        if 'amount' in input_metrics and 'amount' not in metrics:
            metrics.append('amount')
            
        # Check for Count/Velocity
        if any(m in input_metrics for m in ['count', 'velocity']):
            metrics.append('count')
        
        return {
            'level': config.get('level', 'account'),
            'lookback_days': lookback_days,
            'frequency': config.get('frequency', 'daily'),
            'metrics': metrics,
            'filter_history': config.get('filter_history', True),
            'detailed_metrics': input_metrics  # Keep for reporting
        }

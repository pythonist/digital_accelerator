# backend/services/mule_detection/pattern_engine.py
"""
Pattern Detection Engine: Identifies mule-like behavioral patterns
Patterns are evidence-based, not binary classifications
"""
from typing import Dict, List, Tuple
import pandas as pd

class MulePatternEngine:
    """Detects behavioral patterns indicative of mule activity"""
    
    def __init__(self):
        self.pattern_definitions = {
            'HIGH_PASS_THROUGH': {
                'name': 'High Pass-Through',
                'description': 'Account retains minimal funds, rapidly transfers out',
                'threshold': 0.85,
                'severity': 'HIGH'
            },
            'FAN_IN': {
                'name': 'Fan-In Aggregation',
                'description': 'Many senders to single account',
                'threshold': 15,
                'severity': 'MEDIUM'
            },
            'FAN_OUT': {
                'name': 'Fan-Out Distribution',
                'description': 'Single account to many receivers',
                'threshold': 15,
                'severity': 'MEDIUM'
            },
            'RAPID_MOVEMENT': {
                'name': 'Rapid Fund Movement',
                'description': 'Funds transferred within hours of receipt',
                'threshold': 6,
                'severity': 'HIGH'
            },
            'CHANNEL_HOPPING': {
                'name': 'Channel Switching',
                'description': 'Frequent changes between transaction channels',
                'threshold': 0.5,
                'severity': 'MEDIUM'
            },
            'ACTIVITY_SPIKE': {
                'name': 'Sudden Activity Spike',
                'description': 'Dormant account suddenly active',
                'threshold': True,
                'severity': 'MEDIUM'
            },
            'TURNOVER_ANOMALY': {
                'name': 'Turnover Exceeds Expected',
                'description': 'Transaction volume inconsistent with profile',
                'threshold': 3.0,
                'severity': 'HIGH'
            },
            'LAYERING': {
                'name': 'Layering Pattern',
                'description': 'Multiple sequential transfers suggesting structuring',
                'threshold': 5,
                'severity': 'HIGH'
            }
        }
    
    def detect_patterns(self, features: Dict) -> List[Dict]:
        """
        Detect all applicable patterns for an account
        
        Args:
            features: Computed feature dictionary
        
        Returns:
            List of detected patterns with evidence
        """
        patterns = []
        
        # Pattern 1: High Pass-Through
        if features.get('pass_through_ratio', 0) >= self.pattern_definitions['HIGH_PASS_THROUGH']['threshold']:
            patterns.append({
                'pattern_id': 'HIGH_PASS_THROUGH',
                'pattern_name': 'High Pass-Through',
                'severity': 'HIGH',
                'score': float(features['pass_through_ratio']),
                'evidence': f"{features['pass_through_ratio']*100:.1f}% of funds transferred out",
                'details': {
                    'total_credit': features.get('total_credit', 0),
                    'total_debit': features.get('total_debit', 0),
                    'retention': features.get('retention_ratio', 0)
                }
            })
        
        # Pattern 2: Fan-In
        if features.get('unique_senders', 0) >= self.pattern_definitions['FAN_IN']['threshold']:
            patterns.append({
                'pattern_id': 'FAN_IN',
                'pattern_name': 'Fan-In Aggregation',
                'severity': 'MEDIUM',
                'score': float(features['unique_senders']),
                'evidence': f"Received from {features['unique_senders']} different accounts",
                'details': {
                    'unique_senders': features['unique_senders'],
                    'fan_in_score': features.get('fan_in_score', 0)
                }
            })
        
        # Pattern 3: Fan-Out
        if features.get('unique_receivers', 0) >= self.pattern_definitions['FAN_OUT']['threshold']:
            patterns.append({
                'pattern_id': 'FAN_OUT',
                'pattern_name': 'Fan-Out Distribution',
                'severity': 'MEDIUM',
                'score': float(features['unique_receivers']),
                'evidence': f"Sent to {features['unique_receivers']} different accounts",
                'details': {
                    'unique_receivers': features['unique_receivers'],
                    'fan_out_score': features.get('fan_out_score', 0)
                }
            })
        
        # Pattern 4: Rapid Movement
        holding_time = features.get('holding_time_avg', 999)
        if 0 < holding_time < self.pattern_definitions['RAPID_MOVEMENT']['threshold']:
            patterns.append({
                'pattern_id': 'RAPID_MOVEMENT',
                'pattern_name': 'Rapid Fund Movement',
                'severity': 'HIGH',
                'score': float(6 - holding_time),
                'evidence': f"Average holding time: {holding_time:.1f} hours",
                'details': {
                    'holding_time_avg': holding_time,
                    'same_day_pass_through': features.get('same_day_pass_through', 0)
                }
            })
        
        # Pattern 5: Channel Hopping
        if features.get('channel_switching', 0) >= self.pattern_definitions['CHANNEL_HOPPING']['threshold']:
            patterns.append({
                'pattern_id': 'CHANNEL_HOPPING',
                'pattern_name': 'Channel Switching',
                'severity': 'MEDIUM',
                'score': float(features['channel_switching']),
                'evidence': f"{features['channel_switching']*100:.0f}% of transactions change channel",
                'details': {
                    'channel_switching': features['channel_switching'],
                    'channel_entropy': features.get('channel_entropy', 0),
                    'unique_channels': features.get('unique_channels', 0)
                }
            })
        
        # Pattern 6: Activity Spike
        if features.get('activity_spike', False):
            patterns.append({
                'pattern_id': 'ACTIVITY_SPIKE',
                'pattern_name': 'Sudden Activity Spike',
                'severity': 'MEDIUM',
                'score': 1.0,
                'evidence': f"Account dormant for {features.get('dormancy_period', 0)} days before spike",
                'details': {
                    'dormancy_period': features.get('dormancy_period', 0),
                    'velocity': features.get('velocity', 0)
                }
            })
        
        # Pattern 7: Turnover Anomaly
        if features.get('turnover_ratio', 0) >= self.pattern_definitions['TURNOVER_ANOMALY']['threshold']:
            patterns.append({
                'pattern_id': 'TURNOVER_ANOMALY',
                'pattern_name': 'Turnover Exceeds Expected',
                'severity': 'HIGH',
                'score': float(features['turnover_ratio']),
                'evidence': f"{features['turnover_ratio']:.1f}x expected turnover",
                'details': {
                    'expected_turnover': features.get('expected_turnover', 0),
                    'actual_turnover': features.get('actual_turnover', 0),
                    'excess': features.get('turnover_excess', 0)
                }
            })
        
        return patterns
    
    def calculate_risk_score(self, patterns: List[Dict]) -> Dict:
        """
        Calculate overall risk score based on detected patterns
        
        Returns:
            Dictionary with risk score and classification
        """
        if not patterns:
            return {
                'risk_score': 0,
                'risk_level': 'LOW',
                'pattern_count': 0
            }
        
        # Severity weights
        severity_weights = {
            'HIGH': 30,
            'MEDIUM': 15,
            'LOW': 5
        }
        
        # Calculate weighted score
        total_score = sum(
            severity_weights.get(p['severity'], 0) 
            for p in patterns
        )
        
        # Normalize to 0-100
        risk_score = min(total_score, 100)
        
        # Classify
        if risk_score >= 60:
            risk_level = 'HIGH'
        elif risk_score >= 30:
            risk_level = 'MEDIUM'
        else:
            risk_level = 'LOW'
        
        return {
            'risk_score': risk_score,
            'risk_level': risk_level,
            'pattern_count': len(patterns),
            'high_severity_count': sum(1 for p in patterns if p['severity'] == 'HIGH'),
            'medium_severity_count': sum(1 for p in patterns if p['severity'] == 'MEDIUM')
        }
    
    def get_pattern_overlap(self, all_patterns: Dict[str, List[Dict]]) -> Dict:
        """
        Analyze pattern co-occurrence across accounts
        
        Args:
            all_patterns: Dict mapping account_id -> list of patterns
        
        Returns:
            Pattern overlap statistics
        """
        pattern_combos = {}
        
        for account_id, patterns in all_patterns.items():
            if len(patterns) < 2:
                continue
            
            pattern_ids = sorted([p['pattern_id'] for p in patterns])
            combo_key = ' + '.join(pattern_ids)
            
            if combo_key not in pattern_combos:
                pattern_combos[combo_key] = {
                    'patterns': pattern_ids,
                    'accounts': [],
                    'count': 0
                }
            
            pattern_combos[combo_key]['accounts'].append(account_id)
            pattern_combos[combo_key]['count'] += 1
        
        return pattern_combos
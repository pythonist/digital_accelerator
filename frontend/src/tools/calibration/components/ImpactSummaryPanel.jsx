import React, { useState,useEffect } from 'react';
import { AlertCircle, TrendingDown, Users, Building2, Activity } from 'lucide-react';

const ImpactSummaryPanel = ({ impact, entityOutcome, loading }) => {
  const [activeTab, setActiveTab] = useState(0);
  useEffect(() => {
    if (impact) {
      console.log('📊 Full Impact Object:', JSON.stringify(impact, null, 2));
      console.log('📊 Composition exists?', !!impact.composition);
      console.log('📊 Composition value:', impact.composition);
    }
  }, [impact]);
  if (loading) {
    return (
      <div className="border border-gray-200 rounded-lg bg-white">
        <div className="p-6">
          <div className="text-sm font-medium text-gray-600 mb-3">Impact Analysis</div>
          <div className="h-2 bg-gray-100 rounded overflow-hidden">
            <div className="h-full bg-gray-300 animate-pulse w-1/2"></div>
          </div>
        </div>
      </div>
    );
  }
  
  if (!impact) {
    return (
      <div className="border border-gray-200 rounded-lg bg-white">
        <div className="p-6">
          <div className="text-sm text-gray-500">
            Move the slider to see impact analysis
          </div>
        </div>
      </div>
    );
  }

  // Extract entity metrics
  const entityMetrics = entityOutcome?.summary || {};
  const hasEntityData = Object.keys(entityMetrics).length > 0;
  
  // Debug: Log what we're receiving
  console.log('Impact Data:', impact);
  console.log('Entity Outcome:', entityOutcome);
  console.log('Has Entity Data:', hasEntityData);
  
  return (
    <div className="border border-gray-200 rounded-lg bg-white shadow-sm">
      {/* Header Section */}
      <div className="border-b border-gray-200 bg-gray-50 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
              Projected Impact
            </div>
            <div className="flex items-baseline gap-3">
              <span className="text-4xl font-bold text-gray-900">
                {impact.alerts_triggered?.toLocaleString() || '0'}
              </span>
              <span className="text-sm text-gray-600">Alerts</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Confidence:</span>
            <span className={`px-3 py-1 text-xs font-semibold rounded ${
              impact.confidence?.level === 'HIGH' ? 'bg-green-50 text-green-800 border border-green-200' :
              impact.confidence?.level === 'MEDIUM' ? 'bg-amber-50 text-amber-800 border border-amber-200' : 
              'bg-gray-50 text-gray-600 border border-gray-200'
            }`}>
              {impact.confidence?.level || 'UNKNOWN'}
            </span>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Entity Impact Section */}
        {hasEntityData && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
            <div className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-4">
              Entity Impact
            </div>
            
            <div className="grid grid-cols-2 gap-4 mb-4">
              {/* Alerted Accounts */}
              <div className="bg-white rounded-lg p-4 border border-slate-200">
                <div className="flex items-center gap-2 mb-2">
                  <Building2 className="w-4 h-4 text-slate-500" />
                  <span className="text-xs font-medium text-slate-600">Alerted Accounts</span>
                </div>
                <div className="text-2xl font-bold text-slate-900 mb-1">
                  {entityMetrics.alerted_accounts?.toLocaleString() || '0'}
                </div>
                <div className="text-xs text-slate-500">
                  {entityMetrics.pct_accounts_impacted || 0}% of total accounts
                </div>
              </div>

              {/* Alerted Customers */}
              <div className="bg-white rounded-lg p-4 border border-slate-200">
                <div className="flex items-center gap-2 mb-2">
                  <Users className="w-4 h-4 text-slate-500" />
                  <span className="text-xs font-medium text-slate-600">Alerted Customers</span>
                </div>
                <div className="text-2xl font-bold text-slate-900 mb-1">
                  {entityMetrics.alerted_customers?.toLocaleString() || '0'}
                </div>
                <div className="text-xs text-slate-500">
                  {entityMetrics.pct_customers_impacted || 0}% of total customers
                </div>
              </div>
            </div>

            {/* Suppression Rate */}
            <div className="bg-white rounded-lg p-4 border border-slate-200 mb-3">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-medium text-slate-600">Suppression Rate</span>
                <span className="text-lg font-bold text-green-700">
                  {entityMetrics.suppression_pct || impact.suppression_pct || 0}%
                </span>
              </div>
              <div className="text-xs text-slate-500">
                {entityMetrics.suppressed_count?.toLocaleString() || '0'} entities filtered out
              </div>
            </div>

            {/* Near Miss */}
            {entityMetrics.near_miss_count > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-medium text-amber-900">Near Miss (10% band)</span>
                  <span className="text-lg font-bold text-amber-800">
                    {entityMetrics.near_miss_count?.toLocaleString() || '0'}
                  </span>
                </div>
                <div className="text-xs text-amber-700">
                  {entityMetrics.near_miss_pct || 0}% within threshold proximity
                </div>
              </div>
            )}
          </div>
        )}

        {/* Legacy Near Miss Alert */}
        {!hasEntityData && impact.near_miss && impact.near_miss.entity_count > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-semibold text-amber-900 mb-1">
                  Near Miss ({impact.near_miss.band_pct}% Band)
                </div>
                <div className="text-sm text-amber-800">
                  {impact.near_miss.entity_count?.toLocaleString() || 0} entities are within{' '}
                  {impact.near_miss.band_pct}% of this threshold (₹
                  {impact.near_miss.lower_bound?.toLocaleString()} - ₹
                  {impact.near_miss.upper_bound?.toLocaleString()})
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Concentration Warning */}
        {impact.concentration?.warning && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-semibold text-red-900 mb-1">Concentration Risk</div>
                <div className="text-sm text-red-800">{impact.concentration.message}</div>
              </div>
            </div>
          </div>
        )}
        
        {/* Population Coverage */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-medium text-gray-700">Population Coverage</span>
            <span className="text-xs text-gray-500">{impact.pct_population || 0}% Flagged</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div 
              className="h-full bg-slate-600 transition-all duration-300"
              style={{ width: `${impact.pct_population || 0}%` }}
            ></div>
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-xs text-gray-400">0%</span>
            <span className="text-xs text-gray-400">100%</span>
          </div>
        </div>
        
        {/* Sensitivity Indicator */}
        {impact.sensitivity && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Activity className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-semibold text-blue-900 mb-2">
                  Decision Sensitivity: {impact.sensitivity.stability}
                </div>
                <div className="text-sm text-blue-800">
                  At this range, a <strong>1-percentile shift</strong> changes{' '}
                  <strong>~{impact.sensitivity.alerts_per_1pct} alerts</strong>.
                  Per ₹1000 currency shift: <strong>~{impact.sensitivity.alerts_per_1000_currency} alerts</strong>.
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Tabs */}
        <div className="border-t border-gray-200 -mx-6 px-6 pt-6">
          <div className="flex border-b border-gray-200 mb-6">
            {['Composition', 'Temporal', 'Confidence'].map((tab, idx) => (
              <button
                key={tab}
                onClick={() => setActiveTab(idx)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === idx
                    ? 'border-slate-700 text-slate-900'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
          
          <div className="min-h-[200px]">
            {activeTab === 0 && <CompositionView composition={impact.composition} />}
            {activeTab === 1 && <TemporalView temporal={impact.temporal} />}
            {activeTab === 2 && <ConfidenceView confidence={impact.confidence} />}
          </div>
        </div>

        {/* Footer Note */}
        {hasEntityData && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 -mb-2">
            <div className="text-sm text-blue-900">
              <strong>💡 Entity metrics</strong> show actual accounts and customers impacted.
              Use the "Alert Population" table below to see specific entity IDs for audit defense.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Composition View Component
const CompositionView = ({ composition }) => {
  console.log('Composition data:', composition);
  
  if (!composition || composition.note) {
    return (
      <div className="text-sm text-gray-500 py-8 text-center">
        {composition?.note || 'No composition data available (enable customer_type, risk_rating fields)'}
      </div>
    );
  }
  
  const renderBreakdown = (title, data, Icon) => {
    if (!data || Object.keys(data).length === 0) return null;
    
    const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
    
    return (
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Icon className="w-4 h-4 text-gray-600" />
          <span className="text-sm font-semibold text-gray-900">{title}</span>
        </div>
        <div className="space-y-3">
          {entries.map(([key, val]) => (
            <div key={key}>
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm text-gray-700">{key}</span>
                <span className="text-sm font-semibold text-gray-900">{val.toFixed(1)}%</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-slate-600 transition-all duration-300"
                  style={{ width: `${val}%` }}
                ></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };
  
  return (
    <div>
      <div className="text-sm text-gray-600 mb-4">
        Risk composition of alerting population:
      </div>
      
      {renderBreakdown('By Customer Type', composition.by_customer_type, Users)}
      {renderBreakdown('By Risk Rating', composition.by_risk_rating, AlertCircle)}
      {renderBreakdown('By Account Type', composition.by_account_type, Building2)}
      {renderBreakdown('By Geography', composition.by_geography, TrendingDown)}
      
      {!composition.by_customer_type && !composition.by_risk_rating && 
       !composition.by_account_type && !composition.by_geography && (
        <div className="text-sm text-gray-500 py-8 text-center">
          No composition dimensions available in the data
        </div>
      )}
    </div>
  );
};

// Temporal View Component
const TemporalView = ({ temporal }) => {
  console.log('Temporal data:', temporal);
  
  if (!temporal || temporal.note) {
    return (
      <div className="text-sm text-gray-500 py-8 text-center">
        {temporal?.note || 'Temporal analysis unavailable'}
      </div>
    );
  }
  
  const chartData = (temporal.daily_alerts || []).slice(-30);
  
  return (
    <div>
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <div className="text-xs text-gray-600 mb-1">Avg Monthly Alerts</div>
          <div className="text-2xl font-bold text-gray-900">
            {temporal.avg_monthly_alerts?.toLocaleString() || '0'}
          </div>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <div className="text-xs text-gray-600 mb-1">Volatility</div>
          <div className="text-2xl font-bold text-gray-900">
            {temporal.volatility_score?.toFixed(2) || 'N/A'}
          </div>
          <span className={`inline-block px-2 py-0.5 text-xs font-semibold rounded mt-1 ${
            temporal.stability === 'STABLE' 
              ? 'bg-green-50 text-green-800 border border-green-200' 
              : 'bg-amber-50 text-amber-800 border border-amber-200'
          }`}>
            {temporal.stability || 'UNKNOWN'}
          </span>
        </div>
      </div>
      
      {chartData.length > 0 && (
        <div className="mb-6">
          <div className="text-sm font-semibold text-gray-900 mb-3">
            Daily Alert Pattern (Last 30 Days)
          </div>
          <div className="h-40 bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-center">
            <div className="text-sm text-gray-500">
              Chart visualization: {chartData.length} data points
            </div>
          </div>
        </div>
      )}
      
      {temporal.spike_days && temporal.spike_days.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
          <div className="text-sm font-semibold text-amber-900 mb-1">Spike Days Detected</div>
          <div className="text-sm text-amber-800">{temporal.spike_days.join(', ')}</div>
        </div>
      )}
      
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <div className="text-sm text-gray-700">
          <strong>Operational Impact:</strong> This threshold will generate approximately{' '}
          <strong>{temporal.avg_monthly_alerts?.toLocaleString()}</strong> alerts per month.{' '}
          {temporal.stability === 'STABLE' 
            ? 'Alert volume is stable over time.'
            : 'Alert volume shows significant day-to-day variation.'
          }
        </div>
      </div>
    </div>
  );
};

// Confidence View Component
const ConfidenceView = ({ confidence }) => {
  console.log('Confidence data:', confidence);
  
  if (!confidence) {
    return (
      <div className="text-sm text-gray-500 py-8 text-center">
        Confidence assessment unavailable
      </div>
    );
  }
  
  const getConfidenceColor = (level) => {
    switch (level) {
      case 'HIGH': return 'bg-green-50 text-green-800 border-green-200';
      case 'MEDIUM': return 'bg-amber-50 text-amber-800 border-amber-200';
      case 'LOW': return 'bg-red-50 text-red-800 border-red-200';
      default: return 'bg-gray-50 text-gray-600 border-gray-200';
    }
  };
  
  const getFactorColor = (factor) => {
    if (factor.includes('EXCELLENT') || factor.includes('ADEQUATE') || factor.includes('STABLE')) {
      return 'bg-green-50 text-green-800 border-green-200';
    }
    if (factor.includes('MODERATE') || factor.includes('LIMITED')) {
      return 'bg-amber-50 text-amber-800 border-amber-200';
    }
    return 'bg-red-50 text-red-800 border-red-200';
  };
  
  return (
    <div>
      <div className="text-center mb-6">
        <div className="text-xs text-gray-600 mb-2">Calibration Confidence</div>
        <span className={`inline-block px-6 py-2 text-lg font-bold border rounded-lg ${getConfidenceColor(confidence.level)}`}>
          {confidence.level}
        </span>
      </div>
      
      <div className="text-sm font-semibold text-gray-900 mb-3">Confidence Factors:</div>
      
      <div className="space-y-3 mb-6">
        {Object.entries(confidence.factors || {}).map(([key, value]) => (
          <div key={key} className="flex justify-between items-center">
            <span className="text-sm text-gray-700 capitalize">
              {key.replace(/_/g, ' ')}
            </span>
            <span className={`px-3 py-1 text-xs font-semibold border rounded ${getFactorColor(value)}`}>
              {value}
            </span>
          </div>
        ))}
      </div>
      
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="text-sm text-blue-900">
          <strong>What this means:</strong>{' '}
          {confidence.level === 'HIGH' && 
            'This calibration is based on adequate sample size and stable distribution characteristics. You can proceed with high confidence.'
          }
          {confidence.level === 'MEDIUM' && 
            'This calibration has some limitations but is generally reliable. Review the factors above and consider additional validation if needed.'
          }
          {confidence.level === 'LOW' && 
            'This calibration may be unreliable due to limited data or unstable distribution. Consider collecting more data or adjusting your population filters.'
          }
        </div>
      </div>
    </div>
  );
};

export default ImpactSummaryPanel;
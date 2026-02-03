// frontend/src/tools/calibration/components/CustomerImpactPanel.jsx

import React, { useState, useEffect } from 'react';
import { Users, TrendingUp, AlertCircle } from 'lucide-react';
import apiClient from '@services/api';

const CustomerImpactPanel = ({ runId, threshold, metric = 'amount' }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (runId && threshold) {
      loadCustomerImpact();
    }
  }, [runId, threshold]);

  const loadCustomerImpact = async () => {
    setLoading(true);
    try {
      const res = await apiClient.post(
        `/api/v2/calibration/percentile/${runId}/customer-impact`,
        { threshold, metric }
      );
      
      console.log('✅ Customer impact loaded:', res);
      setData(res);
    } catch (err) {
      console.error('❌ Failed to load customer impact:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="border border-gray-200 rounded-lg bg-white p-6">
        <div className="h-2 bg-gray-100 rounded overflow-hidden">
          <div className="h-full bg-gray-300 animate-pulse w-1/2"></div>
        </div>
      </div>
    );
  }

  if (!data || data.note) {
    return (
      <div className="border border-gray-200 rounded-lg bg-white p-6">
        <div className="text-sm text-gray-500">
          {data?.note || 'Move the slider to see customer impact'}
        </div>
      </div>
    );
  }

  const { distribution, top_customers } = data;

  return (
    <div className="border border-gray-200 rounded-lg bg-white shadow-sm">
      {/* Header */}
      <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-gray-600" />
          <span className="text-sm font-semibold text-gray-900">Customer Impact</span>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Summary Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <div className="text-xs text-blue-600 mb-1">Total Customers</div>
            <div className="text-2xl font-bold text-blue-900">
              {data.total_customers?.toLocaleString() || '0'}
            </div>
          </div>
          
          <div className="bg-red-50 border border-red-200 rounded-lg p-3">
            <div className="text-xs text-red-600 mb-1">Alerted Customers</div>
            <div className="text-2xl font-bold text-red-900">
              {data.alerted_customers?.toLocaleString() || '0'}
            </div>
            <div className="text-xs text-red-700 mt-1">
              {data.pct_customers_impacted || 0}% impacted
            </div>
          </div>
        </div>

        {/* Distribution */}
        <div>
          <div className="text-xs font-semibold text-gray-700 mb-3">
            Account Distribution per Customer
          </div>
          
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Single Account</span>
              <span className="text-sm font-semibold text-gray-900">
                {distribution?.single_account || 0}
              </span>
            </div>
            
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Two Accounts</span>
              <span className="text-sm font-semibold text-gray-900">
                {distribution?.two_accounts || 0}
              </span>
            </div>
            
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">3+ Accounts</span>
              <span className="text-sm font-semibold text-gray-900">
                {distribution?.three_plus_accounts || 0}
              </span>
            </div>
          </div>
        </div>

        {/* Top Customers */}
        {top_customers && top_customers.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-gray-700 mb-3">
              Top 5 Customers by Exposure
            </div>
            
            <div className="space-y-2">
              {top_customers.slice(0, 5).map((customer, idx) => (
                <div key={idx} className="flex justify-between items-center text-xs">
                  <span className="text-gray-600 font-mono">
                    {customer.customer_id.substring(0, 12)}...
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500">
                      {customer.account_count} acct{customer.account_count > 1 ? 's' : ''}
                    </span>
                    <span className="font-semibold text-gray-900">
                      ₹{customer.total_exposure?.toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer Note */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="text-xs text-blue-900">
            <strong>💡 Insight:</strong> This analysis groups alerted accounts by customer,
            helping identify concentrated risk exposure across customer relationships.
          </div>
        </div>
      </div>
    </div>
  );
};

export default CustomerImpactPanel;
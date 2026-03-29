import React from 'react';
import {
  Box,
  Chip,
  Paper,
  Stack,
  Typography,
} from '@mui/material';

import { formatAmount, formatPercent, formatRisk } from './retrievalCompareUtils';

const MetricCard = ({ title, body }) => (
  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5 }}>
    <Typography sx={{ fontSize: 12, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>
      {title}
    </Typography>
    <Typography sx={{ mt: 0.8, fontSize: 13.25, color: '#334155', lineHeight: 1.7 }}>
      {body}
    </Typography>
  </Paper>
);

const DetailedCompareView = ({ data }) => {
  const [caseA, caseB] = data.comparison_pair || [];
  const riskA = data.risk_alert_profile?.[caseA] || {};
  const riskB = data.risk_alert_profile?.[caseB] || {};
  const txnA = data.transaction_behavior?.[caseA] || {};
  const txnB = data.transaction_behavior?.[caseB] || {};

  return (
    <Stack spacing={2.25}>
      <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 2.5, borderColor: '#bfdbfe', backgroundColor: '#eff6ff' }}>
        <Typography sx={{ fontSize: 12, fontWeight: 800, color: '#1d4ed8', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Executive Summary
        </Typography>
        <Typography sx={{ mt: 0.85, fontSize: 13.5, color: '#1e293b', lineHeight: 1.8 }}>
          {data.executive_summary}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap>
          <Chip label={`Overall ${formatPercent(data.overall_similarity)}`} size="small" color="primary" />
          <Chip label={`Behavioral ${formatPercent(data.component_scores?.behavioral)}`} size="small" variant="outlined" />
          <Chip label={`Typology ${formatPercent(data.component_scores?.typology)}`} size="small" variant="outlined" />
          <Chip label={`Network ${formatPercent(data.component_scores?.network)}`} size="small" variant="outlined" />
        </Stack>
      </Paper>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'repeat(3, 1fr)' }, gap: 2 }}>
        <MetricCard title="Shared Indicators" body={(data.shared_indicators || []).join(' ') || 'No strong shared indicators were identified.'} />
        <MetricCard title="Key Differences" body={(data.key_differences || []).join(' ') || 'No material differences were highlighted.'} />
        <MetricCard title="AI Comparative Insight" body={data.ai_comparative_insight || 'Comparative insight is not available.'} />
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' }, gap: 2 }}>
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5 }}>
          <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: '#0f172a' }}>{caseA}</Typography>
          <Typography sx={{ mt: 1, fontSize: 12.5, color: '#334155', lineHeight: 1.8 }}>
            Risk {formatRisk(riskA.risk_score)} | {riskA.severity || '-'} | Alert family {riskA.dominant_alert_family || '-'} | Typology {riskA.dominant_typology || '-'}
          </Typography>
          <Typography sx={{ mt: 1, fontSize: 12.5, color: '#334155', lineHeight: 1.8 }}>
            Transactions {txnA.suspicious_txn_count || 0} | Total value {formatAmount(txnA.total_suspicious_amount || 0)} | Off-hours {formatPercent(txnA.off_hours_ratio || 0)}
          </Typography>
        </Paper>
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5 }}>
          <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: '#0f172a' }}>{caseB}</Typography>
          <Typography sx={{ mt: 1, fontSize: 12.5, color: '#334155', lineHeight: 1.8 }}>
            Risk {formatRisk(riskB.risk_score)} | {riskB.severity || '-'} | Alert family {riskB.dominant_alert_family || '-'} | Typology {riskB.dominant_typology || '-'}
          </Typography>
          <Typography sx={{ mt: 1, fontSize: 12.5, color: '#334155', lineHeight: 1.8 }}>
            Transactions {txnB.suspicious_txn_count || 0} | Total value {formatAmount(txnB.total_suspicious_amount || 0)} | Off-hours {formatPercent(txnB.off_hours_ratio || 0)}
          </Typography>
        </Paper>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'repeat(3, 1fr)' }, gap: 2 }}>
        <MetricCard title="Counterparty and Beneficiary Comparison" body={`${caseA}: ${(data.counterparty_comparison?.[caseA] || []).map((item) => item.name).join(', ') || '-'} \n${caseB}: ${(data.counterparty_comparison?.[caseB] || []).map((item) => item.name).join(', ') || '-'}`} />
        <MetricCard title="Typology Footprint Comparison" body={`${caseA}: ${JSON.stringify(data.typology_footprint?.[caseA] || {})}\n${caseB}: ${JSON.stringify(data.typology_footprint?.[caseB] || {})}`} />
        <MetricCard title="Resolution Outcome Comparison" body={`${caseA}: ${data.outcome_comparison?.base_case || '-'}\n${caseB}: ${data.outcome_comparison?.matched_case || '-'}`} />
      </Box>
    </Stack>
  );
};

export default DetailedCompareView;

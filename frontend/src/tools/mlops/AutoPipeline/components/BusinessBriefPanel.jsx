import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import {
  AutoAwesome,
  ChecklistRounded,
  HelpOutline,
  Insights,
} from '@mui/icons-material';
import mlopsApi from '../../services/mlopsApi';
import { FCC_THEME } from '../../theme/fccWorkbenchTheme';

const C = {
  orange: FCC_THEME.accent,
  orangeSoft: FCC_THEME.accentSoft,
  dark: FCC_THEME.text,
  slate: FCC_THEME.textMuted,
  border: FCC_THEME.border,
  bg: FCC_THEME.panel,
  muted: FCC_THEME.textSoft,
};

const GOAL_LABELS = {
  catch_most: 'Catch as many real cases as possible',
  balanced: 'Balance detection with analyst workload',
  minimize_false_alarms: 'Reduce false alarms first',
};

const pick = (res) => {
  const level1 = res?.data ?? res;
  return level1?.data ?? level1;
};

const fmtInt = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num.toLocaleString() : '-';
};

const fmtPct = (value, digits = 1) => {
  const num = Number(value);
  return Number.isFinite(num) ? `${num.toFixed(digits)}%` : '-';
};

const LabelChip = ({ label }) => (
  <Chip
    size="small"
    label={label}
    sx={{
      height: 22,
      fontSize: 10.5,
      fontWeight: 700,
      bgcolor: FCC_THEME.panelAlt,
      color: FCC_THEME.textMuted,
      border: `1px solid ${C.border}`,
    }}
  />
);

const SectionBlock = ({ icon: Icon, title, items = [] }) => {
  if (!items.length) return null;
  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: C.border, bgcolor: C.bg }}>
      <Box sx={{ px: 1.75, py: 1.2, borderBottom: `1px solid ${C.border}` }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Icon sx={{ fontSize: 16, color: C.orange }} />
          <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: C.dark }}>{title}</Typography>
        </Stack>
      </Box>
      <Box sx={{ px: 1.75, py: 1.4 }}>
        <Stack spacing={1}>
          {items.map((item) => (
            <Box key={`${title}_${item}`} sx={{ display: 'flex', gap: 1 }}>
              <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: C.orange, mt: '7px', flexShrink: 0 }} />
              <Typography sx={{ fontSize: 11.5, color: C.slate, lineHeight: 1.55 }}>{item}</Typography>
            </Box>
          ))}
        </Stack>
      </Box>
    </Paper>
  );
};

const DatasetCard = ({ dataset }) => (
  <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: C.border, bgcolor: C.bg }}>
    <Box sx={{ px: 1.75, py: 1.25, borderBottom: `1px solid ${C.border}` }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
        <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: C.dark }}>
          {String(dataset?.dataset_type || 'dataset').replace(/_/g, ' ')}
        </Typography>
        <LabelChip label={`${fmtInt(dataset?.rows)} rows`} />
      </Stack>
    </Box>
    <Box sx={{ px: 1.75, py: 1.4 }}>
      <Typography sx={{ fontSize: 11.5, color: C.slate, lineHeight: 1.6, mb: 1.2 }}>
        {dataset?.business_narrative || 'No summary available for this source.'}
      </Typography>
      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
        {dataset?.quality_score != null ? <LabelChip label={`Quality ${Math.round(dataset.quality_score)}/100`} /> : null}
        {dataset?.coverage_pct != null ? <LabelChip label={`Coverage ${fmtPct(dataset.coverage_pct, 0)}`} /> : null}
        {dataset?.flag_rate != null ? <LabelChip label={`Flagged ${fmtPct(Number(dataset.flag_rate) * 100, 1)}`} /> : null}
        {dataset?.data_freshness_days != null ? <LabelChip label={`${fmtInt(dataset.data_freshness_days)} days old`} /> : null}
      </Stack>
      {Array.isArray(dataset?.signals) && dataset.signals.length > 0 ? (
        <Stack spacing={0.75} sx={{ mt: 1.3 }}>
          {dataset.signals.slice(0, 3).map((signal) => (
            <Typography key={`${dataset.dataset_type}_${signal}`} sx={{ fontSize: 10.75, color: C.slate, lineHeight: 1.5 }}>
              {signal}
            </Typography>
          ))}
        </Stack>
      ) : null}
    </Box>
  </Paper>
);

const BusinessBriefPanel = ({ selectedDatasets = [], targetColumn = '', goal = 'balanced' }) => {
  const [brief, setBrief] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const datasetIds = useMemo(
    () => selectedDatasets.map((dataset) => Number(dataset?.dataset_id)).filter((value) => Number.isFinite(value) && value > 0),
    [selectedDatasets],
  );

  useEffect(() => {
    let active = true;

    if (!datasetIds.length) {
      setBrief(null);
      setError('');
      setLoading(false);
      return () => { active = false; };
    }

    const loadBrief = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await mlopsApi.businessBrief({
          dataset_ids: datasetIds,
          target_column: targetColumn,
          goal,
        });
        if (!active) return;
        setBrief(pick(res));
      } catch (err) {
        if (!active) return;
        setBrief(null);
        setError(err?.response?.data?.error || err?.message || 'Failed to build the business brief.');
      } finally {
        if (active) setLoading(false);
      }
    };

    loadBrief();
    return () => { active = false; };
  }, [datasetIds, targetColumn, goal]);

  if (!datasetIds.length) {
    return (
      <Paper variant="outlined" sx={{ borderRadius: 2.5, borderColor: C.border, bgcolor: C.bg, mb: 1.5 }}>
        <Box sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${C.border}` }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Insights sx={{ fontSize: 18, color: C.orange }} />
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: C.dark }}>
              Business Readout
            </Typography>
          </Stack>
        </Box>
        <Box sx={{ px: 2, py: 2 }}>
          <Typography sx={{ fontSize: 11.5, color: C.slate, lineHeight: 1.65 }}>
            Select one or more data sources to see what the platform can tell a business user before any model is built.
          </Typography>
        </Box>
      </Paper>
    );
  }

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2.5, borderColor: C.border, bgcolor: C.bg, mb: 1.5 }}>
      <Box sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${C.border}` }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Insights sx={{ fontSize: 18, color: C.orange }} />
            <Box>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: C.dark }}>
                {brief?.llm_available ? 'AI Business Brief' : 'Business Readout'}
              </Typography>
              <Typography sx={{ fontSize: 10.5, color: C.muted }}>
                Plain-language interpretation for business users
              </Typography>
            </Box>
          </Stack>
          <LabelChip label={GOAL_LABELS[goal] || GOAL_LABELS.balanced} />
        </Stack>
      </Box>

      <Box sx={{ px: 2, py: 2 }}>
        {loading ? (
          <Stack spacing={1.5} alignItems="center" sx={{ py: 3 }}>
            <CircularProgress size={26} sx={{ color: C.orange }} />
            <Typography sx={{ fontSize: 11.5, color: C.slate }}>
              Building a business-facing summary from the selected data.
            </Typography>
          </Stack>
        ) : error ? (
          <Alert severity="warning" sx={{ borderRadius: 2 }}>{error}</Alert>
        ) : brief ? (
          <Stack spacing={1.75}>
            <Typography sx={{ fontSize: 12.5, color: C.dark, fontWeight: 700 }}>
              {brief.executive_summary}
            </Typography>

            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
              <LabelChip label={`${fmtInt(brief?.combined_snapshot?.dataset_count)} sources`} />
              <LabelChip label={`${fmtInt(brief?.combined_snapshot?.total_rows)} rows`} />
              {brief?.combined_snapshot?.total_entities != null ? (
                <LabelChip label={`${fmtInt(brief.combined_snapshot.total_entities)} entities`} />
              ) : null}
              {brief?.combined_snapshot?.avg_coverage_pct != null ? (
                <LabelChip label={`Coverage ${fmtPct(brief.combined_snapshot.avg_coverage_pct, 0)}`} />
              ) : null}
              {brief?.combined_snapshot?.avg_flag_rate != null ? (
                <LabelChip label={`Flagged ${fmtPct(Number(brief.combined_snapshot.avg_flag_rate) * 100, 1)}`} />
              ) : null}
              {brief?.combined_snapshot?.freshest_data_days != null ? (
                <LabelChip label={`${fmtInt(brief.combined_snapshot.freshest_data_days)} days old`} />
              ) : null}
              {targetColumn ? <LabelChip label={`Outcome ${targetColumn}`} /> : null}
              {brief?.ai_model ? <LabelChip label={`Model ${brief.ai_model}`} /> : null}
            </Stack>

            <SectionBlock icon={AutoAwesome} title="What stands out" items={brief.what_stands_out || []} />
            <SectionBlock icon={ChecklistRounded} title="Recommended next steps" items={brief.recommended_actions || []} />
            <SectionBlock icon={HelpOutline} title="Questions to settle before building" items={brief.questions_to_answer || []} />

            <Stack spacing={1}>
              <Typography sx={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Source By Source View
              </Typography>
              <Box sx={{ display: 'grid', gap: 1.25, gridTemplateColumns: { xs: '1fr', xl: 'repeat(2, minmax(0, 1fr))' } }}>
                {(brief.datasets || []).map((dataset) => (
                  <DatasetCard key={dataset.dataset_id || dataset.dataset_type} dataset={dataset} />
                ))}
              </Box>
            </Stack>
          </Stack>
        ) : null}
      </Box>
    </Paper>
  );
};

export default BusinessBriefPanel;

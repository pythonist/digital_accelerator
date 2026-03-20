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
  AnalyticsOutlined,
  FactCheckOutlined,
  TableChartOutlined,
} from '@mui/icons-material';
import mlopsApi from '../../services/mlopsApi';
import { FCC_THEME } from '../../theme/fccWorkbenchTheme';

const pick = (res) => {
  const level1 = res?.data ?? res;
  return level1?.data ?? level1;
};

const fmtInt = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num.toLocaleString() : '-';
};

const fmtPct = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? `${num.toFixed(1)}%` : '-';
};

const DetailChip = ({ label, tone = 'neutral' }) => {
  const toneMap = {
    neutral: { bg: FCC_THEME.panelAlt, border: FCC_THEME.border, color: FCC_THEME.textMuted },
    warn: { bg: FCC_THEME.warningBg, border: FCC_THEME.warningBorder, color: FCC_THEME.warning },
    good: { bg: FCC_THEME.successBg, border: FCC_THEME.successBorder, color: FCC_THEME.success },
    accent: { bg: FCC_THEME.accentSoft, border: FCC_THEME.accentBorder, color: FCC_THEME.accent },
  };
  const palette = toneMap[tone] || toneMap.neutral;
  return (
    <Chip
      size="small"
      label={label}
      sx={{
        height: 22,
        fontSize: 10.25,
        fontWeight: 700,
        bgcolor: palette.bg,
        color: palette.color,
        border: `1px solid ${palette.border}`,
      }}
    />
  );
};

function datasetBusinessSummary(entry, targetColumn) {
  const quality = Number(entry?.quality?.overall_score ?? entry?.profile?.quality_score ?? 0);
  const missing = Number(entry?.quality?.missing_pct ?? 0);
  const duplicate = Number(entry?.quality?.duplicate_pct ?? 0);
  const joinKeys = entry?.schema?.join_key_candidates || [];
  const targetCandidates = (entry?.profile?.target_candidates || []).map((row) => row?.name).filter(Boolean);
  const parts = [];

  if (entry?.profile?.business_narrative) parts.push(entry.profile.business_narrative);
  if (quality) parts.push(`overall quality is ${Math.round(quality)}/100`);
  if (missing > 5) parts.push(`missing data is noticeable at ${missing.toFixed(1)}%`);
  if (duplicate > 1) parts.push(`duplicates are present at ${duplicate.toFixed(1)}%`);
  if (joinKeys.length) parts.push(`join-ready keys include ${joinKeys.slice(0, 3).join(', ')}`);
  if (targetColumn) {
    const hasTarget = targetCandidates.some((candidate) => String(candidate).toLowerCase() === String(targetColumn).toLowerCase());
    parts.push(hasTarget ? `the selected outcome is visible in this source` : `the selected outcome is not obvious in this source`);
  }

  return parts.length
    ? parts.join('. ') + '.'
    : 'This source is loaded, but more profiling detail is needed before moving into dataset building.';
}

export default function DataUnderstandingPanel({ selectedDatasets = [], targetColumn = '' }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    if (!selectedDatasets.length) {
      setRows([]);
      setLoading(false);
      setError('');
      return () => { active = false; };
    }

    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const results = await Promise.all(selectedDatasets.map(async (dataset) => {
          const datasetId = Number(dataset?.dataset_id);
          const [profileRes, qualityRes, schemaRes] = await Promise.allSettled([
            mlopsApi.profileMetadata({ dataset_id: datasetId, sample_rows: 12000 }),
            mlopsApi.qualityScore({ dataset_id: datasetId, target_column: targetColumn || '', sample_rows: 12000 }),
            mlopsApi.schemaPreview({ dataset_id: datasetId, limit: 12 }),
          ]);
          return {
            dataset,
            profile: profileRes.status === 'fulfilled' ? pick(profileRes.value) : null,
            quality: qualityRes.status === 'fulfilled' ? pick(qualityRes.value) : null,
            schema: schemaRes.status === 'fulfilled' ? pick(schemaRes.value) : null,
          };
        }));
        if (!active) return;
        setRows(results);
      } catch (err) {
        if (!active) return;
        setError(err?.response?.data?.error || err?.message || 'Failed to profile the selected datasets.');
      } finally {
        if (active) setLoading(false);
      }
    };

    load();
    return () => { active = false; };
  }, [selectedDatasets, targetColumn]);

  const overall = useMemo(() => {
    const qualityScores = rows.map((entry) => Number(entry?.quality?.overall_score ?? entry?.profile?.quality_score)).filter((value) => Number.isFinite(value));
    const avgQuality = qualityScores.length ? Math.round(qualityScores.reduce((sum, value) => sum + value, 0) / qualityScores.length) : null;
    const totalRows = rows.reduce((sum, entry) => sum + (Number(entry?.dataset?.row_count) || 0), 0);
    const joinKeys = Array.from(new Set(rows.flatMap((entry) => entry?.schema?.join_key_candidates || [])));
    const highMissing = rows.reduce((sum, entry) => sum + ((entry?.profile?.high_missing_columns || []).length), 0);
    const targetVisible = rows.some((entry) =>
      (entry?.profile?.target_candidates || []).some((candidate) => String(candidate?.name || '').toLowerCase() === String(targetColumn || '').toLowerCase()),
    );

    const lines = [];
    if (totalRows) lines.push(`The selected sources currently cover about ${fmtInt(totalRows)} rows of business activity.`);
    if (avgQuality != null) {
      lines.push(
        avgQuality >= 80
          ? `Overall data quality looks strong at about ${avgQuality}/100.`
          : `Overall data quality is about ${avgQuality}/100, so the team should review gaps before relying on model output.`,
      );
    }
    if (highMissing > 0) lines.push(`Several columns are sparse or incomplete and may need treatment before modeling.`);
    if (joinKeys.length > 0) lines.push(`Likely join keys were found, including ${joinKeys.slice(0, 4).join(', ')}.`);
    if (targetColumn) {
      lines.push(
        targetVisible
          ? `The chosen outcome column appears in at least one selected source.`
          : `The chosen outcome column is not obvious in the selected source summaries yet.`,
      );
    }

    return {
      avgQuality,
      totalRows,
      joinKeys,
      highMissing,
      targetVisible,
      lines,
    };
  }, [rows, targetColumn]);

  if (!selectedDatasets.length) {
    return (
      <Paper variant="outlined" sx={{ borderRadius: 2.5, borderColor: FCC_THEME.border, bgcolor: FCC_THEME.panelAlt }}>
        <Box sx={{ px: 2, py: 2 }}>
          <Typography sx={{ fontSize: 12, color: FCC_THEME.textMuted, lineHeight: 1.6 }}>
            Select at least one source in Load Data to unlock the data understanding and quality review.
          </Typography>
        </Box>
      </Paper>
    );
  }

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ borderRadius: 2.5, borderColor: FCC_THEME.border, bgcolor: FCC_THEME.panel }}>
        <Box sx={{ px: 2, py: 1.75, borderBottom: `1px solid ${FCC_THEME.border}` }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <AnalyticsOutlined sx={{ fontSize: 18, color: FCC_THEME.accent }} />
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: FCC_THEME.text }}>
              Data Understanding And Quality
            </Typography>
          </Stack>
        </Box>
        <Box sx={{ px: 2, py: 2 }}>
          {loading ? (
            <Stack spacing={1.25} alignItems="center" sx={{ py: 3 }}>
              <CircularProgress size={26} sx={{ color: FCC_THEME.accent }} />
              <Typography sx={{ fontSize: 11.5, color: FCC_THEME.textMuted }}>
                Profiling the selected sources and preparing a business-facing summary.
              </Typography>
            </Stack>
          ) : error ? (
            <Alert severity="warning" sx={{ borderRadius: 2 }}>{error}</Alert>
          ) : (
            <Stack spacing={1.5}>
              {overall.lines.map((line) => (
                <Typography key={line} sx={{ fontSize: 11.75, color: FCC_THEME.textMuted, lineHeight: 1.6 }}>
                  {line}
                </Typography>
              ))}

              <Stack direction="row" spacing={0.8} flexWrap="wrap" useFlexGap>
                {overall.avgQuality != null ? <DetailChip label={`Average quality ${overall.avgQuality}/100`} tone={overall.avgQuality >= 80 ? 'good' : 'warn'} /> : null}
                <DetailChip label={`${fmtInt(overall.totalRows)} total rows`} tone="accent" />
                <DetailChip label={`${fmtInt(overall.joinKeys.length)} join-ready keys`} tone={overall.joinKeys.length ? 'good' : 'warn'} />
                <DetailChip label={`${fmtInt(overall.highMissing)} high-missing columns`} tone={overall.highMissing ? 'warn' : 'good'} />
                {targetColumn ? <DetailChip label={overall.targetVisible ? `Outcome ${targetColumn} found` : `Outcome ${targetColumn} needs review`} tone={overall.targetVisible ? 'good' : 'warn'} /> : null}
              </Stack>
            </Stack>
          )}
        </Box>
      </Paper>

      {!loading && !error && rows.map((entry) => {
        const quality = Number(entry?.quality?.overall_score ?? entry?.profile?.quality_score ?? 0);
        const missing = Number(entry?.quality?.missing_pct ?? 0);
        const duplicate = Number(entry?.quality?.duplicate_pct ?? 0);
        const joinKeys = entry?.schema?.join_key_candidates || [];
        const highMissingColumns = (entry?.profile?.high_missing_columns || []).slice(0, 5);
        const targetCandidates = (entry?.profile?.target_candidates || []).slice(0, 4).map((candidate) => candidate?.name).filter(Boolean);

        return (
          <Paper key={entry?.dataset?.dataset_id} variant="outlined" sx={{ borderRadius: 2.5, borderColor: FCC_THEME.border, bgcolor: FCC_THEME.panel }}>
            <Box sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${FCC_THEME.border}` }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <TableChartOutlined sx={{ fontSize: 17, color: FCC_THEME.accent }} />
                  <Box>
                    <Typography sx={{ fontSize: 12.25, fontWeight: 700, color: FCC_THEME.text }}>
                      {String(entry?.dataset?.dataset_type || 'dataset').replace(/_/g, ' ')}
                    </Typography>
                    <Typography sx={{ fontSize: 10.5, color: FCC_THEME.textSoft }}>
                      {fmtInt(entry?.dataset?.row_count)} rows • {fmtInt(entry?.profile?.total_columns || entry?.dataset?.column_count)} columns
                    </Typography>
                  </Box>
                </Stack>
                <DetailChip label={`Quality ${Math.round(quality || 0)}/100`} tone={quality >= 80 ? 'good' : 'warn'} />
              </Stack>
            </Box>
            <Box sx={{ px: 2, py: 1.75 }}>
              <Stack spacing={1.25}>
                <Typography sx={{ fontSize: 11.5, color: FCC_THEME.textMuted, lineHeight: 1.6 }}>
                  {datasetBusinessSummary(entry, targetColumn)}
                </Typography>

                <Stack direction="row" spacing={0.8} flexWrap="wrap" useFlexGap>
                  <DetailChip label={`Missing ${fmtPct(missing)}`} tone={missing > 5 ? 'warn' : 'good'} />
                  <DetailChip label={`Duplicates ${fmtPct(duplicate)}`} tone={duplicate > 1 ? 'warn' : 'good'} />
                  <DetailChip label={`${fmtInt(joinKeys.length)} join keys`} tone={joinKeys.length ? 'good' : 'warn'} />
                  {targetCandidates.length ? <DetailChip label={`Target candidates ${targetCandidates.length}`} tone="accent" /> : null}
                </Stack>

                <Box component="details" sx={{ '& summary': { cursor: 'pointer', color: FCC_THEME.accent, fontSize: 11.25, fontWeight: 700 } }}>
                  <summary>Show technical detail</summary>
                  <Stack spacing={1} sx={{ mt: 1.2 }}>
                    <Box sx={{ px: 1.2, py: 1, borderRadius: 2, bgcolor: FCC_THEME.panelAlt, border: `1px solid ${FCC_THEME.border}` }}>
                      <Stack direction="row" spacing={0.8} alignItems="center" sx={{ mb: 0.4 }}>
                        <FactCheckOutlined sx={{ fontSize: 15, color: FCC_THEME.textMuted }} />
                        <Typography sx={{ fontSize: 11.25, fontWeight: 700, color: FCC_THEME.text }}>
                          Technical profiling
                        </Typography>
                      </Stack>
                      <Typography sx={{ fontSize: 11, color: FCC_THEME.textMuted, lineHeight: 1.6 }}>
                        Join key candidates: {joinKeys.length ? joinKeys.join(', ') : 'none identified yet'}.
                        High-missing columns: {highMissingColumns.length ? highMissingColumns.join(', ') : 'none in the top flagged set'}.
                        Target candidates: {targetCandidates.length ? targetCandidates.join(', ') : 'none detected from metadata'}.
                      </Typography>
                    </Box>
                  </Stack>
                </Box>
              </Stack>
            </Box>
          </Paper>
        );
      })}
    </Stack>
  );
}

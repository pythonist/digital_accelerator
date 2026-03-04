/**
 * steps/StepTarget.jsx
 * Wizard step 2: Pick the target column in plain English.
 * Aggregates columns from all selected source datasets.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Chip, CircularProgress, Stack, TextField, Typography,
} from '@mui/material';
import mlopsApi from '../../services/mlopsApi';

// Guess what a column is "about" from its name
const guessColumnRole = (name) => {
  const n = name.toLowerCase();
  if (/is_fraud|fraud_flag|is_suspicious|label|target|is_sar|flagged/.test(n))
    return { priority: 0, hint: 'Likely outcome label. Good target candidate.', recommended: true };
  if (/amount|value|sum/.test(n))
    return { priority: 2, hint: 'A money amount - usually not the target', recommended: false };
  if (/date|time|month|year/.test(n))
    return { priority: 3, hint: 'A date column - not suitable as a target', recommended: false };
  if (/id$|_id/.test(n))
    return { priority: 3, hint: 'An ID column - not suitable as a target', recommended: false };
  if (/flag|indicator|status|type/.test(n))
    return { priority: 1, hint: 'Could be a useful target column', recommended: false };
  return { priority: 2, hint: '', recommended: false };
};

const toColumnName = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return String(value.name || value.column_name || value.column || '').trim();
};

const sourceLabel = (dataset) => {
  const type = String(dataset?.dataset_type || '').trim();
  if (type) return type;
  return `dataset_${dataset?.dataset_id || 'unknown'}`;
};

const sourceSummary = (sources = []) => {
  if (!sources.length) return '';
  if (sources.length <= 2) return sources.join(', ');
  return `${sources.slice(0, 2).join(', ')} +${sources.length - 2} more`;
};

const scoreTargetCandidate = (name, preferredTarget = '') => {
  const token = String(name || '').toLowerCase();
  const preferred = String(preferredTarget || '').trim().toLowerCase();
  let score = 0;
  const badges = [];

  const strongRegex = /(is_fraud|fraud_label|fraud_flag|is_suspicious|is_true_pos|final_label|str_label|is_sar|sar_flag|target|label|case_status)/;
  const mediumRegex = /(flag|indicator|status|outcome|result|decision|tp|positive)/;

  if (preferred && token === preferred) {
    score += 200;
    badges.push('Workbench target');
  }
  if (strongRegex.test(token)) {
    score += 90;
    badges.push('Strong candidate');
  } else if (mediumRegex.test(token)) {
    score += 45;
    badges.push('Candidate');
  }

  if (/(id$|_id|uuid|hash|key)/.test(token)) score -= 55;
  if (/(date|time|timestamp|month|year|day)/.test(token)) score -= 30;
  if (/(amount|value|sum|balance|volume|score)/.test(token)) score -= 20;

  const role = guessColumnRole(name);
  if (role.recommended) score += 15;
  score -= role.priority * 4;

  return { score, badges };
};

const ColumnPill = ({ col, selected, onClick, sources = [], badges = [], score = 0 }) => {
  const role = guessColumnRole(col);
  const isStrong = score >= 70;
  return (
    <Box
      onClick={() => onClick(col)}
      sx={{
        px: 1.5, py: 1,
        border: `2px solid ${selected ? '#D04A02' : isStrong ? '#f59e0b' : role.recommended ? '#22c55e' : '#e2e8f0'}`,
        borderRadius: 1.5,
        bgcolor: selected ? '#fff1ec' : isStrong ? '#fffbeb' : role.recommended ? '#f0fdf4' : '#fff',
        cursor: 'pointer',
        transition: 'all 0.12s',
        '&:hover': { borderColor: '#D04A02' },
      }}
    >
      <Typography sx={{ fontSize: 12, fontWeight: 700, color: selected ? '#D04A02' : '#1e293b', fontFamily: 'monospace' }}>
        {col}
      </Typography>
      {role.hint && (
        <Typography sx={{ fontSize: 10, color: role.recommended ? '#16a34a' : '#94a3b8' }}>
          {role.hint}
        </Typography>
      )}
      {badges.length > 0 && (
        <Stack direction="row" spacing={0.5} sx={{ mt: 0.4 }} flexWrap="wrap" useFlexGap>
          {badges.slice(0, 2).map((badge) => (
            <Chip
              key={`${col}_${badge}`}
              size="small"
              label={badge}
              sx={{
                height: 18,
                fontSize: 10,
                bgcolor: badge === 'Workbench target' ? '#fff1ec' : '#fff7ed',
                color: badge === 'Workbench target' ? '#D04A02' : '#9a3412',
                border: `1px solid ${badge === 'Workbench target' ? '#f2c8b5' : '#fed7aa'}`,
                '& .MuiChip-label': { px: 0.8 },
              }}
            />
          ))}
          <Chip
            size="small"
            label={`score ${Math.max(0, score)}`}
            sx={{
              height: 18,
              fontSize: 10,
              bgcolor: '#f8fafc',
              color: '#334155',
              border: '1px solid #e2e8f0',
              '& .MuiChip-label': { px: 0.8 },
            }}
          />
        </Stack>
      )}
      {sources.length > 0 && (
        <Typography sx={{ fontSize: 10, color: '#64748b' }}>
          Found in: {sourceSummary(sources)}
        </Typography>
      )}
    </Box>
  );
};

const StepTarget = ({ sourceDatasets = [], targetColumn, preferredTarget = '', onTargetChange }) => {
  const [columns, setColumns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let active = true;
    if (!sourceDatasets.length) {
      setColumns([]);
      setLoading(false);
      setLoadError(null);
      return () => { active = false; };
    }

    const load = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const previews = await Promise.all(sourceDatasets.map(async (dataset) => {
          const dsid = Number(dataset?.dataset_id);
          if (!dsid) return { dataset, cols: [] };
          try {
            const res = await mlopsApi.schemaPreview({ dataset_id: dsid });
            const rawCols = res?.data?.columns || res?.columns || [];
            const cols = rawCols.map(toColumnName).filter(Boolean);
            return { dataset, cols };
          } catch {
            return { dataset, cols: [] };
          }
        }));

        if (!active) return;

        const merged = new Map();
        previews.forEach(({ dataset, cols }) => {
          const src = sourceLabel(dataset);
          cols.forEach((col) => {
            const key = col.toLowerCase();
            const existing = merged.get(key) || { name: col, sources: [] };
            if (!existing.sources.includes(src)) existing.sources.push(src);
            merged.set(key, existing);
          });
        });

        const mergedColumns = Array.from(merged.values());
        setColumns(mergedColumns);

        if (!targetColumn && preferredTarget) {
          const workbenchMatch = mergedColumns.find(
            (entry) => entry.name.toLowerCase() === String(preferredTarget).toLowerCase(),
          );
          if (workbenchMatch) {
            onTargetChange(workbenchMatch.name);
            return;
          }
        }

        if (targetColumn) {
          const exact = mergedColumns.find((entry) => entry.name === targetColumn);
          if (!exact) {
            const ci = mergedColumns.find((entry) => entry.name.toLowerCase() === String(targetColumn).toLowerCase());
            onTargetChange(ci ? ci.name : '');
          }
        }
      } catch {
        if (active) {
          setColumns([]);
          setLoadError('Failed to load column list from selected datasets.');
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    load();
    return () => { active = false; };
  }, [sourceDatasets, targetColumn, preferredTarget, onTargetChange]);

  const ranked = useMemo(() => (
    columns
      .map((entry) => {
        const scored = scoreTargetCandidate(entry.name, preferredTarget);
        return { ...entry, ...scored };
      })
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  ), [columns, preferredTarget]);

  const topCandidates = useMemo(
    () => ranked.filter((entry) => entry.score >= 40).slice(0, 6),
    [ranked],
  );

  const preferredMatch = useMemo(
    () => ranked.find((entry) => entry.name.toLowerCase() === String(preferredTarget || '').toLowerCase()) || null,
    [ranked, preferredTarget],
  );

  const filtered = useMemo(() => {
    if (!search) return ranked;
    const q = search.toLowerCase();
    return ranked.filter((entry) => entry.name.toLowerCase().includes(q));
  }, [ranked, search]);

  if (!sourceDatasets.length) {
    return (
      <Typography sx={{ fontSize: 12.5, color: '#94a3b8', fontStyle: 'italic' }}>
        Select at least one data source in the previous step to load target candidates.
      </Typography>
    );
  }

  return (
    <Stack spacing={1.5}>
      <Box sx={{ p: 2, bgcolor: '#f8fafc', borderRadius: 2, border: '1px solid #e2e8f0' }}>
        <Typography sx={{ fontSize: 13, color: '#475569', lineHeight: 1.6 }}>
          Pick the column that contains the <strong>answer</strong> you want the model to predict.
          For fraud detection, this is usually a column like <code>is_fraud</code> or <code>fraud_flag</code>.
        </Typography>
        <Typography sx={{ mt: 1, fontSize: 11.5, color: '#64748b' }}>
          Loaded from {sourceDatasets.length} selected source table{sourceDatasets.length !== 1 ? 's' : ''}.
        </Typography>
        {preferredTarget && (
          <Typography sx={{ mt: 0.8, fontSize: 11.5, color: preferredMatch ? '#166534' : '#92400e' }}>
            Workbench target: <code>{preferredTarget}</code>{' '}
            {preferredMatch ? 'found and highlighted below.' : 'not present in selected source tables.'}
          </Typography>
        )}
      </Box>

      {loading ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CircularProgress size={16} />
          <Typography sx={{ fontSize: 12, color: '#64748b' }}>
            Loading columns from selected datasets...
          </Typography>
        </Box>
      ) : (
        <>
          {loadError && (
            <Box sx={{ p: 1.2, bgcolor: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 1.5 }}>
              <Typography sx={{ fontSize: 11.5, color: '#9a3412' }}>{loadError}</Typography>
            </Box>
          )}
          <TextField
            size="small"
            placeholder="Search columns..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ maxWidth: 280 }}
          />
          {topCandidates.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.8 }}>
              {topCandidates.map((entry) => (
                <Chip
                  key={`top_${entry.name}`}
                  size="small"
                  label={`${entry.name} • ${Math.max(0, entry.score)}`}
                  onClick={() => onTargetChange(entry.name)}
                  sx={{
                    fontFamily: 'monospace',
                    fontSize: 10.5,
                    bgcolor: targetColumn === entry.name ? '#D04A02' : '#fff7ed',
                    color: targetColumn === entry.name ? '#fff' : '#9a3412',
                    border: `1px solid ${targetColumn === entry.name ? '#D04A02' : '#fed7aa'}`,
                  }}
                />
              ))}
            </Box>
          )}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {filtered.map((entry) => (
              <ColumnPill
                key={entry.name}
                col={entry.name}
                selected={targetColumn === entry.name}
                sources={entry.sources}
                badges={entry.badges}
                score={entry.score}
                onClick={onTargetChange}
              />
            ))}
          </Box>
          {!filtered.length && (
            <Typography sx={{ fontSize: 11.5, color: '#94a3b8' }}>
              No matching columns found.
            </Typography>
          )}
          {targetColumn && (
            <Box sx={{ p: 1.5, bgcolor: '#fff1ec', borderRadius: 2, border: '1.5px solid #D04A02' }}>
              <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: '#D04A02' }}>
                Target selected: <code>{targetColumn}</code>
              </Typography>
              <Typography sx={{ fontSize: 11.5, color: '#92400e' }}>
                The model will learn to predict this column.
              </Typography>
            </Box>
          )}
        </>
      )}
    </Stack>
  );
};

export default StepTarget;

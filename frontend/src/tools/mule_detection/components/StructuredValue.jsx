import React, { useMemo, useState } from 'react';
import {
  Box,
  Collapse,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography
} from '@mui/material';
import { ExpandMore, ChevronRight } from '@mui/icons-material';
import { formatInteger, formatNumber, formatProbability } from '../utils/formatters';

const isPlainObject = (v) => {
  if (!v || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

const parseJsonLikeString = (value) => {
  if (typeof value !== 'string') return value;
  const s = value.trim();
  if (!s) return value;
  const startsOk = s.startsWith('{') || s.startsWith('[');
  const endsOk = s.endsWith('}') || s.endsWith(']');
  if (!startsOk || !endsOk) return value;
  try {
    const parsed = JSON.parse(s);
    if (isPlainObject(parsed) || Array.isArray(parsed)) return parsed;
    return value;
  } catch {
    return value;
  }
};

const summarize = (value) => {
  if (Array.isArray(value)) return `${formatInteger(value.length)} items`;
  if (isPlainObject(value)) return `${formatInteger(Object.keys(value).length)} fields`;
  return '';
};

const formatPrimitive = (value, mode) => {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    if (mode === 'probability') return formatProbability(value, 3);
    if (mode === 'integer') return formatInteger(value);
    return formatNumber(value, { maxFractionDigits: 3 });
  }
  if (typeof value === 'string') {
    const cleaned = value.replace(/[{}]/g, '').trim();
    return cleaned || '-';
  }
  return String(value);
};

const StructuredTable = ({ value, depth, mode }) => {
  const rows = useMemo(() => {
    if (Array.isArray(value)) {
      return value.map((v, i) => ({ key: `Item ${i + 1}`, value: v }));
    }
    if (isPlainObject(value)) {
      return Object.entries(value).map(([k, v]) => ({ key: k, value: v }));
    }
    return [];
  }, [value]);

  return (
    <Table size="small" sx={{ minWidth: 320 }}>
      {depth === 0 ? (
        <TableHead>
          <TableRow>
            <TableCell sx={{ width: 220 }}>Field</TableCell>
            <TableCell>Value</TableCell>
          </TableRow>
        </TableHead>
      ) : null}
      <TableBody>
        {rows.map((r) => (
          <StructuredRow key={`${depth}-${r.key}`} rowKey={r.key} rowValue={r.value} depth={depth} mode={mode} />
        ))}
      </TableBody>
    </Table>
  );
};

const StructuredRow = ({ rowKey, rowValue, depth, mode }) => {
  const parsed = useMemo(() => parseJsonLikeString(rowValue), [rowValue]);
  const isNested = Array.isArray(parsed) || isPlainObject(parsed);
  const [open, setOpen] = useState(false);
  const summary = isNested ? summarize(parsed) : '';

  return (
    <>
      <TableRow hover>
        <TableCell sx={{ whiteSpace: 'nowrap' }}>
          <Stack direction="row" spacing={0.5} alignItems="center">
            {isNested ? (
              <IconButton size="small" onClick={() => setOpen((p) => !p)}>
                {open ? <ExpandMore fontSize="small" /> : <ChevronRight fontSize="small" />}
              </IconButton>
            ) : (
              <Box sx={{ width: 32 }} />
            )}
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              {rowKey}
            </Typography>
          </Stack>
        </TableCell>
        <TableCell>
          {isNested ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="body2" color="text.secondary">
                {summary}
              </Typography>
            </Stack>
          ) : (
            <Typography variant="body2">{formatPrimitive(parsed, mode)}</Typography>
          )}
        </TableCell>
      </TableRow>
      {isNested ? (
        <TableRow>
          <TableCell colSpan={2} sx={{ py: 0 }}>
            <Collapse in={open} timeout="auto" unmountOnExit>
              <Box sx={{ pl: 3, py: 1 }}>
                <StructuredTable value={parsed} depth={depth + 1} mode={mode} />
              </Box>
            </Collapse>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
};

const StructuredValue = ({ value, mode = 'number', inline = false }) => {
  const parsed = useMemo(() => parseJsonLikeString(value), [value]);
  const isNested = Array.isArray(parsed) || isPlainObject(parsed);
  const [open, setOpen] = useState(false);

  if (!isNested) {
    return <>{formatPrimitive(parsed, mode)}</>;
  }

  if (inline) {
    return (
      <Stack direction="row" spacing={0.5} alignItems="center">
        <IconButton size="small" onClick={() => setOpen((p) => !p)}>
          {open ? <ExpandMore fontSize="small" /> : <ChevronRight fontSize="small" />}
        </IconButton>
        <Typography variant="body2" color="text.secondary">
          {summarize(parsed)}
        </Typography>
        <Collapse in={open} timeout="auto" unmountOnExit>
          <Box sx={{ mt: 1 }}>
            <StructuredTable value={parsed} depth={0} mode={mode} />
          </Box>
        </Collapse>
      </Stack>
    );
  }

  return <StructuredTable value={parsed} depth={0} mode={mode} />;
};

export default StructuredValue;

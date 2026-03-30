import React from 'react';
import {
  Chip,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
} from '@mui/material';
import { DeleteOutline, Edit } from '@mui/icons-material';

const RecipientTable = ({ rows, onEdit, onDelete }) => (
  <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell>Role</TableCell>
            <TableCell>Type</TableCell>
            <TableCell>Email</TableCell>
            <TableCell>Distribution</TableCell>
            <TableCell>Branch</TableCell>
            <TableCell>Region</TableCell>
            <TableCell>Case Types Supported</TableCell>
            <TableCell>Auto Routing Enabled</TableCell>
            <TableCell>Active</TableCell>
            <TableCell align="center">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} hover>
              <TableCell>{row.name}</TableCell>
              <TableCell>{row.role}</TableCell>
              <TableCell sx={{ textTransform: 'capitalize' }}>{row.recipient_type || 'individual'}</TableCell>
              <TableCell>{row.email}</TableCell>
              <TableCell>{(row.distribution_list || []).join(', ') || '-'}</TableCell>
              <TableCell>{row.branch_code || '-'}</TableCell>
              <TableCell>{row.region || '-'}</TableCell>
              <TableCell>{(row.case_types_supported || []).join(', ') || '-'}</TableCell>
              <TableCell>
                <Chip size="small" label={row.auto_route_enabled ? 'Enabled' : 'Disabled'} color={row.auto_route_enabled ? 'success' : 'default'} variant={row.auto_route_enabled ? 'filled' : 'outlined'} />
              </TableCell>
              <TableCell>
                <Chip size="small" label={row.is_active ? 'Active' : 'Inactive'} color={row.is_active ? 'success' : 'default'} variant={row.is_active ? 'filled' : 'outlined'} />
              </TableCell>
              <TableCell align="center">
                <Tooltip title="Edit recipient">
                  <IconButton size="small" onClick={() => onEdit(row)}>
                    <Edit fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Delete recipient">
                  <IconButton size="small" color="error" onClick={() => onDelete?.(row)}>
                    <DeleteOutline fontSize="small" />
                  </IconButton>
                </Tooltip>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  </Paper>
);

export default RecipientTable;

// frontend/src/tools/btsy/screens/calibration/transaction_universe/components/UniverseHistoryTable.jsx
import React from 'react';
import {
  Box,
  Card,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Tooltip,
  Chip,
  Alert
} from '@mui/material';
import {
  History as HistoryIcon,
  Lock as LockIcon,
  Delete as DeleteIcon,
  Visibility as VisibilityIcon
} from '@mui/icons-material';

/**
 * Displays universe history with actions
 */
const UniverseHistoryTable = ({ universes, onFreeze, onDelete, onView }) => {
  return (
    <Card sx={{ height: '100%' }}>
      <Box sx={{ p: 2.5, borderBottom: '1px solid #e2e8f0', bgcolor: '#fafafa' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <HistoryIcon sx={{ color: '#D04A02' }} />
          <Typography variant="h6" sx={{ fontWeight: 600, color: '#1e293b' }}>
            Universe History
          </Typography>
          {universes.length > 0 && (
            <Chip
              label={universes.length}
              size="small"
              sx={{ ml: 'auto', bgcolor: '#e0e7ff', color: '#3730a3', fontWeight: 600 }}
            />
          )}
        </Box>
      </Box>

      <Box sx={{ p: 2.5 }}>
        {universes.length === 0 ? (
          <Alert severity="info" sx={{ bgcolor: '#eff6ff', border: '1px solid #bfdbfe' }}>
            No universes created yet. Create your first universe using the filter builder.
          </Alert>
        ) : (
          <TableContainer sx={{ maxHeight: 400 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600, bgcolor: '#fafafa', color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                    Name
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600, bgcolor: '#fafafa', color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase' }} align="right">
                    Transactions
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600, bgcolor: '#fafafa', color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                    Status
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600, bgcolor: '#fafafa', color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase' }} align="center">
                    Actions
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {universes.map((universe) => (
                  <TableRow
                    key={universe.id}
                    hover
                    sx={{
                      '&:last-child td': { borderBottom: 0 },
                      bgcolor: universe.status === 'frozen' ? '#f0fdf4' : 'white'
                    }}
                  >
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 500, color: '#1e293b' }}>
                        {universe.universe_name}
                      </Typography>
                      {universe.universe_description && (
                        <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mt: 0.5 }}>
                          {universe.universe_description}
                        </Typography>
                      )}
                      <Box sx={{ mt: 0.5 }}>
                        {universe.filter_spec?.categories?.map(cat => (
                          <Chip
                            key={cat}
                            label={cat}
                            size="small"
                            sx={{ mr: 0.5, height: 20, fontSize: '0.65rem' }}
                          />
                        ))}
                      </Box>
                    </TableCell>
                    
                    <TableCell align="right">
                      <Typography variant="body2" sx={{ fontWeight: 600, fontFamily: 'monospace' }}>
                        {universe.transaction_count?.toLocaleString()}
                      </Typography>
                      {universe.unique_accounts && (
                        <Typography variant="caption" sx={{ color: '#64748b', display: 'block' }}>
                          {universe.unique_accounts} accounts
                        </Typography>
                      )}
                    </TableCell>
                    
                    <TableCell>
                      <Chip
                        label={universe.status}
                        size="small"
                        icon={universe.status === 'frozen' ? <LockIcon fontSize="small" /> : undefined}
                        sx={{
                          bgcolor: universe.status === 'frozen' ? '#dcfce7' : '#f1f5f9',
                          color: universe.status === 'frozen' ? '#15803d' : '#475569',
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          fontSize: '0.7rem'
                        }}
                      />
                    </TableCell>
                    
                    <TableCell align="center">
                      <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center' }}>
                        {onView && (
                          <Tooltip title="View Details">
                            <IconButton
                              size="small"
                              onClick={() => onView(universe.id)}
                              sx={{ color: '#64748b' }}
                            >
                              <VisibilityIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                        
                        {universe.status === 'draft' ? (
                          <>
                            <Tooltip title="Freeze Universe (Make Immutable)">
                              <IconButton
                                size="small"
                                onClick={() => onFreeze(universe.id)}
                                sx={{ color: '#16a34a' }}
                              >
                                <LockIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Delete Draft">
                              <IconButton
                                size="small"
                                onClick={() => onDelete(universe.id)}
                                sx={{ color: '#dc2626' }}
                              >
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </>
                        ) : (
                          <Chip
                            label="Immutable"
                            size="small"
                            sx={{
                              bgcolor: '#dcfce7',
                              color: '#15803d',
                              fontWeight: 600,
                              fontSize: '0.65rem',
                              height: 24
                            }}
                          />
                        )}
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Box>
    </Card>
  );
};

export default UniverseHistoryTable;
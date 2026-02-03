// src/tools/investigation/screens/data/DataTableScreen.jsx
import React, { useEffect, useState, useRef } from "react";
import apiClient from "@services/api";

// ✅ Correct Import based on your context
import PageContainer from "@investigation-layout/PageContainer";

import {
  Box, Paper, Typography, Select, MenuItem, TextField, InputAdornment, IconButton,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TablePagination,
  Divider, CircularProgress, Alert, Button, Popover, Stack, Chip, Badge, Tooltip, Fade
} from "@mui/material";
import {
  Search as SearchIcon, FilterList as FilterIcon, Download as DownloadIcon,
  ArrowUpward, ArrowDownward, FilterAlt as ColumnFilterIcon, Sort as SortIcon,
  Refresh as RefreshIcon, Clear as ClearIcon, Storage as StorageIcon
} from "@mui/icons-material";

const DataTableScreen = () => {
  // State
  const [tables, setTables] = useState([]);
  const [activeTable, setActiveTable] = useState("");
  const [columns, setColumns] = useState([]);
  const [data, setData] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const [globalSearch, setGlobalSearch] = useState("");
  const [columnFilters, setColumnFilters] = useState({});
  const [filterMenuAnchor, setFilterMenuAnchor] = useState(null);
  const [activeFilterColumn, setActiveFilterColumn] = useState(null);
  const tempFilterValueRef = useRef("");

  // Lifecycle
  useEffect(() => { loadTables(); }, []);

  useEffect(() => {
    if (activeTable) {
      const timer = setTimeout(() => loadTableData(), 300);
      return () => clearTimeout(timer);
    }
  }, [activeTable, page, rowsPerPage, sortConfig, columnFilters, globalSearch]);

  // API Handlers
  const loadTables = async () => {
    try {
      const res = await apiClient.get("/api/v2/db/tables");
      if (Array.isArray(res) && res.length) {
        setTables(res);
        setActiveTable(res.includes("alerts") ? "alerts" : res[0]);
      }
    } catch {
      setError("Failed to load tables");
    }
  };

  const loadTableData = async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = {
        table: activeTable,
        page: page + 1,
        rowsPerPage,
        search: globalSearch,
        sort: sortConfig.key ? { column: sortConfig.key, direction: sortConfig.direction } : null,
        filters: columnFilters
      };

      const res = await apiClient.post("/api/v2/db/query-table", payload);
      setColumns(res.columns || []);
      setData(res.data || []);
      setTotalRows(res.totalRows || 0);
    } catch {
      setError("Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  // Event Handlers
  const handleSort = (column) => {
    let direction = 'asc';
    if (sortConfig.key === column && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key: column, direction });
  };

  const handleOpenFilterMenu = (event, column) => {
    event.stopPropagation();
    setActiveFilterColumn(column);
    tempFilterValueRef.current = columnFilters[column] || "";
    setFilterMenuAnchor(event.currentTarget);
  };

  const handleApplyColumnFilter = () => {
    if (activeFilterColumn) {
      const val = tempFilterValueRef.current;
      setColumnFilters(prev => {
        const next = { ...prev };
        if (val) next[activeFilterColumn] = val;
        else delete next[activeFilterColumn];
        return next;
      });
      setPage(0);
    }
    setFilterMenuAnchor(null);
  };

  const handleClearSingleFilter = (col) => {
    setColumnFilters(prev => {
      const next = { ...prev };
      delete next[col];
      return next;
    });
  };

  const handleClearAllFilters = () => {
    setColumnFilters({});
    setGlobalSearch("");
    setPage(0);
  };

  const handleExport = () => {
    alert("Export functionality would trigger here");
  };

  const activeFilterCount = Object.keys(columnFilters).length;

  return (
    <PageContainer
      title="Data Explorer"
      subtitle="Direct database access and query inspection"
      breadcrumbs={['Data Management', 'Explorer']}
      actions={
        <Stack direction="row" spacing={1.5}>
          <Button 
            variant="outlined" 
            size="small" 
            startIcon={<RefreshIcon />} 
            onClick={loadTableData} 
            disabled={loading} 
            sx={{ fontWeight: 600 }}
          >
            Refresh
          </Button>
          <Button 
            variant="outlined" 
            size="small" 
            startIcon={<DownloadIcon />} 
            onClick={handleExport} 
            sx={{ fontWeight: 600 }}
          >
            Export
          </Button>
        </Stack>
      }
    >
      {/* CONTENT AREA */}
      {/* ✅ Fixed: Removed 'p: 3' to avoid double padding (PageContainer has it). 
          Added height: '100%' so the table fills the container space. */}
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        
        <Paper 
          variant="outlined" 
          sx={{ 
            flex: 1, 
            display: 'flex', 
            flexDirection: 'column',
            borderRadius: 2, 
            overflow: 'hidden', 
            bgcolor: '#fff' 
          }}
        >
          
          {/* Dataset & Controls Bar */}
          <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid #e0e0e0', bgcolor: '#fafafa', display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', flexShrink: 0 }}>
            
            {/* Dataset Selector */}
            <Stack direction="row" spacing={1} alignItems="center">
              <StorageIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
              <Typography variant="body2" fontWeight="600" color="text.secondary">Dataset:</Typography>
              <Select
                value={activeTable}
                onChange={(e) => { 
                  setActiveTable(e.target.value); 
                  setPage(0); 
                  setColumnFilters({}); 
                  setGlobalSearch("");
                }}
                variant="standard"
                disableUnderline
                sx={{ fontSize: '0.875rem', fontWeight: 700, color: 'primary.main', minWidth: 120 }}
              >
                {tables.map((t) => (
                  <MenuItem key={t} value={t}>{t}</MenuItem>
                ))}
              </Select>
            </Stack>

            <Divider orientation="vertical" flexItem sx={{ height: 20, my: 'auto' }} />

            {/* Record Count */}
            <Chip 
              label={`${totalRows.toLocaleString()} records`} 
              size="small" 
              sx={{ height: 24, fontWeight: 600, bgcolor: '#e3f2fd', color: 'primary.main', fontSize: '0.75rem' }} 
            />

            <Box sx={{ flexGrow: 1 }} />

            {/* Global Search */}
            <TextField
              size="small"
              placeholder="Search across all columns..."
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ fontSize: 18, color: 'action.active' }} />
                  </InputAdornment>
                ),
                endAdornment: globalSearch && (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setGlobalSearch("")} sx={{ p: 0.5 }}>
                      <ClearIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </InputAdornment>
                ),
                sx: { 
                  fontSize: '0.8125rem', 
                  height: 36, 
                  width: 280, 
                  bgcolor: '#fff',
                  '& .MuiOutlinedInput-notchedOutline': { borderColor: '#e0e0e0' }
                }
              }}
            />

            {/* Filter Toggle */}
            <Tooltip title={`${activeFilterCount} active filter${activeFilterCount !== 1 ? 's' : ''}`}>
              <IconButton 
                size="small" 
                color={activeFilterCount > 0 ? "primary" : "default"}
                sx={{ 
                  border: '1px solid',
                  borderColor: activeFilterCount > 0 ? 'primary.main' : '#e0e0e0',
                  bgcolor: activeFilterCount > 0 ? '#e3f2fd' : 'transparent'
                }}
              >
                <Badge badgeContent={activeFilterCount} color="primary">
                  <FilterIcon sx={{ fontSize: 18 }} />
                </Badge>
              </IconButton>
            </Tooltip>
          </Box>

          {/* Active Filters Panel */}
          {activeFilterCount > 0 && (
            <Fade in>
              <Box sx={{ px: 2, py: 1.5, bgcolor: '#f0f4ff', borderBottom: '1px solid #cbd5e1', display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', flexShrink: 0 }}>
                <Typography variant="caption" fontWeight="700" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Active Filters:
                </Typography>
                {Object.entries(columnFilters).map(([col, val]) => (
                  <Chip 
                    key={col} 
                    label={<><strong>{col}</strong>: {val}</>}
                    size="small" 
                    onDelete={() => handleClearSingleFilter(col)}
                    sx={{ 
                      bgcolor: '#fff', 
                      border: '1px solid #3b82f6', 
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      '& .MuiChip-deleteIcon': { color: '#3b82f6' }
                    }}
                  />
                ))}
                <Button 
                  size="small" 
                  onClick={handleClearAllFilters} 
                  sx={{ fontSize: '0.7rem', textTransform: 'none', fontWeight: 700, color: 'error.main' }}
                  startIcon={<ClearIcon sx={{ fontSize: 14 }} />}
                >
                  Clear All
                </Button>
              </Box>
            </Fade>
          )}

          {/* Error Alert */}
          {error && (
            <Alert severity="error" variant="filled" sx={{ borderRadius: 0, flexShrink: 0 }}>
              {error}
            </Alert>
          )}

          {/* Table Container - Dynamic Height */}
          <TableContainer sx={{ flex: 1, overflowY: 'auto' }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  {columns.map((col) => (
                    <TableCell
                      key={col}
                      sx={{
                        bgcolor: '#fafafa',
                        borderBottom: '2px solid #e0e0e0',
                        py: 1.5,
                        px: 2,
                        minWidth: 150,
                        position: 'sticky',
                        top: 0,
                        zIndex: 10
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                        
                        {/* Sortable Header */}
                        <Box 
                          onClick={() => handleSort(col)}
                          sx={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            cursor: 'pointer', 
                            userSelect: 'none',
                            flex: 1,
                            '&:hover': { 
                              '& .MuiTypography-root': { color: 'primary.main' },
                              '& .sort-icon': { opacity: 1 }
                            }
                          }}
                        >
                          <Typography 
                            variant="caption" 
                            fontWeight={700} 
                            sx={{ 
                              textTransform: 'uppercase', 
                              letterSpacing: 0.5,
                              color: sortConfig.key === col ? 'primary.main' : 'text.secondary',
                              transition: 'color 0.2s'
                            }}
                          >
                            {col}
                          </Typography>
                          
                          {sortConfig.key === col ? (
                            sortConfig.direction === 'asc' ? 
                              <ArrowUpward sx={{ fontSize: 14, ml: 0.5, color: 'primary.main' }} /> : 
                              <ArrowDownward sx={{ fontSize: 14, ml: 0.5, color: 'primary.main' }} />
                          ) : (
                            <SortIcon className="sort-icon" sx={{ fontSize: 14, ml: 0.5, opacity: 0, transition: 'opacity 0.2s', color: 'action.disabled' }} />
                          )}
                        </Box>

                        {/* Column Filter */}
                        <Tooltip title={`Filter ${col}`}>
                          <IconButton 
                            size="small" 
                            onClick={(e) => handleOpenFilterMenu(e, col)}
                            sx={{ 
                              p: 0.5,
                              color: columnFilters[col] ? 'primary.main' : 'action.disabled',
                              bgcolor: columnFilters[col] ? '#e3f2fd' : 'transparent',
                              '&:hover': { 
                                bgcolor: columnFilters[col] ? '#bbdefb' : '#f5f5f5',
                                color: 'primary.main'
                              }
                            }}
                          >
                            <ColumnFilterIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>

              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={columns.length || 1} align="center" sx={{ height: 300, border: 'none' }}>
                      <CircularProgress size={40} />
                      <Typography variant="body2" color="text.secondary" mt={2}>Loading data...</Typography>
                    </TableCell>
                  </TableRow>
                ) : data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={columns.length || 1} align="center" sx={{ height: 200, border: 'none' }}>
                      <StorageIcon sx={{ fontSize: 48, color: '#cbd5e1', mb: 1 }} />
                      <Typography variant="body2" color="text.secondary" fontWeight={500}>
                        No records found matching your query.
                      </Typography>
                      {(globalSearch || activeFilterCount > 0) && (
                        <Button 
                          size="small" 
                          onClick={handleClearAllFilters}
                          sx={{ mt: 2, textTransform: 'none', fontWeight: 600 }}
                        >
                          Clear filters to see all records
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ) : (
                  data.map((row, i) => (
                    <TableRow 
                      key={i} 
                      hover 
                      sx={{ 
                        '&:hover': { bgcolor: '#f8fafc' },
                        '&:nth-of-type(even)': { bgcolor: '#fafafa' }
                      }}
                    >
                      {columns.map((col) => (
                        <TableCell
                          key={col}
                          sx={{
                            fontSize: '0.8125rem',
                            borderBottom: '1px solid #f0f0f0',
                            maxWidth: 300,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            py: 1.25,
                            px: 2
                          }}
                          title={row[col] !== null ? String(row[col]) : 'null'}
                        >
                          {row[col] !== null ? (
                            String(row[col])
                          ) : (
                            <Typography component="span" variant="caption" sx={{ color: '#cbd5e1', fontStyle: 'italic' }}>
                              null
                            </Typography>
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Pagination */}
          <TablePagination
            component="div"
            count={totalRows}
            page={page}
            onPageChange={(e, n) => setPage(n)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(e) => {
              setRowsPerPage(parseInt(e.target.value, 10));
              setPage(0);
            }}
            rowsPerPageOptions={[20, 50, 100, 200]}
            sx={{
              borderTop: '1px solid #e0e0e0',
              bgcolor: '#fafafa',
              flexShrink: 0,
              '.MuiTablePagination-selectLabel, .MuiTablePagination-displayedRows': {
                fontSize: '0.8125rem',
                fontWeight: 600,
                color: 'text.secondary'
              },
              '.MuiTablePagination-select': {
                fontWeight: 700,
                fontSize: '0.8125rem'
              }
            }}
          />
        </Paper>
      </Box>

      {/* FILTER POPOVER */}
      <Popover
        open={Boolean(filterMenuAnchor)}
        anchorEl={filterMenuAnchor}
        onClose={() => setFilterMenuAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{
          sx: { borderRadius: 2, boxShadow: 3, border: '1px solid #e0e0e0' }
        }}
      >
        <Box sx={{ p: 2.5, width: 280 }}>
          <Typography variant="subtitle2" fontWeight="700" display="block" mb={1.5} color="text.primary">
            Filter Column: <Box component="span" sx={{ color: 'primary.main' }}>{activeFilterColumn}</Box>
          </Typography>
          <TextField 
            size="small" 
            fullWidth 
            autoFocus
            placeholder="Value contains..."
            defaultValue={tempFilterValueRef.current}
            onChange={(e) => tempFilterValueRef.current = e.target.value}
            onKeyDown={(e) => e.key === 'Enter' && handleApplyColumnFilter()}
            sx={{ mb: 2 }}
          />
          <Stack direction="row" justifyContent="flex-end" spacing={1.5}>
            <Button 
              size="small" 
              variant="outlined"
              onClick={() => setFilterMenuAnchor(null)}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              Cancel
            </Button>
            <Button 
              size="small" 
              variant="contained" 
              onClick={handleApplyColumnFilter}
              disableElevation
              sx={{ textTransform: 'none', fontWeight: 700 }}
            >
              Apply Filter
            </Button>
          </Stack>
        </Box>
      </Popover>
    </PageContainer>
  );
};

export default DataTableScreen;
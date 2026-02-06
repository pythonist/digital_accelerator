import React, { useEffect, useMemo, useState } from 'react';
import { Autocomplete, Box, CircularProgress, TextField, Typography } from '@mui/material';
import { useMuleStore } from '../store/muleStore';

const AccountSelector = ({ dense = true, multiple = false }) => {
  const {
    hasData,
    accounts,
    loadingAccounts,
    accountsError,
    selectedAccountId,
    selectedAccountIds,
    setSelectedAccountId,
    setSelectedAccountIds,
    loadAccounts
  } = useMuleStore();

  const [input, setInput] = useState('');

  useEffect(() => {
    if (!hasData) return;
    if (accounts.length) return;
    loadAccounts();
  }, [hasData, accounts.length, loadAccounts]);

  const options = useMemo(() => accounts.map((a) => a.account_id), [accounts]);

  const value = multiple ? (selectedAccountIds || []) : selectedAccountId || null;

  return (
    <Box sx={{ minWidth: dense ? 260 : 340 }}>
      <Autocomplete
        multiple={multiple}
        size={dense ? 'small' : 'medium'}
        options={options}
        value={value}
        onChange={(_e, v) => {
          if (multiple) {
            setSelectedAccountIds(Array.isArray(v) ? v : []);
          } else {
            setSelectedAccountId(v || '');
          }
        }}
        inputValue={input}
        onInputChange={(_e, v) => setInput(v)}
        renderInput={(params) => (
          <TextField
            {...params}
            label={multiple ? 'Accounts' : 'Account'}
            placeholder={hasData ? (multiple ? 'Select accounts' : 'Select account') : 'Upload data first'}
            disabled={!hasData}
            InputProps={{
              ...params.InputProps,
              endAdornment: (
                <>
                  {loadingAccounts ? <CircularProgress color="inherit" size={16} /> : null}
                  {params.InputProps.endAdornment}
                </>
              )
            }}
          />
        )}
      />
      {accountsError ? (
        <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>
          {accountsError}
        </Typography>
      ) : null}
    </Box>
  );
};

export default AccountSelector;

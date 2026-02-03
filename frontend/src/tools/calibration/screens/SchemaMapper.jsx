import React, { useState, useEffect } from 'react';

const SchemaMapper = ({ envId }) => {
  const [loading, setLoading] = useState(false);
  const [schemaData, setSchemaData] = useState(null); // Source columns from CSV
  const [canonicalFields, setCanonicalFields] = useState(null); // Target fields (standard)
  const [mapping, setMapping] = useState({ transactions: {}, accounts: {}, customers: {} });
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Adjust this base URL to match your proxy or backend location
  const API_BASE = '/api/v2/calibration/data';

  useEffect(() => {
    if (envId) fetchMappingData();
  }, [envId]);

  const fetchMappingData = async () => {
    setLoading(true);
    setError('');
    try {
      // 1. Get Options (Source Columns & Canonical definitions)
      const optionsRes = await fetch(`${API_BASE}/mapping/options?env_id=${envId}`);
      const optionsData = await optionsRes.json();
      
      if (!optionsData.success) throw new Error(optionsData.error);
      
      setSchemaData(optionsData.source_columns);
      setCanonicalFields(optionsData.canonical_fields);

      // 2. Get Existing Mapping (if saved previously)
      const mapRes = await fetch(`${API_BASE}/mapping?env_id=${envId}`);
      const mapData = await mapRes.json();
      
      if (mapData.mapping) {
        setMapping(mapData.mapping);
      }
    } catch (err) {
      setError(err.message || 'Failed to load schema data');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectionChange = (table, fieldKey, value) => {
    setMapping(prev => ({
      ...prev,
      [table]: {
        ...prev[table],
        [fieldKey]: value
      }
    }));
  };

  const handleSave = async () => {
    setError('');
    setSuccessMsg('');
    
    // Simple Validation: Check required fields
    for (const table in canonicalFields) {
      for (const field of canonicalFields[table]) {
        if (field.required && !mapping[table]?.[field.key]) {
          setError(`Missing required field: ${table} -> ${field.label}`);
          return;
        }
      }
    }

    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/mapping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ env_id: envId, mapping })
      });
      const data = await res.json();
      
      if (data.success) {
        setSuccessMsg('Mapping saved successfully!');
      } else {
        throw new Error(data.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleBuildGolden = async () => {
    if (!window.confirm("Ready to build the Golden Dataset? This may take a moment.")) return;
    
    setError('');
    setSuccessMsg('');
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/build-golden`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ env_id: envId })
      });
      const data = await res.json();
      
      if (data.success) {
        setSuccessMsg(`Build Complete! ${data.result.row_count.toLocaleString()} rows created.`);
      } else {
        throw new Error(data.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!schemaData || !canonicalFields) {
    return (
      <div className="p-4 text-center">
        {loading ? <div className="spinner-border text-primary" /> : <button className="btn btn-primary" onClick={fetchMappingData}>Load Schema</button>}
        {error && <div className="text-danger mt-2">{error}</div>}
      </div>
    );
  }

  return (
    <div className="container-fluid p-3">
      <h3>Data Mapping Configuration</h3>
      
      {error && <div className="alert alert-danger">{error}</div>}
      {successMsg && <div className="alert alert-success">{successMsg}</div>}

      <div className="row">
        {['transactions', 'accounts', 'customers'].map(table => (
          <div key={table} className="col-md-4 mb-4">
            <div className="card h-100">
              <div className="card-header bg-light font-weight-bold text-uppercase d-flex justify-content-between">
                <span>{table}</span>
                <span className={`badge ${schemaData[table]?.length ? 'bg-primary' : 'bg-danger'}`}>
                  {schemaData[table]?.length || 0} Columns
                </span>
              </div>
              <div className="card-body" style={{ maxHeight: '600px', overflowY: 'auto' }}>
                {(!schemaData[table] || schemaData[table].length === 0) ? (
                  <div className="text-muted small text-center p-3">
                    No data uploaded for this table.
                  </div>
                ) : (
                  canonicalFields[table]?.map(field => (
                    <div key={field.key} className="mb-3 border-bottom pb-2">
                      <label className="d-block small font-weight-bold mb-1">
                        {field.label} {field.required && <span className="text-danger">*</span>}
                      </label>
                      <select 
                        className="form-control form-control-sm"
                        value={mapping[table]?.[field.key] || ''}
                        onChange={(e) => handleSelectionChange(table, field.key, e.target.value)}
                        style={{ borderColor: (field.required && !mapping[table]?.[field.key]) ? '#dc3545' : '' }}
                      >
                        <option value="">-- Select Source Column --</option>
                        {schemaData[table].map(col => (
                          <option key={col} value={col}>{col}</option>
                        ))}
                      </select>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="d-flex justify-content-end mt-3 border-top pt-3">
        <button 
          className="btn btn-primary mr-2" 
          onClick={handleSave} 
          disabled={loading}
        >
          {loading ? 'Saving...' : 'Save Mapping'}
        </button>
        
        <button 
          className="btn btn-success" 
          onClick={handleBuildGolden}
          disabled={loading}
          style={{ marginLeft: '10px' }}
        >
          {loading ? 'Processing...' : 'Build Golden Dataset'}
        </button>
      </div>
    </div>
  );
};

export default SchemaMapper;
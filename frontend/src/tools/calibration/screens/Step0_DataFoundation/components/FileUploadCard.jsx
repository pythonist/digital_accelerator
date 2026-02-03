// ============================================================================
// frontend/tools/calibration/screens/Step0_DataFoundation/components/FileUploadCard.jsx
// ============================================================================
import React, { useState, useRef } from 'react';
import {
  Card, CardContent, Box, Typography, Button, TextField,
  LinearProgress, Stack, alpha
} from '@mui/material';
import { CloudUpload, Description } from '@mui/icons-material';

const FileUploadCard = ({ onUpload, uploading, disabled }) => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [datasetName, setDatasetName] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (file) => {
    if (file && file.name.endsWith('.csv')) {
      setSelectedFile(file);
      // Auto-populate dataset name from filename
      if (!datasetName) {
        const name = file.name.replace('.csv', '').replace(/[_-]/g, ' ');
        setDatasetName(name);
      }
    } else {
      alert('Please select a CSV file');
    }
  };

  const handleFileInputChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelect(e.target.files[0]);
    }
  };

  const handleUploadClick = () => {
    if (selectedFile) {
      onUpload(selectedFile, datasetName);
      // Reset form
      setSelectedFile(null);
      setDatasetName('');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const formatFileSize = (bytes) => {
    const mb = bytes / (1024 * 1024);
    return mb < 1 ? `${(bytes / 1024).toFixed(1)} KB` : `${mb.toFixed(2)} MB`;
  };

  return (
    <Card 
      elevation={2}
      sx={{
        border: dragActive ? '2px dashed #ea580c' : '2px dashed #cbd5e1',
        bgcolor: dragActive ? alpha('#ea580c', 0.05) : '#fff',
        transition: 'all 0.2s'
      }}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
    >
      <CardContent>
        {uploading && <LinearProgress sx={{ mb: 2 }} />}

        {/* File Selection Area */}
        <Box 
          sx={{ 
            textAlign: 'center', 
            py: 4,
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.6 : 1
          }}
          onClick={() => !disabled && fileInputRef.current?.click()}
        >
          <CloudUpload 
            sx={{ 
              fontSize: 56, 
              color: selectedFile ? '#ea580c' : '#94a3b8',
              mb: 2
            }} 
          />
          
          {!selectedFile ? (
            <>
              <Typography variant="h6" fontWeight={600} sx={{ color: '#0f172a', mb: 1 }}>
                Upload CSV File
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Drag and drop or click to browse
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Any CSV format • No size limit
              </Typography>
            </>
          ) : (
            <Box>
              <Description sx={{ fontSize: 40, color: '#ea580c', mb: 1 }} />
              <Typography variant="subtitle1" fontWeight={600} sx={{ color: '#0f172a' }}>
                {selectedFile.name}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {formatFileSize(selectedFile.size)}
              </Typography>
            </Box>
          )}
        </Box>

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          onChange={handleFileInputChange}
          style={{ display: 'none' }}
          disabled={disabled}
        />

        {/* Dataset Name Input */}
        {selectedFile && (
          <Box sx={{ mt: 3 }}>
            <TextField
              fullWidth
              label="Dataset Name (Optional)"
              value={datasetName}
              onChange={(e) => setDatasetName(e.target.value)}
              placeholder="e.g., Customer Transactions"
              helperText="Leave blank to use filename"
              disabled={disabled}
              size="small"
            />

            {/* Upload Button */}
            <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
              <Button
                variant="outlined"
                onClick={() => {
                  setSelectedFile(null);
                  setDatasetName('');
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
                disabled={uploading}
                sx={{ borderColor: '#cbd5e1', color: '#64748b' }}
              >
                Cancel
              </Button>
              <Button
                variant="contained"
                onClick={handleUploadClick}
                disabled={uploading || !selectedFile}
                startIcon={<CloudUpload />}
                sx={{ 
                  bgcolor: '#ea580c',
                  '&:hover': { bgcolor: '#c2410c' },
                  flex: 1
                }}
              >
                {uploading ? 'Uploading...' : 'Upload Dataset'}
              </Button>
            </Stack>
          </Box>
        )}
      </CardContent>
    </Card>
  );
};

export default FileUploadCard;
/**
 * PickleUploadCard.jsx
 * Upload an existing .pkl model to skip training entirely.
 * Calls autoPilotApi.uploadModel(formData) — real API, no mocks.
 * Uses MUI icons only. Zero emojis.
 */
import React, { useRef, useState } from "react";
import {
  Box, Button, CircularProgress, Stack, TextField, Typography, Alert,
} from "@mui/material";
import { CloudUpload, CheckCircle, Inventory2 } from "@mui/icons-material";
import autoPilotApi from "../utils/autoPilotApi";

const PWC = {
  orange:      "#D04A02",
  orangeDark:  "#A83A00",
  orangeLight: "#FFF1EB",
  cloud:       "#E0D8D0",
  cream:       "#FAF8F5",
  ink:         "#1B1B1B",
  slate:       "#555555",
  fog:         "#777777",
  mist:        "#999999",
  silver:      "#BBBBBB",
  white:       "#FFFFFF",
  success:     "#1A6B3A",
  successBg:   "#EDF7F1",
  successBd:   "#B2DFCC",
};

const body = "'Helvetica Neue','Arial',sans-serif";

const PickleUploadCard = ({ onUploaded }) => {
  const inputRef = useRef(null);

  const [file,       setFile]       = useState(null);
  const [modelName,  setModelName]  = useState("");
  const [target,     setTarget]     = useState("");
  const [threshold,  setThreshold]  = useState("0.5");
  const [notes,      setNotes]      = useState("");
  const [uploading,  setUploading]  = useState(false);
  const [result,     setResult]     = useState(null);
  const [error,      setError]      = useState(null);

  const pick = e => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setModelName(f.name.replace(/\.pkl$/i, ""));
    setError(null);
    setResult(null);
  };

  const upload = async () => {
    if (!file) return;
    setUploading(true); setError(null);
    try {
      const fd = new FormData();
      fd.append("file",          file);
      fd.append("model_name",    modelName || file.name.replace(/\.pkl$/i, ""));
      fd.append("target_column", target);
      fd.append("threshold",     threshold);
      fd.append("notes",         notes);
      const res  = await autoPilotApi.uploadModel(fd);
      const data = res?.data?.data ?? res?.data ?? res;
      setResult(data);
      onUploaded?.(data);
    } catch (e) {
      setError(e?.response?.data?.error || "Upload failed — ensure the file is a valid sklearn .pkl.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, mb: 1.25 }}>
        <Inventory2 sx={{ fontSize: 16, color: PWC.orange }} />
        <Box>
          <Typography sx={{ fontSize: 12, fontWeight: 700, color: PWC.ink, fontFamily: body }}>
            Already have a model?
          </Typography>
          <Typography sx={{ fontSize: 10.5, color: PWC.fog, fontFamily: body }}>
            Upload a .pkl file and skip training entirely.
          </Typography>
        </Box>
      </Box>

      {result ? (
        /* Success state */
        <Box sx={{ p: "10px 12px", background: PWC.successBg, border: `1px solid ${PWC.successBd}`, borderLeft: `3px solid ${PWC.success}` }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
            <CheckCircle sx={{ fontSize: 14, color: PWC.success }} />
            <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: PWC.success, fontFamily: body }}>
              Model uploaded successfully
            </Typography>
          </Box>
          <Typography sx={{ fontSize: 10.5, color: PWC.slate, fontFamily: body }}>
            {result.model_meta?.type && `Type: ${result.model_meta.type}`}
            {result.model_meta?.n_features && ` · ${result.model_meta.n_features} features`}
            {" · Ready to deploy."}
          </Typography>
          <Button
            size="small"
            onClick={() => { setResult(null); setFile(null); }}
            sx={{ mt: 0.75, fontSize: 10, textTransform: "none", color: PWC.orange, p: 0, fontFamily: body }}
          >
            Upload another
          </Button>
        </Box>
      ) : (
        <>
          {/* Drop zone */}
          <Box
            onClick={() => inputRef.current?.click()}
            sx={{
              border: `1.5px dashed ${file ? PWC.orange : PWC.cloud}`,
              bgcolor: file ? PWC.orangeLight : PWC.cream,
              p: "14px 10px", textAlign: "center",
              cursor: "pointer", mb: 1.25,
              transition: "all 0.15s",
              "&:hover": { borderColor: PWC.orange, bgcolor: PWC.orangeLight },
            }}
          >
            <input ref={inputRef} type="file" accept=".pkl" style={{ display: "none" }} onChange={pick} />
            <CloudUpload sx={{ fontSize: 22, color: file ? PWC.orange : PWC.silver, mb: 0.5 }} />
            <Typography sx={{ fontSize: 11, color: file ? PWC.orange : PWC.mist, fontWeight: file ? 700 : 400, fontFamily: body }}>
              {file ? file.name : "Click to select a .pkl file"}
            </Typography>
          </Box>

          {/* Fields — shown once file is selected */}
          {file && (
            <Stack spacing={0.875} sx={{ mb: 1.25 }}>
              <Stack direction="row" spacing={0.75}>
                <TextField
                  size="small" label="Model name" value={modelName}
                  onChange={e => setModelName(e.target.value)} sx={{ flex: 1 }}
                  InputProps={{ sx: { fontFamily: body, fontSize: 12 } }}
                  InputLabelProps={{ sx: { fontSize: 11 } }}
                />
                <TextField
                  size="small" label="Target column" placeholder="e.g. is_fraud"
                  value={target} onChange={e => setTarget(e.target.value)} sx={{ flex: 1 }}
                  InputProps={{ sx: { fontFamily: body, fontSize: 12 } }}
                  InputLabelProps={{ sx: { fontSize: 11 } }}
                />
                <TextField
                  size="small" label="Threshold" type="number"
                  inputProps={{ min: 0, max: 1, step: 0.05 }}
                  value={threshold} onChange={e => setThreshold(e.target.value)} sx={{ width: 95 }}
                  InputProps={{ sx: { fontFamily: body, fontSize: 12 } }}
                  InputLabelProps={{ sx: { fontSize: 11 } }}
                />
              </Stack>
              <TextField
                size="small" label="Notes (optional)" value={notes}
                onChange={e => setNotes(e.target.value)} fullWidth
                InputProps={{ sx: { fontFamily: body, fontSize: 12 } }}
                InputLabelProps={{ sx: { fontSize: 11 } }}
              />
            </Stack>
          )}

          {error && (
            <Alert severity="error" sx={{ mb: 1.25, fontSize: 11, borderRadius: 0 }}>{error}</Alert>
          )}

          <Button
            fullWidth
            disabled={!file || uploading}
            onClick={upload}
            startIcon={uploading ? <CircularProgress size={13} sx={{ color: PWC.white }} /> : <CloudUpload />}
            sx={{
              textTransform: "none", fontWeight: 700, fontSize: 11.5,
              fontFamily: body, borderRadius: 0,
              bgcolor: file && !uploading ? PWC.orange : "transparent",
              color:   file && !uploading ? PWC.white  : PWC.silver,
              border: `1px solid ${file && !uploading ? PWC.orange : PWC.cloud}`,
              "&:hover": { bgcolor: file && !uploading ? PWC.orangeDark : "transparent" },
              "&.Mui-disabled": { bgcolor: "transparent", color: PWC.silver, borderColor: PWC.cloud },
            }}
          >
            {uploading ? "Uploading…" : "Upload & Register Model"}
          </Button>
        </>
      )}
    </Box>
  );
};

export default PickleUploadCard;
/**
 * PipelineDAG.jsx
 * Pipeline step tracker - MUI icons only, zero emojis.
 * PwC color system: orange (#D04A02) on active/done nodes.
 *
 * step shape: { id, status, label?, message?, result? }
 * status values: pending | running | done | error | skipped
 */
import React from "react";
import { Box, Typography, CircularProgress } from "@mui/material";
import {
  MergeType,
  TrackChanges,
  CleaningServices,
  Psychology,
  BarChart,
  AppRegistration,
  Storage,
  CheckCircle,
  Cancel,
} from "@mui/icons-material";
import { FCC_THEME } from "../../theme/fccWorkbenchTheme";

const PWC = {
  orange:      FCC_THEME.accent,
  orangeDark:  FCC_THEME.accentHover,
  orangeLight: FCC_THEME.accentSoft,
  cloud:       FCC_THEME.border,
  cream:       FCC_THEME.panelAlt,
  smoke:       FCC_THEME.panelMuted,
  ink:         FCC_THEME.textStrong,
  slate:       FCC_THEME.textMuted,
  fog:         FCC_THEME.textMuted,
  mist:        FCC_THEME.textSoft,
  silver:      FCC_THEME.textSoft,
  white:       FCC_THEME.panel,
  success:     FCC_THEME.success,
  error:       FCC_THEME.error,
  errorBg:     FCC_THEME.errorBg,
  errorBd:     FCC_THEME.errorBorder,
};

// Step ID → MUI Icon + plain English labels
const META = {
  master:     { label: "Combine Data",    sub: "Merging all tables into one view",        Icon: MergeType        },
  target:     { label: "What to Predict", sub: "Defining the outcome to model",           Icon: TrackChanges     },
  preprocess: { label: "Clean & Prepare", sub: "Fixing gaps and standardising formats",   Icon: CleaningServices },
  train:      { label: "Train Model",     sub: "Learning patterns from history",          Icon: Psychology       },
  validate:   { label: "Check Accuracy",  sub: "Testing on unseen data",                  Icon: BarChart         },
  register:   { label: "Save Model",      sub: "Locking the model for deployment",        Icon: AppRegistration  },
};

// Per-status visual config
const ST = {
  pending: { bg: PWC.cream,        border: PWC.cloud,       iconCol: PWC.silver, textCol: PWC.mist,  whiteText: false },
  running: { bg: PWC.orangeLight,  border: PWC.orange,      iconCol: PWC.orange, textCol: PWC.ink,   whiteText: false, glow: true },
  done:    { bg: PWC.orange,       border: PWC.orangeDark,  iconCol: PWC.white,  textCol: PWC.white, whiteText: true  },
  error:   { bg: PWC.errorBg,      border: PWC.error,       iconCol: PWC.error,  textCol: PWC.error, whiteText: false },
  skipped: { bg: PWC.smoke,        border: PWC.cloud,       iconCol: PWC.silver, textCol: PWC.mist,  whiteText: false },
};

const ORDER = ["master", "target", "preprocess", "train", "validate", "register"];

const Node = ({ step, idx, isLast }) => {
  const meta      = META[step.id] || { label: step.label || step.id, sub: "", Icon: Storage };
  const st        = ST[step.status] || ST.pending;
  const { Icon }  = meta;
  const isRunning = step.status === "running";
  const isDone    = step.status === "done";
  const isError   = step.status === "error";

  return (
    <Box sx={{ display: "flex", alignItems: "flex-start", flex: 1, minWidth: 0 }}>
      {/* ── Node ── */}
      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "stretch", flex: 1, minWidth: 0 }}>
        <Box sx={{
          border: `1.5px solid ${st.border}`,
          bgcolor: st.bg,
          p: "11px 11px 10px",
          position: "relative",
          transition: "all 0.25s ease",
          boxShadow: st.glow ? `0 0 0 4px ${PWC.orange}18` : "none",
        }}>
          {/* Pulse ring on running */}
          {isRunning && (
            <Box sx={{
              position: "absolute", inset: -4,
              border: `1.5px solid ${PWC.orange}`,
              opacity: 0.45,
              animation: "dagPulse 1.5s ease-in-out infinite",
              pointerEvents: "none",
            }} />
          )}

          {/* Top row: icon + step number */}
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 0.875 }}>
            {/* Status icon */}
            {isDone    && <CheckCircle sx={{ fontSize: 17, color: PWC.white }} />}
            {isError   && <Cancel      sx={{ fontSize: 17, color: PWC.error }} />}
            {isRunning && <CircularProgress size={15} sx={{ color: PWC.orange }} />}
            {!isDone && !isError && !isRunning && (
              <Icon sx={{ fontSize: 17, color: st.iconCol }} />
            )}

            {/* Numbered badge */}
            <Box sx={{
              width: 17, height: 17, flexShrink: 0,
              bgcolor: isDone ? "rgba(255,255,255,0.2)" : `${st.border}22`,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Typography sx={{ fontSize: 9, fontWeight: 700, lineHeight: 1, color: isDone ? PWC.white : st.iconCol }}>
                {idx + 1}
              </Typography>
            </Box>
          </Box>

          {/* Label */}
          <Typography sx={{
            fontSize: 10.5, fontWeight: 700, lineHeight: 1.3, mb: 0.4,
            color: st.textCol,
            fontFamily: "'Helvetica Neue','Arial',sans-serif",
          }}>
            {meta.label}
          </Typography>

          {/* Sub-label / live message */}
          <Typography sx={{
            fontSize: 9.5, lineHeight: 1.4,
            color: isDone ? "rgba(255,255,255,0.75)" : PWC.fog,
            fontFamily: "'Helvetica Neue','Arial',sans-serif",
          }}>
            {step.message || meta.sub}
          </Typography>

          {/* AUC chip on done train node */}
          {isDone && step.result?._auc && (
            <Box sx={{ mt: 0.75, px: 0.75, py: "2px", bgcolor: "rgba(255,255,255,0.18)" }}>
              <Typography sx={{ fontSize: 8.5, color: PWC.white, fontWeight: 700 }}>
                AUC {(step.result._auc * 100).toFixed(1)}%
              </Typography>
            </Box>
          )}

          {/* Error message chip */}
          {isError && step.message && (
            <Box sx={{ mt: 0.75, px: 0.75, py: "2px", bgcolor: PWC.errorBg, border: `1px solid ${PWC.errorBd}` }}>
              <Typography sx={{ fontSize: 8.5, color: PWC.error }}>{step.message}</Typography>
            </Box>
          )}
        </Box>
      </Box>

      {/* ── Connector arrow ── */}
      {!isLast && (
        <Box sx={{ display: "flex", alignItems: "center", pt: "26px", flexShrink: 0, width: 18, mx: "1px" }}>
          <Box sx={{ flex: 1, height: 1.5, bgcolor: isDone ? PWC.orange : PWC.cloud }} />
          <Box sx={{
            width: 0, height: 0,
            borderTop: "4px solid transparent",
            borderBottom: "4px solid transparent",
            borderLeft: `5px solid ${isDone ? PWC.orange : PWC.cloud}`,
          }} />
        </Box>
      )}
    </Box>
  );
};

const PipelineDAG = ({ steps }) => {
  if (!steps?.length) return null;
  return (
    <>
      <style>{`
        @keyframes dagPulse {
          0%,100% { opacity:.3; transform:scale(1);    }
          50%      { opacity:.7; transform:scale(1.03); }
        }
      `}</style>
      <Box sx={{ display: "flex", alignItems: "flex-start", overflowX: "auto", pb: 1 }}>
        {steps.map((step, i) => (
          <Node key={step.id} step={step} idx={i} isLast={i === steps.length - 1} />
        ))}
      </Box>
    </>
  );
};

export default PipelineDAG;

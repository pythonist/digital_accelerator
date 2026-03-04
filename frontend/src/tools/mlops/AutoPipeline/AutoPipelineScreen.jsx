/**
 * AutoPipelineScreen.jsx
 * PwC Risk & Compliance — Model Builder
 *
 * NOTE: NO NAVBAR rendered here. This component lives inside the app shell
 *     which already provides the top navigation.
 *
 * ── REAL API WIRING ──────────────────────────────────────────────────────────
 *  usePipelineRun.startRun()  → POST /api/mlops/autopilot/run
 *  usePipelineRun (polling)   → GET  /api/mlops/autopilot/status/:runId
 *  autoPilotApi.deploy()      → POST /api/mlops/autopilot/deploy/:runId
 *  mlopsApi.listDatasets()    → dataset list on mount → StepData
 *  mlopsApi.schemaPreview()   → called internally by StepTarget
 *  autoPilotApi.uploadModel() → called internally by PickleUploadCard
 *
 * ── PwC COLORS ───────────────────────────────────────────────────────────────
 *  #D04A02  PwC Orange — ALL primary actions, borders, active tabs, progress
 *  #FFB600  PwC Gold   — warnings only
 *  #1B1B1B  Near-black — strong headings, running banner background
 *  #F5F0EB  Parchment  — page canvas
 */

import React, { useState, useEffect, useCallback, useMemo } from "react";
import usePipelineRun   from "./hooks/usePipelineRun";
import autoPilotApi     from "./utils/autoPilotApi";
import mlopsApi         from "../services/mlopsApi";
import StepData         from "./steps/StepData";
import StepTarget       from "./steps/StepTarget";
import StepGoal         from "./steps/StepGoal";
import PipelineDAG      from "./components/PipelineDAG";
import ResultsPanel     from "./components/ResultsPanel";
import PickleUploadCard from "./components/PickleUploadCard";

// ─── PwC tokens ───────────────────────────────────────────────────────────────
const C = {
  orange:      "#D04A02",
  orangeDark:  "#A83A00",
  orangeLight: "#FFF1EB",
  gold:        "#FFB600",
  ink:         "#1B1B1B",
  steel:       "#3D3D3D",
  slate:       "#3F3F3F",
  fog:         "#5A5A5A",
  mist:        "#6B6B6B",
  silver:      "#BBBBBB",
  cloud:       "#E0D8D0",
  smoke:       "#EDE6DE",
  parchment:   "#F5F0EB",
  cream:       "#FAF8F5",
  white:       "#FFFFFF",
  success:     "#1A6B3A",
  successBg:   "#EDF7F1",
  successBd:   "#B2DFCC",
  error:       "#8B1A1A",
  errorBg:     "#FDF0F0",
  errorBd:     "#F0BEBE",
  warning:     "#7A5100",
  warningBg:   "#FFFBF0",
  warningBd:   "#F0D88A",
};

const serif = "'Georgia','Times New Roman',serif";
const body  = "'Helvetica Neue','Arial',sans-serif";
const mono  = "'Courier New',monospace";

const PIPELINE_ARTEFACT_TYPES = new Set([
  "master_dataset",
  "master",
  "preprocessed_dataset",
  "preprocessed",
  "model_output",
  "model_dataset",
  "scored_dataset",
  "feature_store",
]);

const normalizeType = (value) => String(value || "").trim().toLowerCase();
const shortRunId = (value) => String(value || "").slice(0, 8) || "n/a";
const formatRunTime = (value) => {
  if (!value) return "-";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
};

const STATUS_CHIP = {
  pending: { bg: "#fff7ed", bd: "#fed7aa", fg: "#9a3412", label: "Pending" },
  running: { bg: "#fff1ec", bd: "#f2c8b5", fg: "#A83A00", label: "Running" },
  done: { bg: "#edf7f1", bd: "#b2dfcc", fg: "#1A6B3A", label: "Done" },
  error: { bg: "#fdf0f0", bd: "#f0bebe", fg: "#8B1A1A", label: "Error" },
  skipped: { bg: "#f8fafc", bd: "#e2e8f0", fg: "#475569", label: "Skipped" },
};

// ─── Wizard steps ────────────────────────────────────────────────────────────
const STEPS = [
  { id: "data",    label: "Data Sources"   },
  { id: "target",  label: "Target Column"  },
  { id: "goal",    label: "Operating Mode" },
  { id: "confirm", label: "Confirm"        },
];

// ─── Skeleton DAG before run starts ─────────────────────────────────────────
const SKELETON = [
  { id: "master",     status: "pending", label: "Combine Data"    },
  { id: "target",     status: "pending", label: "What to Predict" },
  { id: "preprocess", status: "pending", label: "Clean & Prepare" },
  { id: "train",      status: "pending", label: "Train Model"     },
  { id: "validate",   status: "pending", label: "Check Accuracy"  },
  { id: "register",   status: "pending", label: "Save Model"      },
];

// ─── Atoms ───────────────────────────────────────────────────────────────────
const Eyebrow = ({ children, s = {} }) => (
  <div style={{ fontFamily: body, fontSize: 9, fontWeight: 700, letterSpacing: "0.13em", textTransform: "uppercase", color: C.mist, ...s }}>
    {children}
  </div>
);

const OrangeRule = () => (
  <div style={{ width: 18, height: 2, background: C.orange, flexShrink: 0 }} />
);

const SectionLabel = ({ text, s = {} }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 9, ...s }}>
    <OrangeRule />
    <Eyebrow s={{ color: C.slate }}>{text}</Eyebrow>
  </div>
);

// ─── Wizard tabs ─────────────────────────────────────────────────────────────
const WizardTabs = ({ current, onGoTo }) => (
  <div style={{ display: "flex", borderBottom: `1px solid ${C.cloud}` }}>
    {STEPS.map((s, i) => {
      const active = i === current;
      const past   = i < current;
      return (
        <div
          key={s.id}
          onClick={() => past && onGoTo(i)}
          style={{
            flex: 1, paddingBottom: 10, paddingTop: 4,
            borderBottom: `3px solid ${active ? C.orange : past ? C.steel : "transparent"}`,
            cursor: past ? "pointer" : "default",
          }}
        >
          <Eyebrow s={{ fontSize: 8.5, color: active ? C.orange : past ? C.steel : C.silver }}>
            {s.label}
          </Eyebrow>
        </div>
      );
    })}
  </div>
);

// ─── Running banner ───────────────────────────────────────────────────────────
const RunBanner = ({ step }) => {
  if (!step) return null;
  return (
    <div style={{
      background: C.ink, padding: "13px 18px", marginBottom: 14,
      display: "flex", alignItems: "center", gap: 13,
    }}>
      {/* CSS spinner — no emoji */}
      <div style={{
        width: 16, height: 16, borderRadius: "50%", flexShrink: 0,
        border: `2px solid rgba(208,74,2,0.25)`, borderTopColor: C.orange,
        animation: "apSpin 0.85s linear infinite",
      }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: body, fontSize: 11.5, fontWeight: 700, color: C.white, marginBottom: 2 }}>
          {step.label || step.id}
        </div>
        <div style={{ fontFamily: body, fontSize: 11, color: C.fog, lineHeight: 1.4 }}>
          {step.message || step.businessAction || "Processing…"}
        </div>
      </div>
      {/* Pulsing dots */}
      <div style={{ display: "flex", gap: 4 }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            width: 5, height: 5, borderRadius: "50%", background: C.orange,
            animation: `apDot 1.2s ease-in-out ${i * 0.2}s infinite`,
          }} />
        ))}
      </div>
    </div>
  );
};

// ─── Completed log ────────────────────────────────────────────────────────────
const DoneLog = ({ steps }) => {
  const done = steps.filter(s => s.status === "done");
  if (!done.length) return null;
  return (
    <div style={{ border: `1px solid ${C.cloud}`, background: C.white, marginTop: 14 }}>
      <div style={{ padding: "9px 14px", background: C.parchment, borderBottom: `1px solid ${C.cloud}`, display: "flex", alignItems: "center", gap: 9 }}>
        <OrangeRule />
        <Eyebrow s={{ color: C.slate }}>Completed Stages</Eyebrow>
      </div>
      {done.map(step => (
        <div key={step.id} style={{ padding: "9px 14px", borderBottom: `1px solid ${C.cloud}`, display: "flex", alignItems: "center", gap: 10 }}>
          {/* SVG checkmark — no emoji */}
          <div style={{ width: 16, height: 16, background: C.successBg, border: `1px solid ${C.successBd}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
              <path d="M1 3.5L3.5 6L8 1" stroke={C.success} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <div style={{ fontFamily: body, fontSize: 11.5, fontWeight: 600, color: C.ink }}>
              {step.label || step.id}
            </div>
            <div style={{ fontFamily: body, fontSize: 11, color: C.slate }}>
              {step.message || step.result?.headline || "Complete"}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

const RunLogsPanel = ({ logs = [] }) => {
  const rows = Array.isArray(logs) ? logs.slice(-40).reverse() : [];
  if (!rows.length) return null;
  return (
    <div style={{ border: `1px solid ${C.cloud}`, background: C.white, marginTop: 14 }}>
      <div style={{ padding: "9px 14px", background: C.parchment, borderBottom: `1px solid ${C.cloud}`, display: "flex", alignItems: "center", gap: 9 }}>
        <OrangeRule />
        <Eyebrow s={{ color: C.slate }}>Execution Logs</Eyebrow>
      </div>
      <div style={{ maxHeight: 210, overflow: "auto" }}>
        {rows.map((entry, idx) => (
          <div
            key={`${entry?.timestamp || idx}_${idx}`}
            style={{
              padding: "8px 14px",
              borderBottom: `1px solid ${C.cloud}`,
              fontFamily: mono,
              fontSize: 10.5,
              color: C.slate,
              lineHeight: 1.5,
              background: idx % 2 === 0 ? C.white : C.cream,
            }}
          >
            <span style={{ color: C.fog }}>
              [{formatRunTime(entry?.timestamp)}]
            </span>
            {" "}
            <span style={{ color: C.ink, fontWeight: 700 }}>
              {String(entry?.level || "info").toUpperCase()}
            </span>
            {entry?.step_id ? <span style={{ color: C.fog }}> ({entry.step_id})</span> : null}
            {" "}
            {entry?.message || ""}
          </div>
        ))}
      </div>
    </div>
  );
};

const RunHistoryCard = ({ runId, runHistory, loading, error, onRefresh }) => {
  const rows = Array.isArray(runHistory) ? runHistory.slice(0, 6) : [];
  return (
    <div style={{ border: `1px solid ${C.cloud}`, background: C.white, marginBottom: 14 }}>
      <div
        style={{
          padding: "9px 14px",
          background: C.parchment,
          borderBottom: `1px solid ${C.cloud}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <OrangeRule />
          <Eyebrow s={{ color: C.slate }}>Run Tracking</Eyebrow>
        </div>
        <button
          onClick={onRefresh}
          style={{
            padding: "4px 10px",
            border: `1px solid ${C.cloud}`,
            background: C.white,
            fontFamily: body,
            fontSize: 10.5,
            fontWeight: 700,
            color: C.slate,
            cursor: "pointer",
          }}
        >
          Refresh
        </button>
      </div>

      <div style={{ padding: "10px 14px", borderBottom: `1px solid ${C.cloud}`, background: C.cream }}>
        <div style={{ fontFamily: body, fontSize: 10.5, color: C.fog, marginBottom: 2 }}>Active Run ID</div>
        <div style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, color: C.ink }}>
          {runId || "No active run"}
        </div>
      </div>

      {loading && (
        <div style={{ padding: "10px 14px", fontFamily: body, fontSize: 11, color: C.fog }}>
          Loading run history...
        </div>
      )}

      {!loading && error && (
        <div style={{ padding: "10px 14px", fontFamily: body, fontSize: 11, color: C.error }}>
          {error}
        </div>
      )}

      {!loading && !error && !rows.length && (
        <div style={{ padding: "10px 14px", fontFamily: body, fontSize: 11, color: C.fog }}>
          No previous AutoPipeline runs found in this environment.
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <div>
          {rows.map((r) => {
            const statusKey = String(r?.status || "pending").toLowerCase();
            const chip = STATUS_CHIP[statusKey] || STATUS_CHIP.pending;
            const isActive = runId && r?.run_id === runId;
            return (
              <div
                key={r?.run_id || `${r?.created_at}_${statusKey}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 14px",
                  borderTop: `1px solid ${C.cloud}`,
                  background: isActive ? C.orangeLight : C.white,
                }}
              >
                <div>
                  <div style={{ fontFamily: mono, fontSize: 11.5, fontWeight: 700, color: C.ink }}>
                    {r?.run_id || "-"}
                  </div>
                  <div style={{ fontFamily: body, fontSize: 10.5, color: C.fog }}>
                    {formatRunTime(r?.created_at)}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      fontFamily: body,
                      fontSize: 10.5,
                      fontWeight: 700,
                      padding: "3px 8px",
                      border: `1px solid ${chip.bd}`,
                      background: chip.bg,
                      color: chip.fg,
                      borderRadius: 999,
                    }}
                  >
                    {chip.label}
                  </span>
                  <span style={{ fontFamily: mono, fontSize: 10.5, color: C.fog }}>
                    #{shortRunId(r?.run_id)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ─── Pre-launch placeholder ───────────────────────────────────────────────────
const Placeholder = () => (
  <div style={{ padding: "44px 32px", textAlign: "center", background: C.white, border: `1px solid ${C.cloud}` }}>
    {/* PwC geometric mark — squares only, no emoji */}
    <div style={{ display: "flex", justifyContent: "center", gap: 5, marginBottom: 20 }}>
      <div style={{ width: 18, height: 18, background: C.orange }} />
      <div style={{ width: 13, height: 13, background: C.gold, marginTop: 3 }} />
      <div style={{ width: 9,  height: 9,  background: C.cloud, marginTop: 5 }} />
    </div>
    <Eyebrow s={{ marginBottom: 10 }}>Awaiting Configuration</Eyebrow>
    <div style={{ fontFamily: body, fontSize: 13, color: C.fog, lineHeight: 1.75, maxWidth: 400, margin: "0 auto" }}>
      Complete the configuration on the left, then click{" "}
      <strong style={{ color: C.steel }}>Start Build</strong> to begin.
      All six stages will execute automatically and produce a full report on completion.
    </div>
  </div>
);

// ─── Error banner ─────────────────────────────────────────────────────────────
const ErrBanner = ({ message, onDismiss }) => (
  <div style={{
    padding: "12px 16px", background: C.errorBg,
    border: `1px solid ${C.errorBd}`, borderLeft: `3px solid ${C.error}`,
    display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10,
  }}>
    <div>
      <div style={{ fontFamily: body, fontSize: 11.5, fontWeight: 700, color: C.error, marginBottom: 3 }}>Build error</div>
      <div style={{ fontFamily: body, fontSize: 11, color: C.slate, lineHeight: 1.5 }}>{message}</div>
    </div>
    {onDismiss && (
      <button onClick={onDismiss} style={{ flexShrink: 0, padding: "4px 10px", background: "transparent", border: `1px solid ${C.errorBd}`, fontFamily: body, fontSize: 11, fontWeight: 600, color: C.error, cursor: "pointer" }}>
        Dismiss
      </button>
    )}
  </div>
);

// ─── Confirm step ────────────────────────────────────────────────────────────
const ConfirmStep = ({ selectedIds, targetColumn, goal, modelName, setModelName }) => {
  const GOAL_MAP = { catch_most: "Prioritise Detection", balanced: "Balanced Operation", minimize_false_alarms: "Efficiency First" };
  const rows = [
    { k: "Data sources",   v: `${selectedIds.length} table${selectedIds.length !== 1 ? "s" : ""}` },
    { k: "Target column",  v: targetColumn || "—", mono: true },
    { k: "Operating mode", v: GOAL_MAP[goal] || goal || "—" },
    { k: "Est. duration",  v: "4 – 8 minutes" },
    { k: "Stages",         v: "6 automated" },
  ];
  return (
    <div>
      <div style={{ fontFamily: body, fontSize: 12, color: C.slate, marginBottom: 16, lineHeight: 1.65 }}>
        Review your configuration. The pipeline runs fully automatically once started — no further input required.
      </div>
      <div style={{ marginBottom: 14 }}>
        <Eyebrow s={{ marginBottom: 5 }}>Model Name</Eyebrow>
        <input
          value={modelName}
          onChange={e => setModelName(e.target.value)}
          style={{
            width: "100%", padding: "8px 10px",
            fontFamily: body, fontSize: 12.5,
            border: `1px solid ${C.cloud}`, borderBottom: `2px solid ${C.orange}`,
            background: C.white, color: C.ink, outline: "none", boxSizing: "border-box",
          }}
        />
      </div>
      <div style={{ border: `1px solid ${C.cloud}`, marginBottom: 13 }}>
        {rows.map(({ k, v, mono: m }, i) => (
          <div key={k} style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "9px 13px",
            background: i % 2 === 0 ? C.white : C.cream,
            borderBottom: i < rows.length - 1 ? `1px solid ${C.cloud}` : "none",
          }}>
            <span style={{ fontFamily: body, fontSize: 11.5, color: C.fog }}>{k}</span>
            <span style={{ fontFamily: m ? mono : body, fontSize: 11.5, fontWeight: 700, color: C.ink }}>{v}</span>
          </div>
        ))}
      </div>
      <div style={{ padding: "10px 13px", background: C.warningBg, border: `1px solid ${C.warningBd}`, borderLeft: `3px solid ${C.gold}` }}>
        <div style={{ fontFamily: body, fontSize: 11, color: C.warning, lineHeight: 1.5 }}>
          The build cannot be interrupted once started. Finalise all settings before proceeding.
        </div>
      </div>
    </div>
  );
};

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function AutoPipelineScreen({ onDeploySuccess }) {
  const [step,          setStep]          = useState(0);
  const [selectedIds,   setSelectedIds]   = useState([]);
  const [targetColumn,  setTargetColumn]  = useState("");
  const [workbenchTarget, setWorkbenchTarget] = useState("");
  const [goal,          setGoal]          = useState("balanced");
  const [modelName,     setModelName]     = useState("Fraud Detection Model");

  const [datasets,      setDatasets]      = useState([]);
  const [dsLoading,     setDsLoading]     = useState(true);
  const [dsError,       setDsError]       = useState(null);
  const [runHistory,    setRunHistory]    = useState([]);
  const [runsLoading,   setRunsLoading]   = useState(false);
  const [runsError,     setRunsError]     = useState(null);

  const { runId, run, error: runErr, startRun, reset: resetRun, cancelRun } = usePipelineRun();
  const [canceling, setCanceling] = useState(false);

  const [deploying,    setDeploying]    = useState(false);
  const [deployErr,    setDeployErr]    = useState(null);

  // Derived
  const currentStatus = String(run?.status || "").toLowerCase();
  const phase = !runId ? "config"
    : currentStatus === "done"  ? "done"
    : currentStatus === "error" || currentStatus === "canceled" || currentStatus === "cancelled" ? "error"
    : "running";

  const liveSteps  = run?.steps ?? [];
  const activeStep = liveSteps.find(s => s.status === "running");
  const doneCount  = liveSteps.filter(s => s.status === "done").length;
  const total      = liveSteps.length || 6;
  const progress   = Math.round((doneCount / total) * 100);

  const canAdvance = i => {
    if (i === 0) return selectedIds.length > 0;
    if (i === 1) return !!targetColumn;
    if (i === 2) return !!goal;
    return true;
  };
  const canLaunch = selectedIds.length > 0 && !!targetColumn && !!goal;

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem("mlops.workbench.v2");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const savedTarget = String(parsed?.targetColumn || "").trim();
      if (!savedTarget) return;
      setWorkbenchTarget(savedTarget);
      setTargetColumn((prev) => prev || savedTarget);
    } catch {
      // ignore localStorage parse/read issues
    }
  }, []);

  const selectedDatasets = useMemo(() => {
    if (!selectedIds.length || !datasets.length) return [];
    const idSet = new Set(selectedIds.map((id) => Number(id)));
    return datasets.filter((d) => idSet.has(Number(d?.dataset_id)));
  }, [selectedIds, datasets]);

  // Load datasets
  useEffect(() => {
    let ok = true;
    mlopsApi.listDatasets()
      .then((r) => {
        if (!ok) return;
        const payload = r?.data ?? r ?? {};
        const all = Array.isArray(payload?.data)
          ? payload.data
          : Array.isArray(payload)
            ? payload
            : [];
        const raw = Array.isArray(payload?.raw)
          ? payload.raw
          : all.filter((d) => !PIPELINE_ARTEFACT_TYPES.has(normalizeType(d?.dataset_type)));
        setDatasets(raw);
      })
      .catch(e => ok && setDsError(e?.response?.data?.error || "Failed to load datasets"))
      .finally(() => ok && setDsLoading(false));
    return () => { ok = false; };
  }, []);

  const loadRunHistory = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setRunsLoading(true);
    setRunsError(null);
    try {
      const res = await autoPilotApi.listRuns();
      const rows = res?.data?.data ?? res?.data ?? res;
      setRunHistory(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setRunsError(e?.response?.data?.error || "Failed to load run history.");
    } finally {
      if (!silent) setRunsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRunHistory();
  }, [loadRunHistory]);

  useEffect(() => {
    if (phase !== "running") return undefined;
    const timer = setInterval(() => {
      loadRunHistory({ silent: true });
    }, 2500);
    return () => clearInterval(timer);
  }, [phase, loadRunHistory]);

  const goNext   = () => canAdvance(step) && setStep(s => s + 1);
  const goTo     = i => phase === "config" && setStep(i);

  const launch   = useCallback(async () => {
    const startedId = await startRun({
      dataset_ids: selectedIds,
      target_column: targetColumn,
      business_goal: goal,
      model_name: modelName,
    });
    if (startedId) {
      loadRunHistory({ silent: true });
    }
  }, [selectedIds, targetColumn, goal, modelName, startRun, loadRunHistory]);

  const deploy   = useCallback(async ({ job_id, threshold } = {}) => {
    if (!runId) return;
    setDeploying(true); setDeployErr(null);
    try {
      await autoPilotApi.deploy(runId, { job_id, threshold });
      onDeploySuccess?.({ runId, modelName, goal });
    } catch (e) {
      setDeployErr(e?.response?.data?.error || "Deployment failed.");
    } finally { setDeploying(false); }
  }, [runId, modelName, goal, onDeploySuccess]);

  const handleCancel = useCallback(async () => {
    if (!runId) return;
    setCanceling(true);
    try {
      await cancelRun();
      await loadRunHistory({ silent: true });
    } finally {
      setCanceling(false);
    }
  }, [runId, cancelRun, loadRunHistory]);

  const reset = useCallback(() => {
    resetRun();
    setStep(0); setSelectedIds([]);
    setTargetColumn(""); setGoal("balanced"); setModelName("Fraud Detection Model");
    setDeployErr(null);
  }, [resetRun]);

  const EYEBROW = { config: "Pipeline Preview", running: "Build in Progress", done: "Build Report", error: "Build Error" }[phase];
  const TITLE   = {
    config:  "6 automated stages will execute in sequence",
    running: `Stage ${doneCount + 1} of ${total} — processing`,
    done:    "Build complete — model ready for deployment",
    error:   "The build encountered an error",
  }[phase];

  return (
    <>
      <style>{`
        @keyframes apSpin { to { transform: rotate(360deg); } }
        @keyframes apDot  { 0%,100%{opacity:.2;transform:scale(.8)} 50%{opacity:1;transform:scale(1.2)} }
        @keyframes apFade { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        *, *::before, *::after { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-thumb { background: ${C.cloud}; border-radius: 3px; }
      `}</style>

      {/*
        ┌─────────────────────────────────────────────────────────────────────┐
        │  height: 100% fills whatever container the app shell provides.      │
        │  Do NOT use height:100vh — the app shell already sets the viewport. │
        └─────────────────────────────────────────────────────────────────────┘
      */}
      <div style={{ display: "flex", height: "100%", minHeight: 0, background: C.parchment, fontFamily: body, overflow: "hidden" }}>

        {/* ══════ LEFT PANEL ══════════════════════════════════════════════ */}
        <div style={{
          width: 375, flexShrink: 0,
          background: C.white, borderRight: `1px solid ${C.cloud}`,
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}>

          {/* Left header */}
          <div style={{ padding: "20px 22px 0", flexShrink: 0 }}>
            <Eyebrow s={{ marginBottom: 5 }}>Model Builder Configuration</Eyebrow>
            <div style={{ fontFamily: serif, fontSize: 17, fontWeight: 700, color: C.ink, lineHeight: 1.35, marginBottom: 18 }}>
              Build a model<br />
            </div>
            <WizardTabs current={step} onGoTo={goTo} />
          </div>

          {/* Left scrollable body */}
          <div style={{ flex: 1, overflow: "auto", padding: "18px 22px" }}>

            {step === 0 && (
              <div style={{ animation: "apFade .2s ease" }}>
                <div style={{ fontFamily: body, fontSize: 12, color: C.slate, marginBottom: 14, lineHeight: 1.65 }}>
                  Select the raw source tables this model should learn from. System-generated datasets (master/preprocessed) are excluded here because this pipeline builds fresh artifacts for each run.
                </div>
                {dsLoading ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "18px 0", color: C.fog, fontSize: 12 }}>
                    <div style={{ width: 14, height: 14, borderRadius: "50%", border: `2px solid ${C.orange}28`, borderTopColor: C.orange, animation: "apSpin .85s linear infinite" }} />
                    Loading datasets…
                  </div>
                ) : dsError ? (
                  <ErrBanner message={dsError} />
                ) : (
                  <StepData
                    datasets={datasets}
                    selectedIds={selectedIds}
                    onToggle={(id) => setSelectedIds((p) => {
                      const normalized = Number(id);
                      return p.includes(normalized)
                        ? p.filter((x) => x !== normalized)
                        : [...p, normalized];
                    })}
                  />
                )}
                {selectedIds.length > 0 && (
                  <div style={{ marginTop: 11, padding: "7px 12px", background: C.successBg, border: `1px solid ${C.successBd}`, borderLeft: `3px solid ${C.success}`, fontFamily: body, fontSize: 11, color: C.success, fontWeight: 600 }}>
                    {selectedIds.length} source{selectedIds.length > 1 ? "s" : ""} selected
                  </div>
                )}
              </div>
            )}

            {step === 1 && (
              <div style={{ animation: "apFade .2s ease" }}>
                {/* StepTarget calls mlopsApi.schemaPreview() internally */}
                <StepTarget
                  sourceDatasets={selectedDatasets}
                  targetColumn={targetColumn}
                  preferredTarget={workbenchTarget}
                  onTargetChange={setTargetColumn}
                />
              </div>
            )}

            {step === 2 && (
              <div style={{ animation: "apFade .2s ease" }}>
                <StepGoal selectedGoal={goal} onGoalChange={setGoal} />
              </div>
            )}

            {step === 3 && (
              <div style={{ animation: "apFade .2s ease" }}>
                <ConfirmStep selectedIds={selectedIds} targetColumn={targetColumn} goal={goal} modelName={modelName} setModelName={setModelName} />
              </div>
            )}
          </div>

          {/* Left footer — nav buttons */}
          <div style={{ padding: "12px 22px", borderTop: `1px solid ${C.cloud}`, background: C.cream, display: "flex", gap: 7, flexShrink: 0 }}>
            {phase !== "config" ? (
              <button
                onClick={reset}
                style={{
                  width: "100%", padding: "8px", background: "transparent",
                  border: `1px solid ${C.cloud}`, fontFamily: body, fontSize: 11,
                  fontWeight: 600, color: C.slate, cursor: "pointer",
                }}
              >
                ← New Build
              </button>
            ) : (
              <>
                {step > 0 && (
                  <button
                    onClick={() => setStep(s => s - 1)}
                    style={{ padding: "8px 15px", background: "transparent", border: `1px solid ${C.cloud}`, fontFamily: body, fontSize: 12, fontWeight: 600, color: C.slate, cursor: "pointer" }}
                  >
                    ← Back
                  </button>
                )}
                <div style={{ flex: 1 }} />
                {step < STEPS.length - 1 ? (
                  <button
                    onClick={goNext}
                    disabled={!canAdvance(step)}
                    style={{
                      padding: "8px 20px", border: "none",
                      background: canAdvance(step) ? C.orange : C.smoke,
                      fontFamily: body, fontSize: 12, fontWeight: 700,
                      color: canAdvance(step) ? C.white : C.silver,
                      cursor: canAdvance(step) ? "pointer" : "default",
                      letterSpacing: "0.02em",
                    }}
                  >
                    Continue →
                  </button>
                ) : (
                  <button
                    onClick={launch}
                    disabled={!canLaunch}
                    style={{
                      padding: "8px 22px", border: "none",
                      background: canLaunch ? C.orange : C.smoke,
                      fontFamily: body, fontSize: 12, fontWeight: 700,
                      color: canLaunch ? C.white : C.silver,
                      cursor: canLaunch ? "pointer" : "default",
                      letterSpacing: "0.03em",
                    }}
                  >
                    Start Build →
                  </button>
                )}
              </>
            )}
          </div>

          {/* PickleUploadCard — calls autoPilotApi.uploadModel() internally */}
          <div style={{ padding: "14px 22px 18px", borderTop: `1px solid ${C.cloud}`, flexShrink: 0 }}>
            <PickleUploadCard onUploaded={d => console.info("Model uploaded:", d)} />
          </div>
        </div>

        {/* ══════ RIGHT PANEL ══════════════════════════════════════════════ */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>

          {/* Right sub-header */}
          <div style={{
            padding: "14px 26px", background: C.white,
            borderBottom: `1px solid ${C.cloud}`, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <div>
              <Eyebrow s={{ marginBottom: 3 }}>{EYEBROW}</Eyebrow>
              <div style={{ fontFamily: serif, fontSize: 16, fontWeight: 700, color: C.ink }}>
                {TITLE}
              </div>
            </div>

            {phase === "running" && (
              <div style={{ textAlign: "right" }}>
                <button
                  onClick={handleCancel}
                  disabled={canceling}
                  style={{
                    marginBottom: 6,
                    padding: "4px 9px",
                    border: `1px solid ${C.cloud}`,
                    background: C.white,
                    color: C.slate,
                    fontFamily: body,
                    fontSize: 10.5,
                    fontWeight: 700,
                    cursor: canceling ? "default" : "pointer",
                  }}
                >
                  {canceling ? "Cancelling..." : "Cancel Run"}
                </button>
                {runId && (
                  <Eyebrow s={{ marginBottom: 4, color: C.slate }}>
                    Run #{shortRunId(runId)}
                  </Eyebrow>
                )}
                <div style={{ fontFamily: serif, fontSize: 26, fontWeight: 700, color: C.orange, lineHeight: 1 }}>
                  {progress}%
                </div>
                <Eyebrow s={{ marginTop: 3 }}>complete</Eyebrow>
              </div>
            )}

            {phase === "done" && (
              <div style={{ textAlign: "right" }}>
                {runId && (
                  <Eyebrow s={{ marginBottom: 4, color: C.slate }}>
                    Run #{shortRunId(runId)}
                  </Eyebrow>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 13px", background: C.successBg, border: `1px solid ${C.successBd}` }}>
                  <svg width="11" height="9" viewBox="0 0 11 9" fill="none">
                    <path d="M1 4.5L4 7.5L10 1" stroke={C.success} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span style={{ fontFamily: body, fontSize: 10.5, fontWeight: 700, color: C.success }}>All stages passed</span>
                </div>
              </div>
            )}

            {phase === "config" && runHistory.length > 0 && (
              <div style={{ textAlign: "right" }}>
                <Eyebrow s={{ color: C.slate }}>Latest Run</Eyebrow>
                <div style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, color: C.ink }}>
                  {shortRunId(runHistory[0]?.run_id)}
                </div>
              </div>
            )}
          </div>

          {/* Orange progress bar */}
          {phase === "running" && (
            <div style={{ height: 3, background: C.cloud, flexShrink: 0 }}>
              <div style={{ height: "100%", width: `${progress}%`, background: C.orange, transition: "width 0.6s ease" }} />
            </div>
          )}

          {/* Right body */}
          <div style={{ flex: 1, overflow: "auto", padding: "22px 26px" }}>
            <RunHistoryCard
              runId={runId}
              runHistory={runHistory}
              loading={runsLoading}
              error={runsError}
              onRefresh={() => loadRunHistory()}
            />

            {(phase === "config" || phase === "running") && (
              <div style={{ animation: "apFade .3s ease" }}>

                {/* DAG card */}
                <div style={{ background: C.white, border: `1px solid ${C.cloud}`, borderTop: `3px solid ${C.orange}`, padding: "18px 22px", marginBottom: 14 }}>
                  <SectionLabel text="Pipeline Architecture" s={{ marginBottom: 18 }} />
                  {/*
                    PipelineDAG is driven by liveSteps from usePipelineRun polling.
                    step.status: pending | running | done | error | skipped
                    Before run: shows grey skeleton (SKELETON constant above).
                  */}
                  <PipelineDAG steps={liveSteps.length ? liveSteps : SKELETON} />
                </div>

                {phase === "running" && <RunBanner step={activeStep} />}
                {phase === "running" && liveSteps.length > 0 && <DoneLog steps={liveSteps} />}
                {phase === "running" && run?.logs?.length > 0 && <RunLogsPanel logs={run.logs} />}
                {phase === "config"  && <Placeholder />}

                {runErr && (
                  <div style={{ marginTop: 14 }}>
                    <ErrBanner message={runErr} />
                  </div>
                )}
              </div>
            )}

            {phase === "done" && (
              <div style={{ animation: "apFade .4s ease" }}>
                {deployErr && (
                  <div style={{ marginBottom: 14 }}>
                    <ErrBanner message={deployErr} onDismiss={() => setDeployErr(null)} />
                  </div>
                )}
                {/*
                  ResultsPanel reads:
                    run.steps[train].result._auc
                    run.steps[validate].result.optimal_threshold
                    run.config.business_goal
                    run.artifacts.job_id
                  Calls onDeploy({job_id, threshold}) → autoPilotApi.deploy(runId, …)
                */}
                <ResultsPanel run={run} onDeploy={deploy} deploying={deploying} />
                {run?.logs?.length > 0 && <RunLogsPanel logs={run.logs} />}
              </div>
            )}

            {phase === "error" && (
              <div style={{ animation: "apFade .3s ease" }}>
                <ErrBanner message={run?.error || runErr || "An unexpected error occurred."} onDismiss={reset} />
                {liveSteps.length > 0 && (
                  <div style={{ marginTop: 14, background: C.white, border: `1px solid ${C.cloud}`, borderTop: `3px solid ${C.orange}`, padding: "18px 22px" }}>
                    <SectionLabel text="Pipeline Status at Failure" s={{ marginBottom: 18 }} />
                    <PipelineDAG steps={liveSteps} />
                  </div>
                )}
                {run?.logs?.length > 0 && <RunLogsPanel logs={run.logs} />}
              </div>
            )}

          </div>
        </div>
      </div>
    </>
  );
}

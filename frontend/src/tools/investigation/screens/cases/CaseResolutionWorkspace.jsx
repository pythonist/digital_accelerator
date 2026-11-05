import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
  Divider,
} from '@mui/material';
import {
  AssignmentTurnedIn as ResolutionIcon,
  AutoAwesome as SparklesIcon,
  CheckCircleOutline as AcceptIcon,
  Gavel as DecisionIcon,
  PlaylistAddCheck as LedgerIcon,
  Refresh as RefreshIcon,
  Save as SaveIcon,
  WarningAmber as WarningIcon,
  AccountBalance as BankIcon,
  ReceiptLong as ReceiptIcon,
  ShieldOutlined as ShieldIcon,
  Timeline as TimelineIcon,
  Layers as LayersIcon,
} from '@mui/icons-material';

import { useAppContext } from '@context/AppContext';
import apiClient from '@services/api';
import PageContainer from '@investigation-layout/PageContainer';
import { readFccSentinelHandoff } from '../../../../utils/fccSentinelHandoff';
import {
  CASE_RESOLUTION_EVENT,
  mergeCaseResolutionModule,
  readCaseResolutionCase,
} from '../../utils/caseResolutionStore';
import {
  readInvestigationSettings,
  resolveConfiguredModel,
} from '../../utils/investigationSettings';

const DECISION_ACTIONS = [
  'Suspicious / SAR Recommended',
  'Non-Suspicious / Close',
  'Requires EDD',
  'Escalate',
  'Reopen',
];

const STATUS_STEPS = [
  { key: 'intake', label: 'Intake' },
  { key: 'investigation', label: 'Investigation' },
  { key: 'evidence_built', label: 'Evidence Built' },
  { key: 'narrative_drafted', label: 'Narrative Drafted' },
  { key: 'decision', label: 'Decision' },
  { key: 'closed', label: 'Closed' },
];

const strengthRank = { Weak: 1, Moderate: 2, Strong: 3 };

const fmtDateTime = (value) => {
  if (!value) return 'Undated';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString();
};

const compactNumber = (value, digits = 0) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return num.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
};

const slugify = (value) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '') || 'item';

const toArray = (value) => Array.isArray(value) ? value : [];

const cleanSarText = (raw) => {
  if (!raw) return '';
  let text = String(raw).trim();
  text = text.replace(/\$([0-9])/g, '$1');
  if (text.startsWith('{') || text.includes('"sar_sections"')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed?.sar_sections)) {
        return parsed.sar_sections
          .map((s) => `${s.title || ''}\n${s.content || ''}`.trim())
          .join('\n\n');
      }
    } catch (_) {
      const matches = [];
      const regex = /"title"\s*:\s*"([^"]+)"\s*,\s*"content"\s*:\s*"([^"]+)"/g;
      let m;
      while ((m = regex.exec(text)) !== null) {
        matches.push(`${m[1]}\n${m[2]}`);
      }
      if (matches.length) return matches.join('\n\n');
    }
  }
  return text;
};

const normalizeStrength = (value) => {
  const text = String(value || '').toLowerCase();
  if (text.includes('strong')) return 'Strong';
  if (text.includes('weak') || text.includes('low')) return 'Weak';
  return 'Moderate';
};

const evidenceStrengthFromScore = (score, highCutoff = 70, mediumCutoff = 40) => {
  const num = Number(score);
  if (!Number.isFinite(num)) return 'Moderate';
  if (num >= highCutoff) return 'Strong';
  if (num >= mediumCutoff) return 'Moderate';
  return 'Weak';
};

const summarizeVectorResults = (vectorModule) => {
  const rows = toArray(vectorModule?.search_results || vectorModule?.results || vectorModule?.searchResults);
  return rows
    .slice(0, 3)
    .map((item) => ({
      case_id: item.case_id,
      score: Number(item.similarity_score || item.similarity || 0),
      summary: item.summary || '',
    }))
    .filter((item) => item.case_id);
};

const buildSourcePayload = ({ selectedCaseId, liveData, moduleSnapshot }) => ({
  case_id: selectedCaseId,
  case_facts: liveData?.facts || null,
  case_pack: liveData?.casePack || null,
  baseline: liveData?.baseline || null,
  graph: liveData?.graph || null,
  lineage: liveData?.lineage || null,
  vector: liveData?.vector || moduleSnapshot?.modules?.vector || null,
  ai_explain: liveData?.aiExplain || null,
  ai_review: liveData?.aiReview || null,
  stored_module_feeds: moduleSnapshot?.modules || {},
});

const buildTimeline = ({ casePack, graph, facts, moduleSnapshot, selectedCaseId }) => {
  const events = [];

  toArray(casePack?.alerts).slice(0, 8).forEach((alert, index) => {
    events.push({
      id: `alert_${index + 1}`,
      ts: alert.alert_date || alert.ALERT_DATE || alert.date,
      title: `Alert ${alert.alert_id || alert.ALERT_ID || index + 1} triggered`,
      category: 'Alert',
      detail: alert.rule_triggered || alert.RULE_TRIGGERED || 'FCC retained alert',
      source_module: 'Case Pack',
      record_ids: [alert.alert_id || alert.ALERT_ID].filter(Boolean),
    });
  });

  toArray(casePack?.ledger).slice(0, 10).forEach((txn, index) => {
    events.push({
      id: `ledger_${index + 1}`,
      ts: txn.date || txn.ts || txn.TXN_TIMESTAMP,
      title: `Transaction ${txn.reference || txn.transaction_id || txn.TRANSACTION_ID || index + 1}`,
      category: 'Transaction',
      detail: `${txn.type || txn.txn_type || 'Movement'} • ${compactNumber(txn.amount || txn.TXN_AMOUNT || 0, 2)}`,
      source_module: 'Case Pack',
      record_ids: [txn.reference || txn.transaction_id || txn.TRANSACTION_ID].filter(Boolean),
    });
  });

  toArray(graph?.graph?.links).slice(0, 6).forEach((link, index) => {
    events.push({
      id: `graph_${index + 1}`,
      ts: link.ts || link.date || link.TXN_TIMESTAMP,
      title: `${link.source || 'Source'} → ${link.target || 'Target'}`,
      category: 'Graph Path',
      detail: `${compactNumber(link.volume || link.amount || 0, 2)} ${link.txn_type || link.relation || ''}`.trim(),
      source_module: 'Graph Analysis',
      record_ids: [link.id].filter(Boolean),
    });
  });

  const riskFacts = facts?.facts;
  if (riskFacts?.alerts?.total_alerts) {
    events.push({
      id: 'facts_prior_alerts',
      ts: facts?.metadata?.generated_at,
      title: 'Historical alert context retrieved',
      category: 'History',
      detail: `${riskFacts.alerts.total_alerts} prior alerts in case context`,
      source_module: 'Case Pack',
      record_ids: [selectedCaseId],
    });
  }

  const modules = moduleSnapshot?.modules || {};
  Object.entries(modules).forEach(([moduleKey, moduleValue]) => {
    if (!moduleValue?.updated_at) return;
    events.push({
      id: `module_${moduleKey}`,
      ts: moduleValue.updated_at,
      title: `${String(moduleKey).replace(/_/g, ' ')} findings refreshed`,
      category: 'Analyst Action',
      detail: 'Module findings added to the Evidence Pack.',
      source_module: 'Case Workspace',
      record_ids: [selectedCaseId],
    });
  });

  return events
    .filter((item) => item.title)
    .sort((a, b) => {
      const aTime = new Date(a.ts || 0).getTime();
      const bTime = new Date(b.ts || 0).getTime();
      return aTime - bTime;
    });
};

const buildGeneratedWorkspace = ({ selectedCaseId, savedSupportFile, moduleSnapshot, liveData }) => {
  const facts = liveData?.facts || null;
  const casePack = liveData?.casePack || null;
  const baseline = liveData?.baseline || moduleSnapshot?.modules?.baseline || null;
  const graph = liveData?.graph || moduleSnapshot?.modules?.graph || null;
  const lineage = liveData?.lineage || moduleSnapshot?.modules?.lineage || null;
  const aiExplain = liveData?.aiExplain || null;
  const aiReview = liveData?.aiReview || null;
  const vectorModule = moduleSnapshot?.modules?.vector || null;

  const summary = {
    case_id: selectedCaseId,
    alert_count: Number(
      casePack?.alerts?.length ||
      facts?.facts?.alerts?.total_alerts ||
      savedSupportFile?.summary?.alert_count ||
      0,
    ),
    risk_score: Number(
      casePack?.risk_score ??
      facts?.facts?.risk?.risk_score ??
      savedSupportFile?.summary?.risk_score ??
      0,
    ),
    analyst_status: savedSupportFile?.decision?.analyst_status || casePack?.status || 'Under Investigation',
  };

  const typologyFlags = Array.isArray(casePack?.typology_flags)
    ? casePack.typology_flags
    : Object.entries(casePack?.typology_flags || {})
        .filter(([, value]) => Boolean(value))
        .map(([key]) => key);

  const graphPatterns = graph?.graph?.patterns || graph?.patterns || {};
  const vectorMatches = summarizeVectorResults(vectorModule);

  let hypothesisPattern = '';
  let hypothesisNarrative = '';
  if (typologyFlags.some((item) => /structur/i.test(item))) {
    hypothesisPattern = 'Structuring';
    hypothesisNarrative = 'Possible structuring through repeated sub-threshold activity and elevated alert concentration.';
  } else if (Number(graphPatterns?.pass_through?.count || 0) > 0) {
    hypothesisPattern = 'Funnel Account Behavior';
    hypothesisNarrative = 'Rapid pass-through movement suggests funnel-account behavior that warrants corroboration.';
  } else if (Number(graphPatterns?.multi_hop_chains?.count || 0) > 0 || Number(graphPatterns?.circular_chains?.count || 0) > 0) {
    hypothesisPattern = 'Layering';
    hypothesisNarrative = 'Multi-hop or circular flows indicate possible layering and relationship shielding.';
  } else if (vectorMatches.some((item) => /mule/i.test(item.summary))) {
    hypothesisPattern = 'Mule Behavior';
    hypothesisNarrative = 'Pattern similarity indicates possible mule behavior requiring direct evidence review.';
  } else if (toArray(baseline?.deviations).length > 0) {
    hypothesisPattern = 'Unusual Behavioral Deviation';
    hypothesisNarrative = 'Behavior deviates from historical baseline and requires explanation before closure.';
  }

  const evidenceItems = [];

  if (summary.alert_count > 0) {
    evidenceItems.push({
      id: 'casepack_alert_inventory',
      title: 'Retained alert inventory',
      evidence_type: 'Alert Context',
      source_module: 'Case Pack',
      source_records: toArray(casePack?.alerts).slice(0, 5).map((item) => item.alert_id || item.ALERT_ID).filter(Boolean),
      occurred_at: toArray(casePack?.alerts)[0]?.alert_date || casePack?.metadata?.generated_at,
      why_it_matters: `${summary.alert_count} retained alerts are tied to the same investigation scope and provide the originating trigger set.`,
      strength: evidenceStrengthFromScore(summary.risk_score, 80, 45),
      analyst_status: 'pending',
      analyst_comment: '',
      is_key_evidence: false,
    });
  }

  toArray(baseline?.deviations).slice(0, 4).forEach((item, index) => {
    evidenceItems.push({
      id: `baseline_${slugify(item.type || item.category || index)}`,
      title: item.type?.replace(/_/g, ' ') || item.category || `Baseline deviation ${index + 1}`,
      evidence_type: 'Behavioral Deviation',
      source_module: 'Baseline Analysis',
      source_records: [item.feature_name || item.metric || 'baseline_feature'].filter(Boolean),
      occurred_at: item.date || item.observed_at || baseline?.generated_at,
      why_it_matters: item.message || item.summary || 'Customer behavior deviates significantly from baseline profile.',
      strength: normalizeStrength(item.severity || item.strength || 'Moderate'),
      analyst_status: 'pending',
      analyst_comment: '',
      is_key_evidence: false,
    });
  });

  const claims = [
    {
      id: 'claim_originating_triggers',
      claim: `Case ${selectedCaseId} was triggered by ${summary.alert_count} alert(s) requiring formal review.`,
      status: summary.alert_count > 0 ? 'supported' : 'pending',
      confidence: 'High',
      supported_evidence_ids: ['casepack_alert_inventory'],
      notes: 'Originating alert inventory tied to active case profile.',
    },
  ];

  const mitigatingFactors = [];
  const initialSummaryText = `Case ${selectedCaseId} carries a risk score of ${summary.risk_score} with ${summary.alert_count} alerts reviewed. Investigation evidence is consolidated below for analyst substantiation.`;
  const summaryReferences = evidenceItems.slice(0, 3).map((item) => item.id);

  const initialCaseSynthesis = {
    reviewed: `Alert inventory, transaction history (${toArray(casePack?.ledger).length} txns), baseline deviations, and counterparty records were reviewed.`,
    found: hypothesisNarrative || 'Preliminary suspicious activity indicators require analyst substantiation.',
    supports_suspicion: 'Pending analyst curation of the accepted Evidence Pack.',
    weakens_suspicion: 'No explicit mitigating factors currently accepted.',
    requires_validation: 'Analyst review of transactions and counterparty exposure required before SAR finalization.',
  };

  const initialSarSections = [
    'Subject Information',
    'Case Overview',
    'Alert Background',
    'Transaction Activity Reviewed',
    'Behavioral and Historical Analysis',
    'Linked Entity Findings',
    'Grounds for Suspicion',
    'Explain Risk Drivers',
    'Recommended Next Steps',
    'Conclusion and Recommendation',
  ].map((title) => ({
    id: `sar_${slugify(title)}`,
    title,
    content: '',
    references: summaryReferences,
  }));

  return {
    case_id: selectedCaseId,
    summary,
    hypothesis: {
      pattern: hypothesisPattern,
      narrative: hypothesisNarrative,
      updated_at: new Date().toISOString(),
    },
    evidence_items: evidenceItems,
    claims,
    mitigating_factors: mitigatingFactors,
    timeline_events: buildTimeline({ casePack, graph, facts, moduleSnapshot, selectedCaseId }),
    investigation_summary: {
      text: initialSummaryText,
      references: summaryReferences,
      status_note: 'Narrative is based on current case inputs and still requires analyst validation before closure.',
    },
    case_synthesis: initialCaseSynthesis,
    sar_readiness: {
      status: 'Not Ready',
      reason: 'Accepted evidence has not yet been curated by the analyst.',
    },
    decision: {
      analyst_status: summary.analyst_status,
      final_action: '',
      rationale: '',
      requires_rationale: true,
    },
    analyst_notes: '',
    module_feeds: moduleSnapshot?.modules || {},
    ai_review: {
      draft_reasoning: aiExplain?.explanation || '',
      questions: toArray(aiReview?.questions || aiReview?.items || []),
    },
    sar_sections: initialSarSections,
    sar_draft: '',
    audit: savedSupportFile?.audit || {
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };
};

const mergeGeneratedWithSaved = (generated, savedSupportFile) => {
  if (!savedSupportFile) return generated;

  const savedEvidence = new Map(toArray(savedSupportFile.evidence_items).map((item) => [item.id, item]));
  const mergedEvidence = generated.evidence_items.map((item) => {
    const prior = savedEvidence.get(item.id);
    if (!prior) return item;
    return {
      ...item,
      analyst_status: prior.analyst_status || item.analyst_status,
      analyst_comment: prior.analyst_comment || '',
      is_key_evidence: Boolean(prior.is_key_evidence),
      strength: prior.strength || item.strength,
    };
  });
  toArray(savedSupportFile.evidence_items).forEach((item) => {
    if (!mergedEvidence.some((entry) => entry.id === item.id)) {
      mergedEvidence.push(item);
    }
  });

  const savedClaims = new Map(toArray(savedSupportFile.claims).map((item) => [item.id, item]));
  const mergedClaims = generated.claims.map((item) => {
    const prior = savedClaims.get(item.id);
    if (!prior) return item;
    return {
      ...item,
      status: prior.status || item.status,
      notes: prior.notes || '',
      confidence: prior.confidence || item.confidence,
      supported_evidence_ids: prior.supported_evidence_ids?.length ? prior.supported_evidence_ids : item.supported_evidence_ids,
    };
  });
  toArray(savedSupportFile.claims).forEach((item) => {
    if (!mergedClaims.some((entry) => entry.id === item.id)) {
      mergedClaims.push(item);
    }
  });

  return {
    ...generated,
    summary: {
      ...generated.summary,
      ...savedSupportFile.summary,
    },
    hypothesis: {
      ...generated.hypothesis,
      ...savedSupportFile.hypothesis,
    },
    evidence_items: mergedEvidence,
    claims: mergedClaims,
    mitigating_factors: toArray(savedSupportFile.mitigating_factors).length ? savedSupportFile.mitigating_factors : generated.mitigating_factors,
    timeline_events: toArray(savedSupportFile.timeline_events).length ? savedSupportFile.timeline_events : generated.timeline_events,
    investigation_summary: {
      ...generated.investigation_summary,
      ...(savedSupportFile.investigation_summary || {}),
    },
    case_synthesis: {
      ...generated.case_synthesis,
      ...(savedSupportFile.case_synthesis || {}),
    },
    decision: {
      ...generated.decision,
      ...savedSupportFile.decision,
    },
    analyst_notes: savedSupportFile.analyst_notes || generated.analyst_notes,
    sar_draft: savedSupportFile.sar_draft || generated.sar_draft,
    ai_review: {
      ...generated.ai_review,
      ...savedSupportFile.ai_review,
    },
    sar_sections: toArray(savedSupportFile.sar_sections).length ? savedSupportFile.sar_sections : generated.sar_sections,
    module_feeds: {
      ...generated.module_feeds,
      ...(savedSupportFile.module_feeds || {}),
    },
    audit: savedSupportFile.audit || generated.audit,
  };
};

const deriveReadiness = (supportFile) => {
  const acceptedEvidence = toArray(supportFile?.evidence_items).filter((item) => item.analyst_status === 'accepted');
  const approvedClaims = toArray(supportFile?.claims).filter(
    (item) => ['accepted', 'approved', 'supported'].includes(String(item.status || '').toLowerCase())
      && toArray(item.supported_evidence_ids).some((id) => acceptedEvidence.some((evidence) => evidence.id === id)),
  );

  if (!acceptedEvidence.length) {
    return {
      status: 'Not Ready',
      reason: 'No evidence has been accepted into the Evidence Pack yet.',
    };
  }
  if (supportFile?.sar_draft) {
    return {
      status: 'Analyst Review Required',
      reason: 'A SAR draft exists and needs analyst validation before filing or closure.',
    };
  }
  if (acceptedEvidence.length < 2 || !approvedClaims.length) {
    return {
      status: 'Needs More Evidence',
      reason: 'At least two accepted evidence items and one approved claim are required before drafting.',
    };
  }
  return {
    status: 'Ready for Draft',
    reason: 'Accepted evidence and approved claims are sufficient to draft a SAR narrative.',
  };
};

const deriveRecommendation = (supportFile) => {
  const acceptedEvidence = toArray(supportFile?.evidence_items).filter((item) => item.analyst_status === 'accepted');
  const strongAccepted = acceptedEvidence.filter((item) => strengthRank[item.strength] >= 3).length;
  const approvedClaims = toArray(supportFile?.claims).filter((item) => ['accepted', 'approved', 'supported'].includes(String(item.status || '').toLowerCase()));
  const readiness = deriveReadiness(supportFile);

  if (supportFile?.decision?.final_action) {
    return {
      recommended_disposition: supportFile.decision.final_action,
      confidence: supportFile.decision.rationale ? 'Analyst Approved' : 'Pending',
      readiness,
    };
  }
  if (readiness.status === 'Ready for Draft' && (strongAccepted >= 1 || approvedClaims.length >= 2)) {
    return {
      recommended_disposition: 'Suspicious / SAR Recommended',
      confidence: strongAccepted >= 2 ? 'High' : 'Moderate',
      readiness,
    };
  }
  if (!acceptedEvidence.length && toArray(supportFile?.mitigating_factors).length >= 2) {
    return {
      recommended_disposition: 'Needs More Evidence',
      confidence: 'Low',
      readiness,
    };
  }
  return {
    recommended_disposition: 'Analyst Review Required',
    confidence: acceptedEvidence.length ? 'Moderate' : 'Pending',
    readiness,
  };
};

const deriveProgress = (supportFile) => {
  const evidenceAccepted = toArray(supportFile?.evidence_items).some((item) => item.analyst_status === 'accepted');
  const finalAction = String(supportFile?.decision?.final_action || '').trim();
  const finalRationale = String(supportFile?.decision?.rationale || '').trim();
  return STATUS_STEPS.map((step) => {
    if (step.key === 'intake') return { ...step, state: 'done' };
    if (step.key === 'investigation') return { ...step, state: supportFile ? 'done' : 'current' };
    if (step.key === 'evidence_built') return { ...step, state: evidenceAccepted ? 'done' : 'current' };
    if (step.key === 'narrative_drafted') {
      return { ...step, state: supportFile?.sar_draft ? 'done' : (evidenceAccepted ? 'current' : 'upcoming') };
    }
    if (step.key === 'decision') {
      return { ...step, state: finalAction ? 'done' : (supportFile?.sar_draft ? 'current' : 'upcoming') };
    }
    if (step.key === 'closed') {
      return { ...step, state: finalAction && finalRationale ? 'done' : 'upcoming' };
    }
    return { ...step, state: 'upcoming' };
  });
};

/* Seamless Modern Progress Indicator */
const SeamlessProgressRail = ({ steps }) => (
  <Box
    sx={{
      display: 'grid',
      gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`,
      gap: 1,
      bgcolor: '#ffffff',
      p: 1.5,
      borderRadius: 2,
      boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
    }}
  >
    {steps.map((step, idx) => {
      const active = step.state === 'current';
      const done = step.state === 'done';
      return (
        <Box
          key={step.key}
          sx={{
            py: 1,
            px: 1.5,
            borderRadius: 1.5,
            bgcolor: done ? '#f0fdf4' : active ? '#fff7ed' : '#f8fafc',
            borderBottom: active ? '2.5px solid #ea580c' : done ? '2.5px solid #16a34a' : '2.5px solid transparent',
            transition: 'all 0.2s ease',
          }}
        >
          <Stack direction="row" spacing={1} alignItems="center">
            <Box
              sx={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                bgcolor: done ? '#16a34a' : active ? '#ea580c' : '#cbd5e1',
                color: '#fff',
                fontSize: 10,
                fontWeight: 800,
                display: 'grid',
                placeItems: 'center',
                flexShrink: 0,
              }}
            >
              {done ? '✓' : idx + 1}
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {step.label}
              </Typography>
              <Typography sx={{ fontSize: 10, color: done ? '#16a34a' : active ? '#ea580c' : '#94a3b8', textTransform: 'capitalize' }}>
                {step.state}
              </Typography>
            </Box>
          </Stack>
        </Box>
      );
    })}
  </Box>
);

const CaseResolutionWorkspace = () => {
  const { caseList, loadCaseList, ollamaModels } = useAppContext();
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [supportFile, setSupportFile] = useState(null);
  const [moduleSnapshot, setModuleSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [liveData, setLiveData] = useState({});
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    if (!caseList.length) {
      loadCaseList();
    }
  }, []);

  useEffect(() => {
    if (selectedCaseId || !caseList.length) return;
    const handoffCaseId = String(readFccSentinelHandoff()?.selected_case_id || '').trim();
    const preferred = handoffCaseId && caseList.some((item) => String(item.case_id || item.caseid || item.id) === handoffCaseId)
      ? handoffCaseId
      : String(caseList[0]?.case_id || caseList[0]?.caseid || caseList[0]?.id || '');
    if (preferred) setSelectedCaseId(preferred);
  }, [caseList, selectedCaseId]);

  useEffect(() => {
    const handleStoreUpdate = (event) => {
      const caseId = String(event?.detail?.case_id || '').trim();
      if (!caseId || caseId !== selectedCaseId) return;
      setRefreshToken((value) => value + 1);
    };

    window.addEventListener(CASE_RESOLUTION_EVENT, handleStoreUpdate);
    return () => window.removeEventListener(CASE_RESOLUTION_EVENT, handleStoreUpdate);
  }, [selectedCaseId]);

  useEffect(() => {
    if (!selectedCaseId) return;

    let active = true;
    setLoading(true);
    setError('');

    const loadWorkspace = async () => {
      const localModuleSnapshot = readCaseResolutionCase(selectedCaseId);
      setModuleSnapshot(localModuleSnapshot);

      let savedSupportFile = null;
      try {
        const supportRes = await apiClient.getCaseResolutionSupportFile(selectedCaseId);
        savedSupportFile = supportRes?.support_file || null;
      } catch (_) {}

      const [factsRes, packRes, baselineRes, graphRes, lineageRes, vectorRes, aiExplainRes, aiReviewRes] = await Promise.allSettled([
        apiClient.getCaseFacts(selectedCaseId),
        apiClient.getCasePack(selectedCaseId),
        apiClient.getBaselineComparison(selectedCaseId),
        apiClient.getNetworkIntelligence(selectedCaseId),
        apiClient.getEvidenceLineageTree(selectedCaseId),
        apiClient.retrieveSimilarCases({ base_case_id: selectedCaseId, top_k: 4 }),
        apiClient.explainCase(selectedCaseId),
        apiClient.reviewCaseQuestions(selectedCaseId),
      ]);

      if (!active) return;

      const nextLiveData = {
        facts: factsRes.status === 'fulfilled' ? factsRes.value : null,
        casePack: packRes.status === 'fulfilled' ? packRes.value : null,
        baseline: baselineRes.status === 'fulfilled' ? baselineRes.value : null,
        graph: graphRes.status === 'fulfilled' ? graphRes.value : null,
        lineage: lineageRes.status === 'fulfilled' ? lineageRes.value : null,
        vector: vectorRes.status === 'fulfilled' ? vectorRes.value : null,
        aiExplain: aiExplainRes.status === 'fulfilled' ? aiExplainRes.value : null,
        aiReview: aiReviewRes.status === 'fulfilled' ? aiReviewRes.value : null,
      };
      setLiveData(nextLiveData);

      const generated = buildGeneratedWorkspace({
        selectedCaseId,
        savedSupportFile,
        moduleSnapshot: localModuleSnapshot,
        liveData: nextLiveData,
      });
      const merged = mergeGeneratedWithSaved(generated, savedSupportFile);
      const sourcePayload = buildSourcePayload({
        selectedCaseId,
        liveData: nextLiveData,
        moduleSnapshot: localModuleSnapshot,
      });
      const recommendation = deriveRecommendation(merged);
      const nextSupportFile = {
        ...merged,
        source_payload: sourcePayload,
        summary: {
          ...merged.summary,
          recommended_disposition: recommendation.recommended_disposition,
          confidence: recommendation.confidence,
        },
        sar_readiness: recommendation.readiness,
        progress_steps: deriveProgress(merged),
      };

      setSupportFile(nextSupportFile);
    };

    loadWorkspace()
      .catch((loadError) => {
        if (!active) return;
        setError(loadError?.message || 'Failed to load the Case Resolution workspace.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selectedCaseId, refreshToken]);

  const evidenceLookup = useMemo(
    () => new Map(toArray(supportFile?.evidence_items).map((item) => [item.id, item])),
    [supportFile],
  );

  const updateSupportFile = (mutator) => {
    setSupportFile((previous) => {
      const draft = typeof mutator === 'function' ? mutator(previous) : mutator;
      if (!draft) return previous;
      const recommendation = deriveRecommendation(draft);
      return {
        ...draft,
        summary: {
          ...draft.summary,
          recommended_disposition: recommendation.recommended_disposition,
          confidence: recommendation.confidence,
        },
        sar_readiness: recommendation.readiness,
        progress_steps: deriveProgress(draft),
        audit: {
          ...(draft.audit || {}),
          updated_at: new Date().toISOString(),
        },
      };
    });
  };

  const handleSave = async () => {
    if (!selectedCaseId || !supportFile) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await apiClient.saveCaseResolutionSupportFile(selectedCaseId, supportFile);
      setSupportFile(response.support_file);
      mergeCaseResolutionModule(selectedCaseId, 'resolution_workspace', {
        summary: response.support_file?.summary,
        readiness: response.support_file?.sar_readiness,
        updated_at: new Date().toISOString(),
      });
      setNotice('Evidence Pack saved for this case.');
    } catch (saveError) {
      setError(saveError.message || 'Failed to save the Evidence Pack.');
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateSar = async () => {
    if (!selectedCaseId || !supportFile) return;
    setDrafting(true);
    setError('');
    setNotice('');
    try {
      const settings = readInvestigationSettings();
      const preferredModel = resolveConfiguredModel(
        settings,
        settings?.global?.default_model,
        ollamaModels?.[0] || null,
      );
      const summaryResponse = await apiClient.generateCaseResolutionInvestigationSummary(selectedCaseId, supportFile, preferredModel);
      const sarResponse = await apiClient.generateCaseResolutionSarDraft(selectedCaseId, summaryResponse.support_file, preferredModel);
      setSupportFile((previous) => ({
        ...(previous || {}),
        ...(sarResponse.support_file || {}),
        sar_draft: sarResponse?.support_file?.sar_draft || sarResponse?.sar_draft || previous?.sar_draft || '',
      }));
      setNotice('SAR draft generated from the combined case JSON payload.');
    } catch (draftError) {
      setError(draftError.message || 'Unable to generate SAR draft.');
    } finally {
      setDrafting(false);
    }
  };

  const handleAcceptSar = async () => {
    if (!selectedCaseId || !supportFile?.sar_draft) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const acceptedPayload = {
        ...supportFile,
        decision: {
          ...(supportFile.decision || {}),
          sar_status: 'Accepted',
          sar_accepted_at: supportFile?.decision?.sar_accepted_at || new Date().toISOString(),
          accepted_sar_draft: supportFile.sar_draft,
        },
        summary: {
          ...(supportFile.summary || {}),
          analyst_status: 'Draft Prepared',
        },
      };
      const response = await apiClient.saveCaseResolutionSupportFile(selectedCaseId, acceptedPayload);
      setSupportFile(response.support_file);
      mergeCaseResolutionModule(selectedCaseId, 'resolution_workspace', {
        summary: response.support_file?.summary,
        readiness: response.support_file?.sar_readiness,
        sar_status: response.support_file?.decision?.sar_status,
        updated_at: new Date().toISOString(),
      });
      setNotice('SAR draft accepted and attached to this case.');
    } catch (acceptError) {
      setError(acceptError.message || 'Unable to accept the SAR draft.');
    } finally {
      setSaving(false);
    }
  };

  const summaryReferences = toArray(supportFile?.investigation_summary?.references);

  return (
    <PageContainer
      title="Case Resolution & SAR Workspace"
      subtitle="Evidence substantiation, analyst decisioning, and SAR drafting for a single defensible case record"
      breadcrumbs={['Resolution', 'Case Resolution & SAR Workspace']}
      actions={(
        <Button
          size="small"
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={() => setRefreshToken((value) => value + 1)}
          disabled={!selectedCaseId || loading}
          sx={{ textTransform: 'none', fontWeight: 700 }}
        >
          Refresh
        </Button>
      )}
    >
      <Stack spacing={2.5}>
        {/* Seamless Case Selector Header */}
        <Box
          sx={{
            p: 2,
            bgcolor: '#ffffff',
            borderRadius: 2.5,
            boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
            display: 'flex',
            flexDirection: { xs: 'column', md: 'row' },
            alignItems: { xs: 'stretch', md: 'center' },
            justifyContent: 'space-between',
            gap: 2,
          }}
        >
          <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
            <FormControl size="small" sx={{ minWidth: 260 }}>
              <InputLabel>Active Case Record</InputLabel>
              <Select
                value={selectedCaseId}
                label="Active Case Record"
                onChange={(event) => setSelectedCaseId(event.target.value)}
                sx={{ borderRadius: 1.5 }}
              >
                {caseList.map((item) => {
                  const id = String(item.case_id || item.caseid || item.id || '');
                  return <MenuItem key={id} value={id}>{id}</MenuItem>;
                })}
              </Select>
            </FormControl>
            {supportFile?.summary && (
              <Stack direction="row" spacing={1} alignItems="center">
                <Chip
                  label={`Risk Score: ${compactNumber(supportFile.summary.risk_score, 0)}`}
                  size="small"
                  sx={{ bgcolor: '#fff7ed', color: '#c2410c', fontWeight: 800, fontSize: 11 }}
                />
                <Chip
                  label={`Alerts: ${compactNumber(supportFile.summary.alert_count)}`}
                  size="small"
                  sx={{ bgcolor: '#f0fdfa', color: '#0d9488', fontWeight: 800, fontSize: 11 }}
                />
                <Chip
                  label={supportFile.sar_readiness?.status || 'Review in Progress'}
                  size="small"
                  sx={{ bgcolor: '#f1f5f9', color: '#475569', fontWeight: 700, fontSize: 11 }}
                />
              </Stack>
            )}
          </Stack>
          <Typography sx={{ fontSize: 12, color: '#64748b', maxWidth: 460 }}>
            Curate evidence items, inspect raw transaction telemetry, draft compliance narrative, and finalize regulatory disposition.
          </Typography>
        </Box>

        {error ? <Alert severity="error" onClose={() => setError('')}>{error}</Alert> : null}
        {notice ? <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert> : null}

        {loading || !supportFile ? (
          <Box sx={{ p: 6, bgcolor: '#ffffff', borderRadius: 2.5, textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
            <CircularProgress size={32} sx={{ color: '#ea580c' }} />
            <Typography sx={{ mt: 2, fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
              Synthesizing case records and telemetry...
            </Typography>
          </Box>
        ) : (
          <>
            {/* Seamless Progress Tracker */}
            <SeamlessProgressRail steps={supportFile.progress_steps || deriveProgress(supportFile)} />

            {/* ============================================================ */}
            {/* SECTION 1: Case Snapshot & Executive Synthesis */}
            {/* ============================================================ */}
            <Box
              sx={{
                bgcolor: '#ffffff',
                p: 3,
                borderRadius: 2.5,
                boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                <Stack direction="row" spacing={1.25} alignItems="center">
                  <ResolutionIcon sx={{ fontSize: 20, color: '#2563eb' }} />
                  <Typography sx={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>
                    1. Case Intelligence & Synthesis
                  </Typography>
                </Stack>
                <Typography sx={{ fontSize: 11.5, color: '#94a3b8' }}>
                  {supportFile.investigation_summary?.status_note || supportFile.sar_readiness.reason}
                </Typography>
              </Box>

              <Typography sx={{ fontSize: 13.5, lineHeight: 1.8, color: '#334155', mb: 2, whiteSpace: 'pre-wrap' }}>
                {supportFile.investigation_summary?.text || 'Investigation narrative is being assembled from active telemetry.'}
              </Typography>

              {summaryReferences.length > 0 && (
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ pt: 1, borderTop: '1px solid #f1f5f9' }}>
                  <Typography sx={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Linked Evidence:
                  </Typography>
                  {summaryReferences.map((ref) => (
                    <Chip key={ref} label={evidenceLookup.get(ref)?.title || ref} size="small" sx={{ bgcolor: '#f8fafc', color: '#475569', fontSize: 11, fontWeight: 600 }} />
                  ))}
                </Stack>
              )}
            </Box>

            {/* ============================================================ */}
            {/* SECTION 2: Empirical Evidence & Transaction Dossier */}
            {/* ============================================================ */}
            <Box
              sx={{
                bgcolor: '#ffffff',
                p: 3,
                borderRadius: 2.5,
                boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
              }}
            >
              <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 2.5 }}>
                <ReceiptIcon sx={{ fontSize: 20, color: '#0284c7' }} />
                <Typography sx={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>
                  2. Empirical Evidence Dossier & Transaction Telemetry
                </Typography>
              </Stack>

              {/* Dual Tables for Alerts & Transactions */}
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1.35fr' }, gap: 2.5, mb: 2.5 }}>
                {/* Alerts List */}
                <Box sx={{ bgcolor: '#f8fafc', p: 2, borderRadius: 2 }}>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: '#0f172a', mb: 1.5 }}>
                    Retained Alerts ({toArray(liveData?.casePack?.alerts).length})
                  </Typography>
                  <Box sx={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>
                          <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 700 }}>Alert ID</th>
                          <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 700 }}>Triggered Rule</th>
                          <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 700 }}>Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {toArray(liveData?.casePack?.alerts).slice(0, 6).map((item, index) => (
                          <tr key={`alert_row_${index + 1}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '8px', fontWeight: 700, color: '#0f172a' }}>{item.alert_id || item.ALERT_ID || '-'}</td>
                            <td style={{ padding: '8px', color: '#334155' }}>{item.rule_triggered || item.RULE_TRIGGERED || '-'}</td>
                            <td style={{ padding: '8px', textAlign: 'right', color: '#64748b' }}>{fmtDateTime(item.alert_date || item.ALERT_DATE || item.date)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Box>
                </Box>

                {/* Transactions List */}
                <Box sx={{ bgcolor: '#f8fafc', p: 2, borderRadius: 2 }}>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: '#0f172a', mb: 1.5 }}>
                    Reviewed Transaction Activity ({toArray(liveData?.casePack?.ledger).length})
                  </Typography>
                  <Box sx={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>
                          <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 700 }}>Reference</th>
                          <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 700 }}>Counterparty</th>
                          <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 700 }}>Amount</th>
                          <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 700 }}>Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {toArray(liveData?.casePack?.ledger).slice(0, 8).map((item, index) => (
                          <tr key={`txn_row_${index + 1}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '8px', fontWeight: 700, color: '#0f172a' }}>{item.reference || item.transaction_id || item.TRANSACTION_ID || '-'}</td>
                            <td style={{ padding: '8px', color: '#334155' }}>{item.counterparty || item.party || item.beneficiary || '-'}</td>
                            <td style={{ padding: '8px', textAlign: 'right', fontWeight: 800, color: '#0f172a' }}>{compactNumber(item.amount || item.TXN_AMOUNT || 0, 2)}</td>
                            <td style={{ padding: '8px', textAlign: 'right', color: '#64748b' }}>{fmtDateTime(item.date || item.ts || item.TXN_TIMESTAMP)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Box>
                </Box>
              </Box>

              {/* 3 Insight Pillars */}
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 2 }}>
                <Box sx={{ p: 2, borderRadius: 2, bgcolor: '#f8fafc' }}>
                  <Typography sx={{ fontSize: 11.5, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5, mb: 0.75 }}>
                    Facts Synthesis
                  </Typography>
                  <Typography sx={{ fontSize: 12.5, lineHeight: 1.65, color: '#334155' }}>
                    {supportFile.case_synthesis?.reviewed}
                  </Typography>
                </Box>
                <Box sx={{ p: 2, borderRadius: 2, bgcolor: '#f8fafc' }}>
                  <Typography sx={{ fontSize: 11.5, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5, mb: 0.75 }}>
                    Baseline Anomaly Status
                  </Typography>
                  <Typography sx={{ fontSize: 12.5, lineHeight: 1.65, color: '#334155' }}>
                    {toArray(liveData?.baseline?.deviations).length
                      ? `${toArray(liveData?.baseline?.deviations).length} deviation(s) flagged against historical baseline.`
                      : 'No statistically significant deviations detected against account baseline.'}
                  </Typography>
                </Box>
                <Box sx={{ p: 2, borderRadius: 2, bgcolor: '#f8fafc' }}>
                  <Typography sx={{ fontSize: 11.5, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5, mb: 0.75 }}>
                    Network Lineage Analysis
                  </Typography>
                  <Typography sx={{ fontSize: 12.5, lineHeight: 1.65, color: '#334155' }}>
                    {liveData?.graph?.narrative || supportFile.case_synthesis?.found || 'No graph narrative was available for this case.'}
                  </Typography>
                </Box>
              </Box>
            </Box>

            {/* ============================================================ */}
            {/* SECTION 3: SAR Drafting Studio & Disposition */}
            {/* ============================================================ */}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1.45fr 1fr' }, gap: 2.5, alignItems: 'start' }}>
              {/* Left: SAR Draft Studio */}
              <Box
                sx={{
                  bgcolor: '#ffffff',
                  p: 3,
                  borderRadius: 2.5,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                }}
              >
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1.5 }}>
                  <Box>
                    <Stack direction="row" spacing={1.25} alignItems="center">
                      <SparklesIcon sx={{ fontSize: 20, color: '#ea580c' }} />
                      <Typography sx={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>
                        3. SAR Narrative Studio
                      </Typography>
                    </Stack>
                    <Typography sx={{ mt: 0.25, fontSize: 12, color: '#64748b' }}>
                      Evidence-grounded regulatory narrative incorporating transactions, velocity, and counterparties.
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1}>
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<AcceptIcon />}
                      onClick={handleAcceptSar}
                      disabled={!supportFile?.sar_draft || saving}
                      sx={{ textTransform: 'none', fontWeight: 700 }}
                    >
                      {saving && supportFile?.decision?.sar_status !== 'Accepted' ? 'Saving...' : 'Accept SAR'}
                    </Button>
                    <Button
                      variant="contained"
                      size="small"
                      startIcon={drafting ? <CircularProgress size={14} color="inherit" /> : <SparklesIcon />}
                      onClick={handleGenerateSar}
                      disabled={!selectedCaseId || !supportFile || drafting}
                      sx={{ bgcolor: '#ea580c', '&:hover': { bgcolor: '#c2410c' }, textTransform: 'none', fontWeight: 700 }}
                    >
                      {drafting ? 'Drafting...' : 'Draft SAR'}
                    </Button>
                  </Stack>
                </Box>

                {drafting && (
                  <Box
                    sx={{
                      mb: 2,
                      p: 2,
                      bgcolor: '#fff7ed',
                      borderRadius: 2,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 2,
                    }}
                  >
                    <CircularProgress size={24} thickness={4} sx={{ color: '#ea580c' }} />
                    <Typography sx={{ fontSize: 12.5, color: '#9a3412', fontWeight: 600 }}>
                      AI agent is synthesizing transaction ledger, alert timeline, and grounds for suspicion...
                    </Typography>
                  </Box>
                )}

                <TextField
                  fullWidth
                  multiline
                  minRows={16}
                  size="small"
                  value={cleanSarText(supportFile.sar_draft || '')}
                  placeholder="Draft SAR narrative will appear here after clicking 'Draft SAR'..."
                  sx={{
                    bgcolor: '#fafafa',
                    borderRadius: 2,
                    '& .MuiOutlinedInput-root': {
                      fontFamily: 'inherit',
                      fontSize: 13.25,
                      lineHeight: 1.8,
                      color: '#1e293b',
                      '& fieldset': { borderColor: '#f1f5f9' },
                      '&:hover fieldset': { borderColor: '#cbd5e1' },
                      '&.Mui-focused fieldset': { borderColor: '#ea580c' },
                    },
                  }}
                  onChange={(event) => updateSupportFile((previous) => ({
                    ...previous,
                    sar_draft: event.target.value,
                    decision: {
                      ...(previous.decision || {}),
                      sar_status: event.target.value ? 'Drafted' : 'Not Started',
                      sar_accepted_at: '',
                      sar_accepted_by: '',
                      accepted_sar_draft: '',
                    },
                  }))}
                />
              </Box>

              {/* Right: Final Disposition */}
              <Box
                sx={{
                  bgcolor: '#ffffff',
                  p: 3,
                  borderRadius: 2.5,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                }}
              >
                <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 2 }}>
                  <DecisionIcon sx={{ fontSize: 20, color: '#0f766e' }} />
                  <Typography sx={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>
                    4. Final Case Disposition
                  </Typography>
                </Stack>
                <Typography sx={{ fontSize: 12, color: '#64748b', mb: 2.5 }}>
                  Select conclusive action and provide auditable regulatory justification.
                </Typography>

                <Stack spacing={2}>
                  <FormControl size="small" fullWidth>
                    <InputLabel>Final Disposition Action</InputLabel>
                    <Select
                      value={supportFile.decision.final_action || ''}
                      label="Final Disposition Action"
                      onChange={(event) => updateSupportFile((previous) => ({ ...previous, decision: { ...previous.decision, final_action: event.target.value } }))}
                      sx={{ borderRadius: 1.5 }}
                    >
                      {DECISION_ACTIONS.map((action) => <MenuItem key={action} value={action}>{action}</MenuItem>)}
                    </Select>
                  </FormControl>

                  <TextField
                    fullWidth
                    multiline
                    minRows={3}
                    size="small"
                    label="Analyst Remarks"
                    placeholder="Optional notes or internal review remarks..."
                    value={supportFile.analyst_notes || ''}
                    onChange={(event) => updateSupportFile((previous) => ({ ...previous, analyst_notes: event.target.value }))}
                    sx={{ '& .MuiOutlinedInput-root': { borderRadius: 1.5 } }}
                  />

                  <TextField
                    fullWidth
                    multiline
                    minRows={5}
                    size="small"
                    label="Regulatory Disposition Rationale"
                    placeholder="Explain verified CDD justification, transaction grounds, and SAR recommendation rationale..."
                    value={supportFile.decision.rationale || ''}
                    onChange={(event) => updateSupportFile((previous) => ({ ...previous, decision: { ...previous.decision, rationale: event.target.value } }))}
                    sx={{ '& .MuiOutlinedInput-root': { borderRadius: 1.5 } }}
                  />

                  <Button
                    variant="contained"
                    size="large"
                    startIcon={<SaveIcon />}
                    onClick={handleSave}
                    disabled={saving}
                    sx={{
                      bgcolor: '#0f766e',
                      '&:hover': { bgcolor: '#115e59' },
                      textTransform: 'none',
                      fontWeight: 800,
                      py: 1.25,
                      borderRadius: 1.5,
                    }}
                  >
                    {saving ? 'Submitting Disposition...' : 'Submit Disposition & Finalize'}
                  </Button>
                </Stack>
              </Box>
            </Box>
          </>
        )}
      </Stack>
    </PageContainer>
  );
};

export default CaseResolutionWorkspace;

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
      evidence_type: 'Baseline Anomaly',
      source_module: 'Baseline',
      source_records: [selectedCaseId, item.category].filter(Boolean),
      occurred_at: baseline?.generated_at || baseline?.analysis_date,
      why_it_matters: item.message || item.investigator_note || 'Current activity deviates from the customer baseline.',
      strength: normalizeStrength(item.severity),
      analyst_status: 'pending',
      analyst_comment: '',
      is_key_evidence: false,
    });
  });

  if (graphPatterns && Object.keys(graphPatterns).length) {
    const graphFacts = [
      Number(graphPatterns?.pass_through?.count || 0) > 0 ? `pass-through patterns (${graphPatterns.pass_through.count})` : null,
      Number(graphPatterns?.multi_hop_chains?.count || 0) > 0 ? `multi-hop chains (${graphPatterns.multi_hop_chains.count})` : null,
      Number(graphPatterns?.circular_chains?.count || 0) > 0 ? `circular chains (${graphPatterns.circular_chains.count})` : null,
      Number(graphPatterns?.velocity_bursts_in_chains?.count || 0) > 0 ? `velocity bursts (${graphPatterns.velocity_bursts_in_chains.count})` : null,
    ].filter(Boolean);

    if (graphFacts.length) {
      evidenceItems.push({
        id: 'graph_flow_patterns',
        title: 'Network flow pattern analysis',
        evidence_type: 'Graph Relationship',
        source_module: 'Graph Analysis',
        source_records: toArray(graph?.graph?.paths).slice(0, 3).map((item, index) => item.id || `path_${index + 1}`),
        occurred_at: graph?.generated_at,
        why_it_matters: `Graph analysis surfaced ${graphFacts.join(', ')} across related entities and transaction paths.`,
        strength: evidenceStrengthFromScore(Number(graphPatterns?.flow_score || 0) * 100, 65, 35),
        analyst_status: 'pending',
        analyst_comment: '',
        is_key_evidence: false,
      });
    }
  }

  if (lineage?.evidence_summary) {
    evidenceItems.push({
      id: 'lineage_derivation_context',
      title: 'Lineage-backed derivation review',
      evidence_type: 'Relationship Intelligence',
      source_module: 'Lineage Explorer',
      source_records: [selectedCaseId],
      occurred_at: lineage?.metadata?.generated_at,
      why_it_matters: `Lineage review reports ${lineage.evidence_summary.evidence_strength || 'traceable'} evidence with ${lineage.evidence_summary.data_completeness || 'partial'} data completeness.`,
      strength: normalizeStrength(lineage.evidence_summary.evidence_strength),
      analyst_status: 'pending',
      analyst_comment: '',
      is_key_evidence: false,
    });
  }

  vectorMatches.forEach((item) => {
    evidenceItems.push({
      id: `vector_${slugify(item.case_id)}`,
      title: `Similarity to ${item.case_id}`,
      evidence_type: 'Vector Match',
      source_module: 'Vector Search',
      source_records: [item.case_id],
      occurred_at: vectorModule?.updated_at,
      why_it_matters: item.summary || `Semantic similarity score ${compactNumber(item.score * 100, 0)}%.`,
      strength: evidenceStrengthFromScore(item.score * 100, 82, 60),
      analyst_status: 'pending',
      analyst_comment: '',
      is_key_evidence: false,
    });
  });

  const evidenceById = new Map();
  evidenceItems.forEach((item) => evidenceById.set(item.id, item));

  const claims = [];
  const pushClaim = (id, claim, matcher) => {
    const supported = evidenceItems.filter(matcher).map((item) => item.id);
    if (!supported.length) return;
    claims.push({
      id,
      claim,
      status: 'draft',
      supported_evidence_ids: supported,
      confidence: supported.some((item) => evidenceById.get(item)?.strength === 'Strong') ? 'High' : 'Moderate',
      notes: '',
    });
  };

  pushClaim(
    'claim_structuring',
    'Customer shows possible structuring or anomalous transaction cadence.',
    (item) => /structur|baseline|alert inventory/i.test(`${item.title} ${item.why_it_matters}`),
  );
  pushClaim(
    'claim_layering',
    'Funds appear to move through linked entities in a manner consistent with layering or funnel-account behavior.',
    (item) => /graph|flow|layer|funnel|pass-through|multi-hop/i.test(`${item.title} ${item.why_it_matters}`),
  );
  pushClaim(
    'claim_peer_pattern',
    'Activity aligns with previously investigated typologies and requires corroborated review.',
    (item) => /vector|similarity|typology/i.test(`${item.title} ${item.why_it_matters}`),
  );

  if (!claims.length && hypothesisNarrative) {
    claims.push({
      id: 'claim_primary',
      claim: hypothesisNarrative,
      status: 'draft',
      supported_evidence_ids: evidenceItems.slice(0, 2).map((item) => item.id),
      confidence: 'Needs analyst review',
      notes: '',
    });
  }

  const mitigatingFactors = [];
  if (!toArray(baseline?.deviations).length) {
    mitigatingFactors.push({
      id: 'mitigating_no_baseline_spike',
      factor: 'Current activity does not materially exceed the historical baseline.',
      status: 'open',
      analyst_note: '',
    });
  }
  if (Number(facts?.facts?.alerts?.total_alerts || 0) <= 1) {
    mitigatingFactors.push({
      id: 'mitigating_limited_history',
      factor: 'Limited prior alert history reduces confidence in repeat-behavior conclusions.',
      status: 'open',
      analyst_note: '',
    });
  }
  if (!vectorMatches.length) {
    mitigatingFactors.push({
      id: 'mitigating_no_pattern_match',
      factor: 'Vector search did not identify closely comparable historical cases.',
      status: 'open',
      analyst_note: '',
    });
  }

  const summaryReferences = evidenceItems.slice(0, 6).map((item) => item.id);
  const initialSummaryText = [
    `Case ${selectedCaseId} was reviewed using case-pack context, retained alert activity, transaction history, baseline analysis, graph and lineage outputs, vector intelligence, and the current Evidence Pack.`,
    hypothesisPattern
      ? `The current working hypothesis is ${hypothesisPattern.toLowerCase()}, based on the available investigative indicators captured across the connected modules.`
      : 'The current record does not yet support a single dominant typology, and the investigation remains open pending stronger corroboration.',
    evidenceItems.length
      ? `The current review identified ${evidenceItems.length} evidence item(s), including ${evidenceItems.slice(0, 3).map((item) => item.title.toLowerCase()).join(', ')}.`
      : 'No material evidence items have been assembled yet from the underlying investigation modules.',
    mitigatingFactors.length
      ? `Mitigating considerations remain present, including ${mitigatingFactors[0].factor.toLowerCase()}.`
      : 'No explicit mitigating factors were recorded in the current workspace state.',
    'The case should not proceed to final SAR drafting unless the analyst validates the evidence base and confirms that the mapped findings are adequately supported.',
  ].join(' ');

  const initialCaseSynthesis = {
    reviewed: 'Case Pack context, retained alerts, transaction history, baseline outputs, network and lineage findings, vector intelligence, and analyst-authored inputs were reviewed.',
    found: evidenceItems.length
      ? `${evidenceItems.length} evidence item(s) were assembled from the connected modules for analyst validation.`
      : 'No consolidated findings were available at the time of review.',
    supports_suspicion: evidenceItems.length
      ? 'Suspicion may be supported by the retained alerts, analytical deviations, and relationship findings recorded in the Evidence Pack, subject to analyst acceptance.'
      : 'Suspicion is not yet supported because the Evidence Pack does not contain validated findings.',
    weakens_suspicion: mitigatingFactors.length
      ? mitigatingFactors.map((item) => item.factor).join(' ')
      : 'No material contradictory factors were recorded.',
    requires_validation: 'Analyst validation is required to confirm which evidence items should support the formal investigation narrative and any SAR recommendation.',
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
    content: 'Draft not generated yet. Additional validated evidence may be required before this section is finalized.',
    references: summaryReferences.slice(0, 3),
  }));

  return {
    case_id: selectedCaseId,
    title: 'Case Support File',
    summary: {
      ...summary,
      recommended_disposition: 'Analyst Review Required',
      confidence: 'Pending',
    },
    hypothesis: {
      title: 'Suspicion Hypothesis',
      pattern: hypothesisPattern,
      narrative: hypothesisNarrative,
      supported: false,
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

const ProgressRail = ({ steps }) => (
  <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`, gap: 1.5 }}>
    {steps.map((step) => {
      const active = step.state === 'current';
      const done = step.state === 'done';
      return (
        <Paper
          key={step.key}
          variant="outlined"
          sx={{
            p: 1.5,
            borderRadius: 2,
            borderColor: done ? '#0f766e' : active ? '#d97706' : '#d6d9df',
            background: done ? '#f0fdfa' : active ? '#fff7ed' : '#ffffff',
          }}
        >
          <Stack direction="row" spacing={1} alignItems="center">
            <Box
              sx={{
                width: 18,
                height: 18,
                borderRadius: 99,
                backgroundColor: done ? '#0f766e' : active ? '#d97706' : '#cbd5e1',
                color: '#fff',
                fontSize: 11,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {done ? '✓' : ''}
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: '#0f172a' }}>
                {step.label}
              </Typography>
              <Typography sx={{ fontSize: 10, color: '#64748b', textTransform: 'capitalize' }}>
                {step.state}
              </Typography>
            </Box>
          </Stack>
        </Paper>
      );
    })}
  </Box>
);

const SummaryMetric = ({ label, value, emphasize = false }) => (
  <Paper
    variant="outlined"
    sx={{
      p: 2,
      borderRadius: 2,
      borderColor: emphasize ? '#f59e0b' : '#d9dde5',
      backgroundColor: emphasize ? '#fffbeb' : '#ffffff',
    }}
  >
    <Typography sx={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>
      {label}
    </Typography>
    <Typography sx={{ mt: 0.75, fontSize: emphasize ? 20 : 18, fontWeight: 800, color: '#0f172a' }}>
      {value}
    </Typography>
  </Paper>
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
      if (!caseId || caseId !== String(selectedCaseId || '').trim()) return;
      setRefreshToken((value) => value + 1);
    };
    window.addEventListener(CASE_RESOLUTION_EVENT, handleStoreUpdate);
    return () => window.removeEventListener(CASE_RESOLUTION_EVENT, handleStoreUpdate);
  }, [selectedCaseId]);

  useEffect(() => {
    if (!selectedCaseId) return;
    let active = true;

    const loadWorkspace = async () => {
      setLoading(true);
      setError('');
      setNotice('');
      const localModuleSnapshot = readCaseResolutionCase(selectedCaseId);
      if (active) setModuleSnapshot(localModuleSnapshot);

      const responses = await Promise.allSettled([
        apiClient.getCaseResolutionSupportFile(selectedCaseId),
        apiClient.getCaseFacts(selectedCaseId),
        apiClient.get(`/api/v2/case-pack/${encodeURIComponent(selectedCaseId)}`),
        apiClient.post('/api/v2/analysis/baseline/detect-deviations', { case_id: selectedCaseId, analysis_mode: 'comprehensive' }),
        apiClient.post('/api/v2/analysis/graph/build-full-case', { case_id: selectedCaseId }),
        apiClient.post('/api/v2/explorer/tree-data', { id: selectedCaseId }),
        apiClient.post('/api/v2/rag/similar-cases', { case_id: selectedCaseId, top_k: 5 }),
        apiClient.post('/api/v2/llm/explain-case', { case_id: selectedCaseId }),
        apiClient.post('/api/v2/llm/review-questions', { case_id: selectedCaseId }),
      ]);

      if (!active) return;

      const [
        supportRes,
        factsRes,
        casePackRes,
        baselineRes,
        graphRes,
        lineageRes,
        vectorRes,
        aiExplainRes,
        aiReviewRes,
      ] = responses;

      const savedSupportFile = supportRes.status === 'fulfilled' ? supportRes.value?.support_file : null;
      const nextLiveData = {
        facts: factsRes.status === 'fulfilled' ? factsRes.value : null,
        casePack: casePackRes.status === 'fulfilled' ? casePackRes.value : null,
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
        <Stack direction="row" spacing={1.25}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={() => setRefreshToken((value) => value + 1)}
            disabled={!selectedCaseId || loading}
          >
            Refresh
          </Button>
        </Stack>
      )}
    >
      <Stack spacing={3}>
        <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2.5 }}>
          <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2.5} alignItems={{ xs: 'stretch', lg: 'center' }}>
            <FormControl size="small" sx={{ minWidth: 280 }}>
              <InputLabel>Case ID</InputLabel>
              <Select value={selectedCaseId} label="Case ID" onChange={(event) => setSelectedCaseId(event.target.value)}>
                {caseList.map((item) => {
                  const id = String(item.case_id || item.caseid || item.id || '');
                  return <MenuItem key={id} value={id}>{id}</MenuItem>;
                })}
              </Select>
            </FormControl>
            <Alert severity="info" sx={{ flex: 1, border: '1px solid #bfdbfe', backgroundColor: '#eff6ff' }}>
              This workspace pulls the case JSON directly from the connected investigation APIs, shows the source data for review, and generates the SAR draft from the combined case record. The analyst can then edit the draft, add remarks, and submit the final disposition.
            </Alert>
          </Stack>
        </Paper>

        {error ? <Alert severity="error" onClose={() => setError('')}>{error}</Alert> : null}
        {notice ? <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert> : null}

        {loading || !supportFile ? (
          <Paper variant="outlined" sx={{ p: 5, borderRadius: 2.5, textAlign: 'center' }}>
            <CircularProgress size={34} />
            <Typography sx={{ mt: 2, fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
              Preparing the case support workspace...
            </Typography>
          </Paper>
        ) : (
          <>
            <ProgressRail steps={supportFile.progress_steps || deriveProgress(supportFile)} />

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1.35fr 0.9fr' }, gap: 2.5, alignItems: 'start' }}>
              <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2.5 }}>
                <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }}>
                  <ResolutionIcon sx={{ color: '#1d4ed8' }} />
                  <Typography sx={{ fontSize: 17, fontWeight: 800, color: '#0f172a' }}>Investigation Summary</Typography>
                </Stack>
                <Typography sx={{ fontSize: 14, lineHeight: 1.9, color: '#1f2937', whiteSpace: 'pre-wrap' }}>
                  {supportFile.investigation_summary?.text || 'Investigation narrative is not available yet.'}
                </Typography>
                <Typography sx={{ mt: 1.5, fontSize: 12.5, color: '#64748b' }}>
                  {supportFile.investigation_summary?.status_note || supportFile.sar_readiness.reason}
                </Typography>
                <Stack direction="row" spacing={1} sx={{ mt: 1.75 }} flexWrap="wrap" useFlexGap>
                  {summaryReferences.map((ref) => (
                    <Chip key={ref} label={evidenceLookup.get(ref)?.title || ref} size="small" variant="outlined" />
                  ))}
                </Stack>
              </Paper>

              <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2.5 }}>
                <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }}>
                  <WarningIcon sx={{ color: '#d97706' }} />
                  <Typography sx={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>Case Snapshot</Typography>
                </Stack>
                <Stack spacing={1.25}>
                  <SummaryMetric label="Case ID" value={supportFile.summary.case_id} />
                  <SummaryMetric label="Alert Count" value={compactNumber(supportFile.summary.alert_count)} />
                  <SummaryMetric label="Risk Score" value={compactNumber(supportFile.summary.risk_score, 0)} emphasize />
                  <SummaryMetric label="SAR Readiness" value={supportFile.sar_readiness.status} />
                </Stack>
              </Paper>
            </Box>

            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2.5 }}>
              <Typography sx={{ fontSize: 16, fontWeight: 800, color: '#0f172a', mb: 2 }}>
                Review Source Data
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1fr 1.15fr' }, gap: 2 }}>
                <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: '#0f172a', mb: 1 }}>Alerts Reviewed</Typography>
                  <Box sx={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ backgroundColor: '#f8fafc' }}>
                          <th style={{ textAlign: 'left', padding: '8px 10px' }}>Alert</th>
                          <th style={{ textAlign: 'left', padding: '8px 10px' }}>Rule</th>
                          <th style={{ textAlign: 'left', padding: '8px 10px' }}>Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {toArray(liveData?.casePack?.alerts).slice(0, 6).map((item, index) => (
                          <tr key={`alert_row_${index + 1}`} style={{ borderTop: '1px solid #e2e8f0' }}>
                            <td style={{ padding: '8px 10px' }}>{item.alert_id || item.ALERT_ID || '-'}</td>
                            <td style={{ padding: '8px 10px' }}>{item.rule_triggered || item.RULE_TRIGGERED || '-'}</td>
                            <td style={{ padding: '8px 10px' }}>{fmtDateTime(item.alert_date || item.ALERT_DATE || item.date)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Box>
                </Paper>

                <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: '#0f172a', mb: 1 }}>Related Transactions</Typography>
                  <Box sx={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ backgroundColor: '#f8fafc' }}>
                          <th style={{ textAlign: 'left', padding: '8px 10px' }}>Reference</th>
                          <th style={{ textAlign: 'left', padding: '8px 10px' }}>Type</th>
                          <th style={{ textAlign: 'right', padding: '8px 10px' }}>Amount</th>
                          <th style={{ textAlign: 'left', padding: '8px 10px' }}>Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {toArray(liveData?.casePack?.ledger).slice(0, 8).map((item, index) => (
                          <tr key={`txn_row_${index + 1}`} style={{ borderTop: '1px solid #e2e8f0' }}>
                            <td style={{ padding: '8px 10px' }}>{item.reference || item.transaction_id || item.TRANSACTION_ID || '-'}</td>
                            <td style={{ padding: '8px 10px' }}>{item.type || item.txn_type || '-'}</td>
                            <td style={{ padding: '8px 10px', textAlign: 'right' }}>{compactNumber(item.amount || item.TXN_AMOUNT || 0, 2)}</td>
                            <td style={{ padding: '8px 10px' }}>{fmtDateTime(item.date || item.ts || item.TXN_TIMESTAMP)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Box>
                </Paper>
              </Box>
            </Paper>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'repeat(3, 1fr)' }, gap: 2 }}>
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5 }}>
                <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: '#0f172a', mb: 1 }}>Case Data Explained</Typography>
                <Typography sx={{ fontSize: 12.75, lineHeight: 1.7, color: '#334155' }}>
                  {supportFile.case_synthesis?.reviewed}
                </Typography>
              </Paper>
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5 }}>
                <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: '#0f172a', mb: 1 }}>Baseline Review</Typography>
                <Typography sx={{ fontSize: 12.75, lineHeight: 1.7, color: '#334155' }}>
                  {toArray(liveData?.baseline?.deviations).length
                    ? `${toArray(liveData?.baseline?.deviations).length} deviation finding(s) were identified. ${toArray(liveData?.baseline?.deviations).slice(0, 2).map((item) => item.message || item.type || item.category).join(' ')}`
                    : 'No meaningful baseline deviations were returned for this case.'}
                </Typography>
              </Paper>
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5 }}>
                <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: '#0f172a', mb: 1 }}>Graph and Lineage Review</Typography>
                <Typography sx={{ fontSize: 12.75, lineHeight: 1.7, color: '#334155' }}>
                  {liveData?.graph?.narrative || supportFile.case_synthesis?.found || 'No graph narrative was available for this case.'}
                </Typography>
              </Paper>
            </Box>

            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2.5 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                <Box>
                  <Typography sx={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>SAR Draft</Typography>
                  <Typography sx={{ mt: 0.5, fontSize: 12.5, color: '#64748b' }}>
                    The draft below is generated from the combined case data. The analyst can edit it and add remarks before submission.
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ mt: 1.25 }} flexWrap="wrap" useFlexGap>
                    <Chip
                      size="small"
                      color={supportFile?.decision?.sar_status === 'Accepted' ? 'success' : 'default'}
                      variant={supportFile?.decision?.sar_status === 'Accepted' ? 'filled' : 'outlined'}
                      label={supportFile?.decision?.sar_status || (supportFile?.sar_draft ? 'Drafted' : 'Not Started')}
                    />
                    {supportFile?.decision?.sar_accepted_at ? (
                      <Chip
                        size="small"
                        variant="outlined"
                        label={`Accepted ${fmtDateTime(supportFile.decision.sar_accepted_at)}`}
                      />
                    ) : null}
                  </Stack>
                </Box>
                <Stack direction="row" spacing={1}>
                  <Button
                    variant="outlined"
                    startIcon={<AcceptIcon />}
                    onClick={handleAcceptSar}
                    disabled={!supportFile?.sar_draft || saving}
                  >
                    {saving && supportFile?.decision?.sar_status !== 'Accepted' ? 'Saving...' : 'Accept SAR'}
                  </Button>
                  <Button
                    variant="contained"
                    startIcon={drafting ? <CircularProgress size={14} color="inherit" /> : <SparklesIcon />}
                    onClick={handleGenerateSar}
                    disabled={!selectedCaseId || !supportFile || drafting}
                  >
                    {drafting ? 'Drafting...' : 'Draft SAR'}
                  </Button>
                </Stack>
              </Stack>
              <Stack spacing={2}>
                <TextField
                  fullWidth
                  multiline
                  minRows={18}
                  size="small"
                  value={supportFile.sar_draft || ''}
                  placeholder={'Draft SAR will appear here after generation.'}
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
              </Stack>
            </Paper>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1.1fr 1fr' }, gap: 2.5, alignItems: 'start' }}>
              <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2.5 }}>
                <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }}>
                  <LedgerIcon sx={{ color: '#0f766e' }} />
                  <Typography sx={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>Connected Source Coverage</Typography>
                </Stack>
                <Stack spacing={1.25}>
                  <Typography sx={{ fontSize: 12.75, color: '#334155', lineHeight: 1.7 }}>
                    Case Pack alerts, transaction history, baseline analysis, graph analysis, lineage output, case facts, vector similarity results, and AI explanation endpoints are all pulled directly for this case and assembled into one JSON payload before SAR generation.
                  </Typography>
                  <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                    <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>Lineage Evidence</Typography>
                    <Typography sx={{ mt: 0.75, fontSize: 12.5, color: '#475569', lineHeight: 1.65 }}>
                      {liveData?.lineage?.evidence_summary
                        ? `Evidence strength is ${liveData.lineage.evidence_summary.evidence_strength || 'available'} with ${liveData.lineage.evidence_summary.data_completeness || 'partial'} data completeness.`
                        : 'Lineage evidence summary was not available for this case.'}
                    </Typography>
                  </Paper>
                  <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                    <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>Stored JSON Payload</Typography>
                    <Typography sx={{ mt: 0.75, fontSize: 12.5, color: '#475569', lineHeight: 1.65 }}>
                      {supportFile?.source_payload ? 'The combined per-case JSON payload is present and is used as the source for draft generation.' : 'Combined case JSON payload is missing.'}
                    </Typography>
                  </Paper>
                </Stack>
              </Paper>

              <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2.5 }}>
                <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }}>
                  <DecisionIcon sx={{ color: '#0f766e' }} />
                  <Typography sx={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>Submit Disposition</Typography>
                </Stack>
                <Stack spacing={1.25}>
                  <FormControl size="small" fullWidth>
                    <InputLabel>Decision</InputLabel>
                    <Select value={supportFile.decision.final_action || ''} label="Decision" onChange={(event) => updateSupportFile((previous) => ({ ...previous, decision: { ...previous.decision, final_action: event.target.value } }))}>
                      {DECISION_ACTIONS.map((action) => <MenuItem key={action} value={action}>{action}</MenuItem>)}
                    </Select>
                  </FormControl>
                  <TextField fullWidth multiline minRows={3} size="small" label="Analyst remarks" value={supportFile.analyst_notes || ''} onChange={(event) => updateSupportFile((previous) => ({ ...previous, analyst_notes: event.target.value }))} />
                  <TextField fullWidth multiline minRows={3} size="small" label="Disposition rationale" value={supportFile.decision.rationale || ''} onChange={(event) => updateSupportFile((previous) => ({ ...previous, decision: { ...previous.decision, rationale: event.target.value } }))} />
                  <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSave} disabled={saving}>
                    {saving ? 'Submitting...' : 'Submit'}
                  </Button>
                </Stack>
              </Paper>
            </Box>
          </>
        )}
      </Stack>
    </PageContainer>
  );
};

export default CaseResolutionWorkspace;

export const calculateEvidenceMetrics = (treeData, reviewedNodes) => {
  if (!treeData || !treeData.evidence_summary) return null;
  
  const summary = treeData.evidence_summary;
  const lineageNode = treeData.children?.find(c => c.type === 'Lineage');
  const evidenceNodes = lineageNode?.children?.filter(c => c.type === 'DerivedField') || [];
  
  const reviewed = evidenceNodes.filter(n => reviewedNodes.has(n.id)).length;
  const total = evidenceNodes.length;
  
  return {
    ...summary,
    reviewed_count: reviewed,
    total_metrics: total,
    progress: total > 0 ? (reviewed / total) * 100 : 0
  };
};

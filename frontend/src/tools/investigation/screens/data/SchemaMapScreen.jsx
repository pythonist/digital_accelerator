import React, { useEffect, useRef } from 'react';
import { useAppContext } from "@context/AppContext";
import apiClient from "@services/api";
import PageContainer from "@investigation/layout/PageContainer";
import { Network, Database, ShieldCheck } from 'lucide-react';

const SchemaMapScreen = () => {
  const mermaidRef = useRef(null);
  const chartDefinition = `
    classDiagram
      direction TB
      class UCIC_Master { PK UCIC, String Risk_Segment, String KYC_Risk }
      class Customers { PK Customer_ID, FK UCIC, String Customer_Type }
      class Accounts { PK Account_ID, FK Customer_ID, FK UCIC, String Status }
      class Transactions { PK Transaction_ID, FK Account_ID, FK UCIC, Float Amount }
      class Alerts { PK Alert_ID, FK Case_ID, FK UCIC, FK Transaction_ID }
      class Cases { PK Case_ID, FK UCIC, String Risk_Level }

      UCIC_Master "1" -- "0..*" Customers : Identifies
      UCIC_Master "1" -- "0..*" Accounts : owns
      UCIC_Master "1" -- "0..*" Cases : linked_to
      Customers "1" -- "0..*" Accounts : holds
      Accounts "1" -- "0..*" Transactions : source
      Cases "1" -- "0..*" Alerts : contains
      Alerts "1" -- "0..1" Transactions : flags
  `;

  useEffect(() => {
    if (window.mermaid) {
      window.mermaid.initialize({ startOnLoad: true, theme: 'default' });
      window.mermaid.contentLoaded();
    }
  }, []);

  return (
    <PageContainer title="Data Schema & Mapping" subtitle="UCIC-Centric Data Model">
      <div style={{ background: 'white', padding: '2rem', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'center', overflow: 'auto' }}>
        <div className="mermaid" ref={mermaidRef}>{chartDefinition}</div>
      </div>
      <div style={{ marginTop: '2rem', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem' }}>
        <MappingCard title="UCIC Master Key" icon={<Network size={20} color="#3b82f6" />} desc="The Unique Customer ID (UCIC) unifies profiles across multiple source systems and products." />
        <MappingCard title="Source Systems" icon={<Database size={20} color="#10b981" />} desc="Data ingested from Core Banking, Credit Cards, and UPI systems is normalized into this schema." />
        <MappingCard title="Case Aggregation" icon={<ShieldCheck size={20} color="#8b5cf6" />} desc="Alerts are aggregated into Cases based on Case ID, rolled up to the UCIC level." />
      </div>
    </PageContainer>
  );
};

const MappingCard = ({ title, icon, desc }) => (
  <div style={{ padding: '1.5rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
      <div style={{ padding: '0.5rem', background: 'white', borderRadius: '6px', border: '1px solid #e2e8f0' }}>{icon}</div>
      <div style={{ fontWeight: '600', color: '#1e293b' }}>{title}</div>
    </div>
    <div style={{ fontSize: '0.875rem', color: '#64748b', lineHeight: '1.5' }}>{desc}</div>
  </div>
);

export default SchemaMapScreen;
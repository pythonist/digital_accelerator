// tools/investigation/InvestigationPlatform.jsx
import React, { useState } from 'react';

// Layout
import MainLayout from './layout/MainLayout';

// Data Screens
import DataLoadScreen from './screens/data/DataLoadScreen';
import DataTableScreen from './screens/data/DataTableScreen';
import SmartMergeScreen from './screens/data/SmartMergeScreen';
import AutoBuildScreen from './screens/data/AutoBuildScreen';
import SchemaMapScreen from './screens/data/SchemaMapScreen';
import DynamicDashboardScreen from './screens/data/DynamicDashboardScreen';
import DataCleanScreen from './screens/data/DataCleanScreen';
import MasterDashboardScreen from './screens/data/MasterDashboardScreen';
import ConnectorManagementScreen from './screens/data/ConnectorManagementScreen';
import IngestionHistoryScreen from './screens/data/IngestionHistoryScreen';

// Case Work Screens
import CasePriorityInbox from './screens/cases/CasePriorityInbox';
import CasePackViewer from './screens/cases/CasePackViewer';
import DataTreeScreen from './screens/cases/DataTreeScreen';
import CompareCasesScreen from './screens/cases/CompareCasesScreen';
import ChatAssistantScreen from './screens/cases/ChatAssistantScreen';
import CaseInvestigationScreen from './screens/cases/CaseInvestigationScreen';

// Analysis Screens
import GraphAnalysisScreen from './screens/analysis/GraphAnalysisScreen';
import RuleEngineScreen from './screens/analysis/RuleEngineScreen';
import TypologyAnalysisScreen from './screens/analysis/TypologyAnalysisScreen';
import BaselineAnalysisScreen from './screens/analysis/BaselineAnalysisScreen';
import VectorSearchScreen from './screens/analysis/VectorSearchScreen';

// Admin Screens
import AuditTrailScreen from "@screens/admin/AuditTrailScreen";
import EnvironmentManagerScreen from "@screens/admin/EnvironmentManagerScreen";

const InvestigationPlatform = () => {
  const [activeTab, setActiveTab] = useState('priority');

  const renderScreen = () => {
    switch (activeTab) {
      // Data Management
      case 'load': return <DataLoadScreen setActiveScreen={setActiveTab} />;
      case 'connectors': return <ConnectorManagementScreen />;
      case 'history': return <IngestionHistoryScreen />;
      case 'table': return <DataTableScreen />;
      case 'schema': return <SchemaMapScreen />;
      case 'merge': return <SmartMergeScreen />;
      case 'build': return <AutoBuildScreen />;
      case 'clean': return <DataCleanScreen />;
      case 'dashboard': return <MasterDashboardScreen />;
      case 'dynamic': return <DynamicDashboardScreen />;
      
      // Investigation
      case 'priority': return <CasePriorityInbox setActiveTab={setActiveTab} />;
      case 'casepack': return <CasePackViewer />;
      case 'investigate': return <CaseInvestigationScreen />;
      case 'tree': return <DataTreeScreen />;
      case 'compare': return <CompareCasesScreen />;
      case 'chat': return <ChatAssistantScreen />;
      
      // Analysis
      case 'rules': return <RuleEngineScreen />;
      case 'typology': return <TypologyAnalysisScreen />;
      case 'graph': return <GraphAnalysisScreen />;
      case 'baseline': return <BaselineAnalysisScreen />;
      case 'vector': return <VectorSearchScreen />;
      
      // System
      case 'audit': return <AuditTrailScreen />;
      case 'env_manager': return <EnvironmentManagerScreen />;
      
      default: return <CasePriorityInbox setActiveTab={setActiveTab} />;
    }
  };

  return (
    // ✅ The Single Source of Layout Truth
    <MainLayout activeScreen={activeTab} setActiveScreen={setActiveTab}>
      {renderScreen()}
    </MainLayout>
  );
};

export default InvestigationPlatform;

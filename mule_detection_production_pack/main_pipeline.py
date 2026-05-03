import json
from config import CONFIG
from utils import print_step
from data_ingestion import DataIngestion
from entity_resolution import EntityResolution
from feature_engineering import FeatureEngineering
from graph_analytics import GraphAnalytics
from sequence_models import SequenceModels
from multiclass_model import MulticlassModel
from alert_engine import AlertEngine
from feedback_loop import FeedbackLoop

def champion_challenger_and_kpi(test_df, y_test, test_pred, test_pred_ch, test_prob):
    from sklearn.metrics import accuracy_score, f1_score
    import pandas as pd
    comparison = pd.DataFrame({
        "model": ["champion_calibrated", "challenger_logistic"],
        "accuracy": [accuracy_score(y_test, test_pred), accuracy_score(y_test, test_pred_ch)],
        "macro_f1": [f1_score(y_test, test_pred, average="macro"), f1_score(y_test, test_pred_ch, average="macro")],
        "weighted_f1": [f1_score(y_test, test_pred, average="weighted"), f1_score(y_test, test_pred_ch, average="weighted")]
    })
    test_df["before_score"] = test_prob.max(axis=1)
    test_df["after_score"] = test_df["final_mule_score"]
    before_high = (test_df["before_score"] >= 0.7).sum()
    after_high = (test_df["after_score"] >= 0.7).sum()
    before_precision = test_df.loc[test_df["before_score"] >= 0.7, "label"].isin(CONFIG["risky_labels"]).mean()
    after_precision = test_df.loc[test_df["after_score"] >= 0.7, "label"].isin(CONFIG["risky_labels"]).mean()
    kpi_table = pd.DataFrame({"metric": ["high_risk_volume", "precision_proxy"], "before": [before_high, before_precision], "after": [after_high, after_precision]})
    kpi_table["delta"] = kpi_table["after"] - kpi_table["before"]
    return comparison, kpi_table

def main():
    print_step("FINAL PRODUCTION PACKAGE PIPELINE START")
    ingestion = DataIngestion()
    raw_tables = ingestion.generate_raw_tables()
    txn_tables = ingestion.generate_transaction_tables(raw_tables)
    entity = EntityResolution()
    entity_views = entity.build_entity_views(raw_tables)
    events = entity.build_unified_events(txn_tables)
    single_view = entity.build_single_view(events, entity_views)
    feat = FeatureEngineering()
    single_view = feat.run_eda_and_imputation(single_view)
    feature_df = feat.feature_engineering(single_view)
    graph = GraphAnalytics()
    feature_df, graph_features = graph.model1_graph_analytics(feature_df)
    feature_df, ring_df = graph.model2_ring_detection(feature_df)
    modeler = MulticlassModel()
    train_df, valid_df, test_df = modeler.split_time_based(feature_df, CONFIG["train_end"], CONFIG["valid_end"])
    seq = SequenceModels()
    model3, train_df, valid_df, test_df = seq.model3_hazard(train_df, valid_df, test_df)
    model4, train_df, valid_df, test_df = seq.model4_hmm(train_df, valid_df, test_df)
    model5_outputs = seq.model5_lstm_and_transformer(train_df, valid_df, test_df)
    model6_artifacts, feature_cols, y_valid, y_test, valid_prob, test_prob, valid_pred, test_pred, valid_pred_ch, test_pred_ch, feature_importance = modeler.model6_multiclass(train_df, valid_df, test_df)
    alert_engine = AlertEngine()
    test_df = alert_engine.model7_decision_engine(test_df, test_prob, model6_artifacts, model5_outputs)
    alert_output, threshold_tbl, channel_thresholds_tbl, class_thresholds_tbl, enriched_alert_df, th_opt = alert_engine.model8_alert_pack(test_df, test_prob, model6_artifacts)
    feedback = FeedbackLoop()
    feedback_outputs = feedback.weak_supervision_and_feedback(feature_df, alert_output)
    comparison_tbl, kpi_tbl = champion_challenger_and_kpi(test_df, y_test, test_pred, test_pred_ch, test_prob)
    governance_summary = {
        "model1_graph_analytics": True,
        "model2_ring_detection": True,
        "model3_hazard_model": True,
        "model4_hmm": True,
        "model5_lstm_transformer_ready": True,
        "model6_multiclass_typology": True,
        "model7_decision_engine": True,
        "model8_alert_pack": True,
        "calibration": "isotonic",
        "time_based_validation": True,
        "feature_count": len(feature_cols),
        "classes": list(model6_artifacts.label_encoder.classes_)
    }
    print(json.dumps(governance_summary, indent=2))
    return {
        "raw_tables": raw_tables,
        "txn_tables": txn_tables,
        "entity_views": entity_views,
        "events": events,
        "single_view": single_view,
        "feature_df": feature_df,
        "graph_features": graph_features,
        "ring_df": ring_df,
        "train_df": train_df,
        "valid_df": valid_df,
        "test_df": test_df,
        "model3_hazard": model3,
        "model4_hmm": model4,
        "model5_outputs": model5_outputs,
        "model6_artifacts": model6_artifacts,
        "feature_importance": feature_importance,
        "alert_output": alert_output,
        "threshold_table": threshold_tbl,
        "channel_thresholds": channel_thresholds_tbl,
        "class_thresholds": class_thresholds_tbl,
        "feedback_outputs": feedback_outputs,
        "comparison_tbl": comparison_tbl,
        "kpi_tbl": kpi_tbl,
        "governance_summary": governance_summary
    }

if __name__ == "__main__":
    outputs = main()
    print("Pipeline complete.")

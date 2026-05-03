import numpy as np
import pandas as pd
from dataclasses import dataclass
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import LabelEncoder, OneHotEncoder
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.calibration import CalibratedClassifierCV
from sklearn.metrics import classification_report, accuracy_score, f1_score, top_k_accuracy_score, confusion_matrix
from utils import print_step, month_backtest_table

USE_SHAP = False
try:
    import shap
    USE_SHAP = True
except Exception:
    pass

@dataclass
class Model6Artifacts:
    preprocessor: any
    label_encoder: any
    base_model: any
    calibrated_model: any
    challenger_model: any
    feature_names: np.ndarray

class MulticlassModel:
    def split_time_based(self, df, train_end, valid_end):
        train_df = df[df["event_ts"] <= pd.to_datetime(train_end)].copy()
        valid_df = df[(df["event_ts"] > pd.to_datetime(train_end)) & (df["event_ts"] <= pd.to_datetime(valid_end))].copy()
        test_df = df[df["event_ts"] > pd.to_datetime(valid_end)].copy()
        return train_df, valid_df, test_df

    def model6_multiclass(self, train_df, valid_df, test_df):
        print_step("STEP 14: MODEL6 MULTICLASS")
        exclude_cols = ["transaction_id","event_ts","label","mule_category","prev_event_ts","session_id","transition_path","upi_transaction_id","atm_transaction_id","branch_transaction_id","merchant_transaction_id"]
        feature_cols = [c for c in train_df.columns if c not in exclude_cols]
        X_train, X_valid, X_test = train_df[feature_cols].copy(), valid_df[feature_cols].copy(), test_df[feature_cols].copy()
        label_enc = LabelEncoder()
        y_train = label_enc.fit_transform(train_df["label"].astype(str))
        y_valid = label_enc.transform(valid_df["label"].astype(str))
        y_test = label_enc.transform(test_df["label"].astype(str))
        cat_cols = X_train.select_dtypes(include=["object", "category"]).columns.tolist()
        num_cols = [c for c in X_train.columns if c not in cat_cols]
        preprocessor = ColumnTransformer([
            ("num", Pipeline([("imputer", SimpleImputer(strategy="median"))]), num_cols),
            ("cat", Pipeline([("imputer", SimpleImputer(strategy="most_frequent")), ("onehot", OneHotEncoder(handle_unknown="ignore"))]), cat_cols)
        ])
        X_train_proc = preprocessor.fit_transform(X_train)
        X_valid_proc = preprocessor.transform(X_valid)
        X_test_proc = preprocessor.transform(X_test)
        try: feature_names = preprocessor.get_feature_names_out()
        except Exception: feature_names = np.array([f"f_{i}" for i in range(X_train_proc.shape[1])])
        base_model = RandomForestClassifier(n_estimators=300, max_depth=14, min_samples_leaf=5, class_weight="balanced_subsample", n_jobs=-1, random_state=42)
        base_model.fit(X_train_proc, y_train)
        calibrated_model = CalibratedClassifierCV(base_model, method="isotonic", cv=3)
        calibrated_model.fit(X_train_proc, y_train)
        challenger_model = LogisticRegression(max_iter=1000, class_weight="balanced")
        challenger_model.fit(X_train_proc, y_train)
        valid_prob, test_prob = calibrated_model.predict_proba(X_valid_proc), calibrated_model.predict_proba(X_test_proc)
        valid_pred, test_pred = np.argmax(valid_prob, axis=1), np.argmax(test_prob, axis=1)
        valid_prob_ch, test_prob_ch = challenger_model.predict_proba(X_valid_proc), challenger_model.predict_proba(X_test_proc)
        valid_pred_ch, test_pred_ch = np.argmax(valid_prob_ch, axis=1), np.argmax(test_prob_ch, axis=1)
        print(classification_report(y_test, test_pred, target_names=label_enc.classes_))
        print("Accuracy:", accuracy_score(y_test, test_pred))
        print("Macro F1:", f1_score(y_test, test_pred, average="macro"))
        print("Top-2 accuracy:", top_k_accuracy_score(y_test, test_prob, k=2, labels=np.arange(len(label_enc.classes_))))
        print("Top-3 accuracy:", top_k_accuracy_score(y_test, test_prob, k=3, labels=np.arange(len(label_enc.classes_))))
        fi = pd.DataFrame({"feature": feature_names, "importance": base_model.feature_importances_}).sort_values("importance", ascending=False)
        print(fi.head(20))
        print(month_backtest_table(test_df["event_ts"], y_test, test_pred))
        if USE_SHAP:
            try:
                explainer = shap.TreeExplainer(base_model)
                shap_values = explainer.shap_values(X_test_proc[:1000])
                shap.summary_plot(shap_values, X_test_proc[:1000], feature_names=feature_names)
            except Exception as e:
                print("SHAP failed:", e)
        artifacts = Model6Artifacts(preprocessor, label_enc, base_model, calibrated_model, challenger_model, feature_names)
        return artifacts, feature_cols, y_valid, y_test, valid_prob, test_prob, valid_pred, test_pred, valid_pred_ch, test_pred_ch, fi

    def plot_confusion_matrix(self, y_true, y_pred, label_encoder):
        return confusion_matrix(y_true, y_pred)

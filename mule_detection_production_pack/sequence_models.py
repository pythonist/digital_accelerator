import numpy as np
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from config import CONFIG
from utils import print_step

USE_HMM = False
USE_TF = False
try:
    from hmmlearn import hmm
    USE_HMM = True
except Exception:
    pass
try:
    import tensorflow as tf
    from tensorflow.keras.models import Sequential
    from tensorflow.keras.layers import LSTM, Dense, Masking
    USE_TF = True
except Exception:
    pass

class SequenceModels:
    def model3_hazard(self, train_df, valid_df, test_df):
        print_step("STEP 11: MODEL3 HAZARD")
        hazard_features = ["hours_since_prev_txn","first_time_counterparty","first_time_device","first_time_channel","shared_device_risk","shared_ip_risk","fanout_flag","velocity_flag","transition_score","dormant_activation_flag"]
        hazard_features = [c for c in hazard_features if c in train_df.columns]
        for d in [train_df, valid_df, test_df]:
            d["emerging_mule_flag"] = d["label"].isin(CONFIG["risky_labels"]).astype(int)
        imp = SimpleImputer(strategy="median")
        X_train = imp.fit_transform(train_df[hazard_features])
        X_valid = imp.transform(valid_df[hazard_features])
        X_test = imp.transform(test_df[hazard_features])
        model = LogisticRegression(max_iter=1000, class_weight="balanced")
        model.fit(X_train, train_df["emerging_mule_flag"])
        valid_df["hazard_score"] = model.predict_proba(X_valid)[:, 1]
        test_df["hazard_score"] = model.predict_proba(X_test)[:, 1]
        return model, train_df, valid_df, test_df

    def model4_hmm(self, train_df, valid_df, test_df):
        print_step("STEP 12: MODEL4 HMM")
        hmm_features = ["amount","event_hour","hours_since_prev_txn","velocity_flag","fanout_flag","transition_score","shared_device_risk","shared_ip_risk","dormant_activation_flag"]
        hmm_features = [c for c in hmm_features if c in train_df.columns]
        if not USE_HMM or len(hmm_features) == 0:
            for d in [train_df, valid_df, test_df]:
                d["hmm_state"] = 0
                d["hmm_sequence_anomaly_score"] = 0.0
            return None, train_df, valid_df, test_df
        scaler = StandardScaler()
        X_train = scaler.fit_transform(train_df[hmm_features].fillna(0))
        X_valid = scaler.transform(valid_df[hmm_features].fillna(0))
        X_test = scaler.transform(test_df[hmm_features].fillna(0))
        hmm_model = hmm.GaussianHMM(n_components=5, covariance_type="diag", n_iter=200, random_state=42)
        hmm_model.fit(X_train)
        train_df["hmm_state"] = hmm_model.predict(X_train)
        valid_df["hmm_state"] = hmm_model.predict(X_valid)
        test_df["hmm_state"] = hmm_model.predict(X_test)
        _, train_log = hmm_model.score_samples(X_train)
        _, valid_log = hmm_model.score_samples(X_valid)
        _, test_log = hmm_model.score_samples(X_test)
        train_df["hmm_sequence_anomaly_score"] = -np.mean(train_log)
        valid_df["hmm_sequence_anomaly_score"] = -np.mean(valid_log)
        test_df["hmm_sequence_anomaly_score"] = -np.mean(test_log)
        return hmm_model, train_df, valid_df, test_df

    def build_sequence_tensor(self, df, feature_cols, entity_col="customer_id", time_col="event_ts", max_len=25):
        seqs, ids = [], []
        df = df.sort_values([entity_col, time_col]).copy()
        for ent_id, part in df.groupby(entity_col):
            vals = part[feature_cols].fillna(0).values
            if len(vals) > max_len:
                vals = vals[-max_len:]
            elif len(vals) < max_len:
                pad = np.zeros((max_len - len(vals), len(feature_cols)))
                vals = np.vstack([pad, vals])
            seqs.append(vals)
            ids.append(ent_id)
        return np.array(seqs), ids

    def build_transformer_inputs(self, df, feature_cols, entity_col="customer_id", time_col="event_ts", max_len=25):
        X, masks, ids = [], [], []
        df = df.sort_values([entity_col, time_col]).copy()
        for ent_id, part in df.groupby(entity_col):
            vals = part[feature_cols].fillna(0).values
            length = len(vals)
            if length > max_len:
                vals = vals[-max_len:]
                mask = np.ones(max_len)
            else:
                pad_len = max_len - length
                vals = np.vstack([np.zeros((pad_len, len(feature_cols))), vals])
                mask = np.concatenate([np.zeros(pad_len), np.ones(length)])
            X.append(vals)
            masks.append(mask)
            ids.append(ent_id)
        return np.array(X), np.array(masks), ids

    def model5_lstm_and_transformer(self, train_df, valid_df, test_df):
        print_step("STEP 13: MODEL5 LSTM + TRANSFORMER INPUTS")
        feature_cols = ["amount","event_hour","hours_since_prev_txn","first_time_counterparty","first_time_device","first_time_channel","shared_device_risk","shared_ip_risk","fanout_flag","velocity_flag","transition_score","dormant_activation_flag"]
        feature_cols = [c for c in feature_cols if c in train_df.columns]
        X_train_seq, train_ids = self.build_sequence_tensor(train_df, feature_cols, max_len=CONFIG["sequence_max_len"])
        X_valid_seq, valid_ids = self.build_sequence_tensor(valid_df, feature_cols, max_len=CONFIG["sequence_max_len"])
        X_test_seq, test_ids = self.build_sequence_tensor(test_df, feature_cols, max_len=CONFIG["sequence_max_len"])
        X_train_tr, train_mask, _ = self.build_transformer_inputs(train_df, feature_cols, max_len=CONFIG["sequence_max_len"])
        X_valid_tr, valid_mask, _ = self.build_transformer_inputs(valid_df, feature_cols, max_len=CONFIG["sequence_max_len"])
        X_test_tr, test_mask, _ = self.build_transformer_inputs(test_df, feature_cols, max_len=CONFIG["sequence_max_len"])
        train_target_map = train_df.groupby("customer_id")["label"].apply(lambda s: int(s.isin(CONFIG["risky_labels"]).any())).to_dict()
        valid_target_map = valid_df.groupby("customer_id")["label"].apply(lambda s: int(s.isin(CONFIG["risky_labels"]).any())).to_dict()
        test_target_map = test_df.groupby("customer_id")["label"].apply(lambda s: int(s.isin(CONFIG["risky_labels"]).any())).to_dict()
        y_train_seq = np.array([train_target_map.get(i, 0) for i in train_ids])
        y_valid_seq = np.array([valid_target_map.get(i, 0) for i in valid_ids])
        if not USE_TF or len(X_train_seq) == 0:
            return {"lstm_model": None, "valid_lstm_prob": np.zeros(len(valid_ids)), "test_lstm_prob": np.zeros(len(test_ids)), "valid_ids": valid_ids, "test_ids": test_ids, "train_attention_mask": train_mask, "valid_attention_mask": valid_mask, "test_attention_mask": test_mask}
        lstm_model = Sequential([Masking(mask_value=0.0, input_shape=(X_train_seq.shape[1], X_train_seq.shape[2])), LSTM(64), Dense(32, activation="relu"), Dense(1, activation="sigmoid")])
        lstm_model.compile(optimizer="adam", loss="binary_crossentropy", metrics=["AUC"])
        lstm_model.fit(X_train_seq, y_train_seq, validation_data=(X_valid_seq, y_valid_seq), epochs=5, batch_size=128, verbose=1)
        valid_lstm_prob = lstm_model.predict(X_valid_seq).ravel()
        test_lstm_prob = lstm_model.predict(X_test_seq).ravel()
        return {"lstm_model": lstm_model, "valid_lstm_prob": valid_lstm_prob, "test_lstm_prob": test_lstm_prob, "valid_ids": valid_ids, "test_ids": test_ids, "train_attention_mask": train_mask, "valid_attention_mask": valid_mask, "test_attention_mask": test_mask}

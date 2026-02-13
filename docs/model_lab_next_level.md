# Next-Level Model Lab Upgrade (Design)

## Goal
Deliver a single story:

Build → Compare → Stress → Explain → Approve

Output must be a **risk narrative**, not a number.

Golden rule: **Algorithm can be complex. Explanation must be simple.**

---

## Capability 1: Universal Explainability Layer

### Product contract (always the same output shape)
Regardless of model type, return:

- What the score means (legal framing)
- Why this account is risky (observable behaviors)
- Which signals drove the decision (traceable to governed features)

### API contract
Add a universal endpoint (or extend current one) that always returns a narrative payload:

`GET /api/v2/mule/explain/narrative?model_version=...&account_id=...`

Response:

```json
{
  "success": true,
  "mode": "SUPERVISED" ,
  "meaning": "Likelihood of mule involvement",
  "score": 0.82,
  "reasons": [
    {
      "theme": "Velocity",
      "statement": "rapid outward movement",
      "top_features": ["tx_count_24h", "outbound_amount_24h"],
      "evidence": [
        { "feature": "tx_count_24h", "value": 92, "baseline": 6, "direction": "HIGHER_RISK" }
      ]
    }
  ],
  "method": "shap|coefficients|distance|reconstruction|density",
  "trace": {
    "model_version": "…",
    "feature_set": ["…"],
    "feature_registry_version": "…"
  }
}
```

### How explanation is computed per algorithm family

#### Supervised (trees / boosting)
- Local: SHAP if available; fallback to importance proxy.
- Narrative: group top contributions into themes using governed metadata (typology, family, owner, origin).

#### Linear (logistic)
- Local: standardized coefficients × standardized feature values for a signed contribution.
- Narrative: same grouping + natural language rules (positive coefficient + high value ⇒ “increases risk”).

#### Clustering (KMeans)
- Compute distance to nearest “normal” centroid.
- Explain by per-feature deviation vs centroid:
  - baseline = centroid value
  - delta = account value − centroid value
- Narrative: top absolute deltas, grouped into themes.

#### Density (DBSCAN)
- Explain: “not belonging to dense population” + nearest core points distance.
- Narrative: top dimensions where account differs from nearest core neighborhood.

#### Autoencoder
- Explain: reconstruction error per feature.
- Narrative: features with highest reconstruction error, grouped into themes.

### Translator layer (critical)
Separate “math explanation” from “human narrative”:

1) contribution engine → structured contributions  
2) translator → themes + statements + evidence  
3) dossier UI → shows the narrative first, then the math drill-down

Themes are derived from:
- feature registry family/category
- typology tag
- curated name-pattern mapping (velocity/device/network/circularity/cash/kyc)

---

## Capability 2: Synthetic OOT / Future Simulation Engine

### Purpose
Answer: “Will this model survive tomorrow?”

### API contract
`POST /api/v2/mule/stress/simulate`

Request:
```json
{
  "model_version": "…",
  "scenario": {
    "name": "Velocity Amplification + Drift",
    "methods": [
      { "type": "scale_features", "family": "velocity", "multiplier": 1.3 },
      { "type": "add_noise", "sigma": 0.2 },
      { "type": "shift_mean", "feature": "pass_through_ratio", "delta": 0.4 }
    ]
  }
}
```

Response:
```json
{
  "success": true,
  "baseline": { "auc": 0.78, "recall": 0.41, "alerts": 1200 },
  "simulated": { "auc": 0.66, "recall": 0.29, "alerts": 1800 },
  "verdict": "SURVIVES|DEGRADES|COLLAPSES",
  "drivers_of_break": ["velocity drift", "device signals unstable"]
}
```

### MVP scenarios (solo builder friendly)
- shuffle volumes (row-level feature scaling)
- introduce drift (mean/variance shift)
- amplify velocity (family-based multiplier)
- simulate mule adaptation (reduce separation in top features)

### UI (decision-first)
Scenario board:
- Table: metric | test | simulated future | delta | verdict color
- Red if collapse.

---

## Capability 3: Proper Unsupervised Framework

### Core blocks
**A) Population map**
- 2D embedding (PCA/UMAP later) + cluster/density indicator.

**B) Why outlier**
- Feature deviation / reconstruction error table.
- Narrative summary: “Behavioral abnormality requiring review.”

**C) Stability of outlierness**
- Repeat scoring across time windows (monthly cohorts) and show variance of rank.

**D) Overlap with historical STR (future)**
- Enrichment table: abnormality percentile vs STR rate.

---

## Output language (legal framing)
- Supervised: “Likelihood of mule involvement”
- Unsupervised: “Behavioral abnormality requiring review”

---

## Model Personality Card (registry metadata)
Persist with the model:
- trained on window, dataset version
- features used count
- explainability method available
- stress survival verdict
- champion/challenger comparison status

---

## Implementation priority (solo builder)
1) Universal narrative translation (frontend + API payload shape)
2) Business threshold impact (already added)
3) Simple stress simulation MVP (scale + drift)
4) Unsupervised population map MVP (PCA + outlier reason table)
5) Advanced later (UMAP, autoencoder, DBSCAN stability)


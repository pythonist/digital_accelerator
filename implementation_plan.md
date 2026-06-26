# De-Box the MLOps Workbench UI & Fix Chart Rendering

## Problem

The current UI suffers from "boxes inside boxes" syndrome — every section, stat, insight, and panel is wrapped in a `Paper`/`Card` with explicit `border: 1px solid`. This creates a nested-rectangle appearance that looks AI-generated rather than professionally designed.

**Current counts:**
| Component | `<Paper>` | `<Card>` | Border mentions |
|-----------|-----------|----------|-----------------|
| EDA | 4 | 67 | 51 |
| Governance | 46 | 0 | 80 |
| Preprocessing | 1 | 24 | 93 |

Additionally, Recharts charts appear invisible until hovered — a known `ResponsiveContainer` width-calculation issue when charts render inside CSS Grid cells.

## Design Philosophy (Atlassian / SAS Viya style)

Real enterprise tools use:
- **Whitespace** as the primary separator — not borders
- **Typography hierarchy** to define sections — not boxes
- **Flat backgrounds** with subtle tinting — `#f7f8fa` vs `#fff` — instead of explicit `border: 1px solid`
- **Borders only on interactive elements** (inputs, buttons, selected items)
- **Section headers** with a tiny bottom rule or just weight/size difference
- **No nested containers** — content sits directly on the page surface

## Proposed Changes

### Phase 1: Fix Chart Rendering (Quick Win)

#### [MODIFY] [EDAScreen.jsx](file:///e:/Trae/AI_AML_tool/frontend/src/tools/mlops/components/EDAScreen.jsx)

The Recharts `ResponsiveContainer` bug: it calculates `width: 0` when placed inside a CSS Grid cell that hasn't painted yet. Fix:
- Wrap every `<ResponsiveContainer>` parent `<Box>` with `minWidth: 0` (CSS Grid fix)
- Add `minHeight` to chart containers to prevent height collapse
- Force a redraw trigger using a `key` that changes after initial mount

---

### Phase 2: De-Box the EDA Screen

#### [MODIFY] [EDAScreen.jsx](file:///e:/Trae/AI_AML_tool/frontend/src/tools/mlops/components/EDAScreen.jsx)

**Card component** — remove the border entirely, use subtle background only:
```diff
- p:{ xs:1.5, md:1.75 }, borderRadius:1.25, bgcolor: D.cardBg,
- borderColor: highlight ? '#f3c6af' : isDanger ? '#fca5a5' : D.border,
- boxShadow:'none',
+ p: { xs: 1.5, md: 2 }, borderRadius: 2, bgcolor: '#ffffff',
+ border: 'none',
+ boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
```

**StatCell component** — remove borders, use only background tinting:
```diff
- p:1.5, borderRadius:1.5,
- border:`1px solid ${...}`,
+ p: 1.25, borderRadius: 1.5,
+ border: 'none',
```

**InsightPanel** — remove left-border decoration, use cleaner separator:
```diff
- borderLeft:`2px solid ${c.border}`, pl:1
+ pl: 0
```

**Grid gaps** — reduce from `gap: 1.75` to `gap: 1.25` (tighter, more professional)

**Section labels** — keep but remove the Card wrapper around them

---

### Phase 3: De-Box the Feature Governance Screen

#### [MODIFY] [FeatureGovernanceWorkbench.jsx](file:///e:/Trae/AI_AML_tool/frontend/src/tools/mlops/components/FeatureGovernanceWorkbench.jsx)

**SectionCard** — Remove explicit border, use only a subtle shadow:
```diff
- border: `1px solid ${T.border}`,
+ border: 'none',
+ boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
```
Remove the inner `borderBottom` on the header — replace with typographic hierarchy only.

**Feature list items** — Replace bordered boxes with clean rows using bottom-divider only:
- Remove `Paper elevation={0}` wrappers on individual feature rows
- Use `borderBottom: '1px solid #f1f5f9'` on the last child only
- Remove all inner borders from status chips

**Bucket cards** — Remove explicit borders, use background-only tinting for categories.

---

### Phase 4: De-Box the PreprocessingWorkbench

#### [MODIFY] [PreprocessingWorkbench.jsx](file:///e:/Trae/AI_AML_tool/frontend/src/tools/mlops/components/PreprocessingWorkbench.jsx)

Apply the same philosophy to the Card/Paper components used in the Builder, Fix Issues, and Run tabs.

---

## Open Questions

> [!IMPORTANT]
> The EDA screen has **67 Card usages** and the Governance screen has **46 Paper usages**. A full de-boxing would touch hundreds of lines across 3 files totaling ~14,000 lines. Should I:
> 1. Do EDA + Feature Review first (as you specifically requested), then Preprocessing if needed?
> 2. Apply a global CSS override that strips borders from all `MuiPaper-outlined` variants inside the workbench?

> [!NOTE]
> Option 2 (global CSS override) would be faster and more consistent but less granular. I'd add it to the workbench root `<Box>` so it only affects the MLOps screens, not the rest of the app.

## Verification Plan

### Manual Verification
- Visual check of EDA dashboard — charts render immediately without hover
- Feature Review screen — no nested borders, clean row-based layout
- Overall impression — closer to Atlassian/SAS Viya flat style

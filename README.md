# Smart Reconciliation Visualizer (UI-First)

## What this is
A UI-forward reconciliation tool:
- Upload **two CSVs**
- Auto-detect `transaction_id`, amount, date
- Choose matching strategy: **Auto** (ID-based) or **Custom** (rule-based)
- Visual dashboard with KPIs, donut chart, filters, search
- Click a row to open a **side-by-side mismatch drawer**
- Export results as CSV

## Local Run (2 terminals)

### 1) Backend
```bash
cd backend
npm install
npm run dev
```

### 2) Frontend
```bash
cd frontend
npm install
npm run dev
```

Open: http://localhost:5173

## Sample CSV format
Recommended headers:
- `transaction_id`
- `date`
- `amount`
- `description` (optional)

## Notes
- This version keeps the “custom mapping screen” minimal (uses detected columns).
  You can extend it to a full drag/drop mapping page easily (happy to do it next).

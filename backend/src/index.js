import express from "express";
import cors from "cors";
import multer from "multer";
import Papa from "papaparse";
import { nanoid } from "nanoid";
import { z } from "zod";

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// In-memory sessions
const sessions = new Map();

/** ---------- Helpers ---------- **/
function normalizeHeader(h) {
  return String(h ?? "").trim();
}
function toNumber(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === "") return null;
  // remove commas in numbers like 1,234.56
  const cleaned = s.replace(/,/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
function normalizeDate(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  // Accept common forms: YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY (ambiguous), ISO
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10); // YYYY-MM-DD
  return null;
}
function stringify(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function parseCsvBuffer(buffer) {
  const text = buffer.toString("utf-8");
  const result = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false
  });
  if (result.errors?.length) {
    const msg = result.errors[0]?.message || "CSV parse error";
    throw new Error(msg);
  }
  const fields = (result.meta?.fields || []).map(normalizeHeader).filter(Boolean);
  const rows = (result.data || []).map((r, idx) => ({ __rowId: idx + 1, ...r }));
  return { fields, rows };
}

function profile(rows, fields) {
  const rowCount = rows.length;
  const sampleRows = rows.slice(0, 5);
  const lowerFields = fields.map(f => f.toLowerCase());

  // Heuristic: detect transaction id column
  const idCandidates = ["transaction_id", "transactionid", "txn_id", "txnid", "id", "reference", "ref", "trans_id"];
  let detectedId = null;
  for (const cand of idCandidates) {
    const i = lowerFields.indexOf(cand);
    if (i >= 0) { detectedId = fields[i]; break; }
  }

  // Detect likely amount/date columns
  const amountCandidates = ["amount", "amt", "total", "total_amount", "value"];
  const dateCandidates = ["date", "txn_date", "transaction_date", "posted_date", "booking_date"];
  let detectedAmount = null, detectedDate = null;
  for (const cand of amountCandidates) {
    const i = lowerFields.indexOf(cand);
    if (i >= 0) { detectedAmount = fields[i]; break; }
  }
  for (const cand of dateCandidates) {
    const i = lowerFields.indexOf(cand);
    if (i >= 0) { detectedDate = fields[i]; break; }
  }

  // Duplicates (only if id detected)
  let duplicates = 0;
  if (detectedId) {
    const seen = new Set();
    for (const r of rows) {
      const id = stringify(r[detectedId]);
      if (!id) continue;
      if (seen.has(id)) duplicates++;
      else seen.add(id);
    }
  }

  // Total amount sum (best effort)
  let amountSum = null;
  if (detectedAmount) {
    let sum = 0, count = 0;
    for (const r of rows) {
      const n = toNumber(r[detectedAmount]);
      if (n !== null) { sum += n; count++; }
    }
    amountSum = count ? sum : null;
  }

  // Date range
  let dateMin = null, dateMax = null;
  if (detectedDate) {
    const dates = rows.map(r => normalizeDate(r[detectedDate])).filter(Boolean).sort();
    if (dates.length) { dateMin = dates[0]; dateMax = dates[dates.length - 1]; }
  }

  return {
    rowCount,
    fields,
    detected: { id: detectedId, amount: detectedAmount, date: detectedDate },
    duplicates,
    amountSum,
    dateRange: (dateMin && dateMax) ? { min: dateMin, max: dateMax } : null,
    sampleRows
  };
}

function pickField(mapping, key, fallback) {
  // mapping example: { id: {a:"transaction_id", b:"txn_id"}, amount:{...}, date:{...}, description:{...}}
  const m = mapping?.[key];
  if (m && typeof m === "object") return { a: m.a || fallback?.a || null, b: m.b || fallback?.b || null };
  return { a: fallback?.a || null, b: fallback?.b || null };
}

function buildKey(record, fields, rules) {
  // fields: array of field names used to build composite key
  const parts = [];
  for (const f of fields) {
    const v = record[f];
    if (rules?.fieldTypes?.[f] === "number") parts.push(String(toNumber(v) ?? ""));
    else if (rules?.fieldTypes?.[f] === "date") parts.push(String(normalizeDate(v) ?? ""));
    else parts.push(stringify(v).toLowerCase());
  }
  return parts.join("||");
}

function reconcile({ aRows, bRows, mapping, mode, rules }) {
  // rules: { amountTolerance:number, dateToleranceDays:number, compositeKeysA:[...], compositeKeysB:[...]}
  const amountTol = Number(rules?.amountTolerance ?? 0);
  const dateTolDays = Number(rules?.dateToleranceDays ?? 0);

  const fallback = {
    id: { a: "transaction_id", b: "transaction_id" },
    amount: { a: "amount", b: "amount" },
    date: { a: "date", b: "date" },
    description: { a: "description", b: "description" },
  };

  const idField = pickField(mapping, "id", fallback.id);
  const amountField = pickField(mapping, "amount", fallback.amount);
  const dateField = pickField(mapping, "date", fallback.date);
  const descField = pickField(mapping, "description", fallback.description);

  const results = [];

  const bUsed = new Set();

  const statusCounts = { MATCHED: 0, MISMATCH: 0, MISSING_IN_B: 0, MISSING_IN_A: 0 };

  const compareAmounts = (a, b) => {
    const an = toNumber(a), bn = toNumber(b);
    if (an === null || bn === null) return { ok: false, reason: "AMOUNT_MISSING" };
    const diff = Math.abs(an - bn);
    return { ok: diff <= amountTol, diff, an, bn };
  };

  const compareDates = (a, b) => {
    const ad = normalizeDate(a), bd = normalizeDate(b);
    if (!ad || !bd) return { ok: false, reason: "DATE_MISSING" };
    // compare with tolerance in days
    const adt = new Date(ad + "T00:00:00Z").getTime();
    const bdt = new Date(bd + "T00:00:00Z").getTime();
    const day = 24 * 60 * 60 * 1000;
    const dd = Math.abs(adt - bdt) / day;
    return { ok: dd <= dateTolDays, diffDays: dd, ad, bd };
  };

  // Build lookup for B based on chosen mode
  let bIndex = new Map();

  if (mode === "auto") {
    // Prefer transaction_id if both sides have it
    const bId = idField.b;
    for (const r of bRows) {
      const id = bId ? stringify(r[bId]) : "";
      if (!id) continue;
      // keep first; duplicates handled as mismatches later
      if (!bIndex.has(id)) bIndex.set(id, r);
    }
  } else {
    // custom composite keys
    const keysB = rules?.compositeKeysB || [];
    for (const r of bRows) {
      const key = buildKey(r, keysB, rules);
      if (!bIndex.has(key)) bIndex.set(key, r);
    }
  }

  const aKeyField = (mode === "auto") ? idField.a : null;
  const keysA = (mode === "custom") ? (rules?.compositeKeysA || []) : null;

  for (const a of aRows) {
    const key = (mode === "auto")
      ? stringify(a[aKeyField] ?? "")
      : buildKey(a, keysA, rules);

    const b = key ? bIndex.get(key) : null;

    if (!key || !b) {
      statusCounts.MISSING_IN_B++;
      results.push({
        status: "MISSING_IN_B",
        key,
        reason: "MISSING_IN_B",
        a,
        b: null
      });
      continue;
    }

    bUsed.add(b.__rowId);

    // Validate fields
    const amountCmp = compareAmounts(a[amountField.a], b[amountField.b]);
    const dateCmp = compareDates(a[dateField.a], b[dateField.b]);

    const mismatches = [];
    if (!amountCmp.ok) mismatches.push(amountCmp.reason || "AMOUNT_MISMATCH");
    if (!dateCmp.ok) mismatches.push(dateCmp.reason || "DATE_MISMATCH");

    if (mismatches.length === 0) {
      statusCounts.MATCHED++;
      results.push({
        status: "MATCHED",
        key,
        reason: "MATCHED",
        a,
        b
      });
    } else {
      statusCounts.MISMATCH++;
      const reasons = [];

if (a.amount !== b.amount) {
  reasons.push(
    `Amount differs (${a.amount} vs ${b.amount})`
  );
}

if (a.date !== b.date) {
  reasons.push(
    `Date differs (${a.date} vs ${b.date})`
  );
}

results.push({
  status: "mismatch",
  key,
  a,
  b,
  reason: reasons.join(" | "),
});

    }
  }

  // Missing in A: any B not used
  for (const b of bRows) {
    if (!bUsed.has(b.__rowId)) {
      statusCounts.MISSING_IN_A++;
      results.push({
        status: "MISSING_IN_A",
        key: (mode === "auto") ? stringify(b[idField.b] ?? "") : null,
        reason: "MISSING_IN_A",
        a: null,
        b
      });
    }
  }

  // Summary
  const total = results.length;
  return {
    summary: { ...statusCounts, total },
    results
  };
}

function buildMismatchReason(a, b) {
  const reasons = [];

  // Amount
  if (a.amount !== b.amount) {
    const diff = Math.abs(Number(a.amount) - Number(b.amount));
    reasons.push(`Amount differs by ${diff}`);
  }

  // Date
  if (a.date !== b.date) {
    const days =
      Math.abs(
        new Date(a.date).getTime() - new Date(b.date).getTime()
      ) / (1000 * 60 * 60 * 24);

    reasons.push(`Date differs by ${Math.round(days)} days`);
  }

  // Description (optional)
  if (a.description && b.description && a.description !== b.description) {
    reasons.push("Description mismatch");
  }

  return reasons.join(", ");
}


/** ---------- Routes ---------- **/

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/api/sessions", upload.fields([{ name: "fileA", maxCount: 1 }, { name: "fileB", maxCount: 1 }]), (req, res) => {
  try {
    const fileA = req.files?.fileA?.[0];
    const fileB = req.files?.fileB?.[0];
    if (!fileA || !fileB) return res.status(400).json({ error: "Please upload both fileA and fileB." });

    const parsedA = parseCsvBuffer(fileA.buffer);
    const parsedB = parseCsvBuffer(fileB.buffer);

    const sessionId = nanoid(12);
    const meta = {
      a: profile(parsedA.rows, parsedA.fields),
      b: profile(parsedB.rows, parsedB.fields)
    };

    sessions.set(sessionId, {
      createdAt: Date.now(),
      a: parsedA,
      b: parsedB,
      meta
    });

    res.json({ sessionId, meta });
  } catch (e) {
    res.status(400).json({ error: e.message || "Upload failed" });
  }
});

app.post("/api/reconcile", (req, res) => {
  const schema = z.object({
    sessionId: z.string().min(3),
    mode: z.enum(["auto", "custom"]),
    mapping: z.any().optional(),
    rules: z.any().optional()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });

  const { sessionId, mode, mapping, rules } = parsed.data;
  const s = sessions.get(sessionId);
  if (!s) return res.status(404).json({ error: "Session not found. Upload files again." });

  try {
    const recon = reconcile({
      aRows: s.a.rows,
      bRows: s.b.rows,
      mapping,
      mode,
      rules
    });

    // keep last result for export
    s.lastRecon = recon;
    sessions.set(sessionId, s);

    res.json({ meta: s.meta, ...recon });
  } catch (e) {
    res.status(400).json({ error: e.message || "Reconcile failed" });
  }
});

app.get("/api/export/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  const filter = String(req.query.filter || "ALL");
  const s = sessions.get(sessionId);
  if (!s?.lastRecon) return res.status(404).json({ error: "Nothing to export. Run reconciliation first." });

  const rows = s.lastRecon.results.filter(r => filter === "ALL" ? true : r.status === filter);

  // Flatten for CSV
  const flat = rows.map(r => ({
    status: r.status,
    reason: r.reason,
    key: r.key,
    a_rowId: r.a?.__rowId ?? "",
    b_rowId: r.b?.__rowId ?? "",
    a_transaction_id: r.a ? (r.a.transaction_id ?? "") : "",
    b_transaction_id: r.b ? (r.b.transaction_id ?? "") : "",
    a_date: r.a ? (r.a.date ?? "") : "",
    b_date: r.b ? (r.b.date ?? "") : "",
    a_amount: r.a ? (r.a.amount ?? "") : "",
    b_amount: r.b ? (r.b.amount ?? "") : ""
  }));

  const csv = Papa.unparse(flat);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="recon_${sessionId}_${filter}.csv"`);
  res.send(csv);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));

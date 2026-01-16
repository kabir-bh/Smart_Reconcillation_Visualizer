  import React, { useMemo, useState, useEffect, useRef } from "react";
  import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
  import {
    Box, Container, CssBaseline, ThemeProvider, Typography, Stepper, Step, StepLabel,
    Paper, Button, Stack, Chip, Divider, Alert, Snackbar, IconButton, Tooltip, TextField,
    Drawer
  } from "@mui/material";
  import CloseIcon from "@mui/icons-material/Close";
  import UploadFileIcon from "@mui/icons-material/UploadFile";
  import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
  import TuneIcon from "@mui/icons-material/Tune";
  import DownloadIcon from "@mui/icons-material/Download";
  import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
  import { DataGrid } from "@mui/x-data-grid";
  import { PieChart, Pie, ResponsiveContainer, Cell, Tooltip as RTooltip } from "recharts";
  import { motion, AnimatePresence } from "framer-motion";

  import { theme } from "./theme";
  import { createSession, runReconcile, exportUrl } from "./api";
  import { useAppContext } from "./AppContext.jsx";

  // Flow map:
  // 1) Upload CSVs -> createSession() -> receive sessionId + meta.
  // 2) Choose strategy -> build payload (auto/custom rules).
  // 3) runReconcile() -> render KPIs/chart/table + detail drawer.
  // Stepper labels for the 3-stage flow.
  const steps = ["Upload", "Match Strategy", "Reconcile & Review"];

  function Glass({ children, sx, ...props }) {
    return (
      <Paper
        {...props}
        elevation={0}
        sx={{
          pointerEvents: "auto",   // Keep interactivity when nested inside overlays.
          position: "relative",
          cursor: "pointer",
          userSelect: "none",
          p: 2.5,
          borderRadius: 2,
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.04))",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          ...sx,
        }}
      >
        {children}
      </Paper>
    );
  }


  // Upload card for a single CSV (A or B).
  function FileCard({ title, file, onPick, meta }) {
    return (
      <Glass sx={{ height: "100%" }}>
        <Stack spacing={1.2}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="h6">{title}</Typography>
            <Chip size="small" label={file ? "let's Go" : "Upload CSV"} color={file ? "success" : "default"} />
            <Chip size="small" label={file ? "ready" : "Upload CSV"} color={file ? "success" : "default"} />
          </Stack>

          <Button
            variant="contained"
            startIcon={<UploadFileIcon />}
            component="label"
            sx={{ py: 1.2 }}
          >
            {file ? "Replace File" : "Choose CSV"}
            <input type="file" accept=".csv,text/csv" hidden onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPick(f);
            }} />
          </Button>

          {file && (
            <Typography variant="body2" sx={{ color: "rgba(231,238,252,0.72)" }}>
              {file.name} • {(file.size / 1024).toFixed(0)} KB
            </Typography>
          )}

          {meta && (
            <>
              <Divider sx={{ opacity: 0.25 }} />
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip size="small" label={`${meta.rowCount} rows`} />
                {meta.detected?.id && <Chip size="small" label={`ID: ${meta.detected.id}`} />}
                {meta.detected?.amount && meta.amountSum !== null && (
                  <Chip size="small" label={`Σ ${meta.detected.amount}: ${meta.amountSum.toFixed(2)}`} />
                )}
                {meta.detected?.date && meta.dateRange && (
                  <Chip size="small" label={`${meta.dateRange.min} → ${meta.dateRange.max}`} />
                )}
                {meta.duplicates ? <Chip size="small" color="warning" label={`${meta.duplicates} duplicate IDs`} /> : null}
              </Stack>
            </>
          )}
        </Stack>
      </Glass>
    );
  }

  // Clickable card used to pick a matching strategy.
  function StrategyCard({ title, description, selected, onClick, icon }) {
    const [hovered, setHovered] = React.useState(false);
    const isActive = hovered || selected;

    return (
      <Glass
    role="button"
    tabIndex={0}
    onClick={onClick}
    onKeyDown={(e) => e.key === "Enter" && onClick()}
    onMouseEnter={() => setHovered(true)}
    onMouseLeave={() => setHovered(false)}
    sx={{
      height: "100%",
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      cursor: "pointer",
      pointerEvents: "auto", // 🔥 REQUIRED
      border: isActive
        ? "1.5px solid rgba(124,92,255,0.9)"
        : "1px solid rgba(255,255,255,0.15)",
      background: isActive
        ? "linear-gradient(180deg, rgba(124,92,255,0.30), rgba(255,255,255,0.06))"
        : "linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.04))",
      transition: "all 0.25s ease",
    }}
  >

        {/* TOP CONTENT */}
        <Stack spacing={1.2}>
          <Stack direction="row" spacing={1} alignItems="center">
            {icon}
            <Typography variant="h6">{title}</Typography>
            {selected && (
              <Chip size="small" label="Selected" color="primary" />
            )}
          </Stack>

          <Typography variant="body2" color="text.secondary">
            {description}
          </Typography>
        </Stack>

        {/* BOTTOM HINT */}
        <Typography
          variant="caption"
          sx={{ opacity: 0.7, mt: 2 }}
        >
          {selected ? "Selected" : "Click to choose"}
        </Typography>
      </Glass>
    );
  }

  // Normalize backend status values to user-friendly labels.
  function normalizeStatus(status) {
    if (!status) return "";

    switch (status.toUpperCase()) {
      case "MATCHED":
        return "Matched";
      case "MISMATCH":
        return "Mismatch";
      case "MISSING_IN_A":
        return "Missing in A";
      case "MISSING_IN_B":
        return "Missing in B";
      default:
        return status;
    }
  }




  // Visual status badge used in table and drawer.
  function StatusChip({ status }) {
    const label = normalizeStatus(status);

    return (
      <Chip
        label={label}
        size="small"
        sx={{
          fontWeight: 600,

          ...(label === "Matched" && {
            backgroundColor: "rgba(46, 229, 157, 0.15)",
            color: "#2ee59d",
            border: "1px solid rgba(46, 229, 157, 0.45)",
          }),

          ...(label === "Mismatch" && {
            backgroundColor: "rgba(255, 76, 76, 0.12)",
            color: "#ff4c4c",
            border: "1.5px solid rgba(255, 76, 76, 0.85)",
            boxShadow: "0 0 8px rgba(255, 76, 76, 0.35)",
          }),

          ...(label === "Missing in A" && {
            backgroundColor: "rgba(255, 193, 7, 0.15)",
            color: "#ffc107",
            border: "1px solid rgba(255, 193, 7, 0.45)",
          }),

          ...(label === "Missing in B" && {
            backgroundColor: "rgba(255, 193, 7, 0.15)",
            color: "#ffc107",
            border: "1px solid rgba(255, 193, 7, 0.45)",
          }),
        }}
      />
    );
  }



  // Small helper row to compare A/B values in the detail drawer.
  function DiffRow({ label, a, b, highlight }) {
    return (
      <Box sx={{ display: "grid", gridTemplateColumns: "140px 1fr 1fr", gap: 1, alignItems: "center" }}>
        <Typography variant="caption" sx={{ opacity: 0.8 }}>{label}</Typography>
        <Paper elevation={0} sx={{ p: 1, background: highlight ? "rgba(255,92,122,0.16)" : "rgba(255,255,255,0.06)" }}>
          <Typography variant="body2">{a ?? "—"}</Typography>
        </Paper>
        <Paper elevation={0} sx={{ p: 1, background: highlight ? "rgba(255,92,122,0.16)" : "rgba(255,255,255,0.06)" }}>
          <Typography variant="body2">{b ?? "—"}</Typography>
        </Paper>
      </Box>
    );
  }

  // Mock auth screen for login/signup (no backend).
  function AuthCard({ mode, onModeChange, onSubmit, onAbout }) {
    const isSignup = mode === "signup";

    return (
      <Box
        sx={{
          minHeight: { xs: 520, md: 620 },
          display: "grid",
          placeItems: "center",
        }}
      >
        <Box sx={{ display: "grid", gap: 2, placeItems: "center", width: "100%" }}>
          <Glass sx={{ p: 3, maxWidth: 520, width: "100%" }}>
            <Stack spacing={2} alignItems="center">
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              {isSignup ? "Create your account" : "Welcome back"}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {isSignup
                ? "Mock signup. No data is saved yet."
                : "Mock login. Use any email/password to continue."}
            </Typography>

            {isSignup && (
              <TextField label="Full name" fullWidth />
            )}
            <TextField label="Email" type="email" fullWidth />
            <TextField label="Password" type="password" fullWidth />
            {isSignup && (
              <TextField label="Confirm password" type="password" fullWidth />
            )}

            <Button variant="contained" size="large" onClick={onSubmit}>
              {isSignup ? "Create account" : "Log in"}
            </Button>

            <Divider sx={{ opacity: 0.3 }} />
            <Typography variant="body2" color="text.secondary">
              {isSignup ? "Already have an account?" : "New here?"}{" "}
              <Button variant="text" onClick={() => onModeChange(isSignup ? "login" : "signup")}>
                {isSignup ? "Log in" : "Create account"}
              </Button>
            </Typography>
            </Stack>
          </Glass>
          <Button
            variant="text"
            onClick={onAbout}
            endIcon={<KeyboardArrowDownIcon />}
            sx={{ opacity: 0.8 }}
          >
            About
          </Button>
        </Box>
      </Box>
    );
  }

  function ProtectedRoute({ isAuthed }) {
    return isAuthed ? <Outlet /> : <Navigate to="/auth" replace />;
  }

  export default function App() {
    const navigate = useNavigate();
    const location = useLocation();
    const [isAtBottom, setIsAtBottom] = useState(false);
    const aboutRef = useRef(null);


    const [fileA, setFileA] = useState(null);
    const [fileB, setFileB] = useState(null);

    const {
      sessionId,
      setSessionId,
      meta,
      setMeta,
      recon,
      setRecon,
      strategy,
      setStrategy,
      rules,
      setRules,
    } = useAppContext();

    const [loading, setLoading] = useState(false);
    const [toast, setToast] = useState({ open: false, msg: "", severity: "info" });

    const [filter, setFilter] = useState("ALL");
    const [search, setSearch] = useState("");

    const [drawer, setDrawer] = useState({ open: false, row: null });
    const [authMode, setAuthMode] = useState("login");
    const [isAuthed, setIsAuthed] = useState(false);

    const canUpload = !!fileA && !!fileB;
    const activeStep = useMemo(() => {
      switch (location.pathname) {
        case "/upload":
          return 0;
        case "/strategy":
          return 1;
        case "/review":
          return 2;
        default:
          return 0;
      }
    }, [location.pathname]);

    // Track scroll position for sticky footer behavior (if needed later).
    useEffect(() => {
      const handleScroll = () => {
        const scrollTop = window.scrollY;
        const windowHeight = window.innerHeight;
        const docHeight = document.documentElement.scrollHeight;
    
        setIsAtBottom(scrollTop + windowHeight >= docHeight - 50);
      };
    
      window.addEventListener("scroll", handleScroll);
      handleScroll();
    
      return () => window.removeEventListener("scroll", handleScroll);
    }, []);
    

    // Decide whether auto matching by ID is likely reliable.
    const detectedHasId = useMemo(() => {
      const aId = meta?.a?.detected?.id;
      const bId = meta?.b?.detected?.id;
      return !!(aId && bId);
    }, [meta]);

    // Upload files to backend and create a reconciliation session.
    async function handleCreateSession() {
      try {
        setLoading(true);
        const data = await createSession(fileA, fileB);
        setSessionId(data.sessionId);
        setMeta(data.meta);
        setToast({ open: true, msg: "Files ingested. Data profile generated.", severity: "success" });
        navigate("/strategy");
      } catch (e) {
        setToast({ open: true, msg: e?.response?.data?.error || e.message, severity: "error" });
      } finally {
        setLoading(false);
      }
    }

    // Clear all UI state to start a new reconciliation.
    const resetAll = () => {
      navigate("/upload");
    
      setFileA(null);
      setFileB(null);
    
      setSessionId(null);
      setMeta(null);
      setRecon(null);
    
      setStrategy("auto");
      setRules({
        amountTolerance: "",
        dateToleranceDays: "",
      });
    
      setFilter("ALL");
      setSearch("");
    
      setDrawer({ open: false, row: null });
    };
    

    // Build payload and trigger reconciliation on the backend.
    async function handleReconcile() {
      console.log("RUN RECON CLICKED");
    
      try {
        setLoading(true);
    
        const payload = {
          sessionId,
          mode: strategy,
          mapping: {
            id: {
              a: meta?.a?.detected?.id || "transaction_id",
              b: meta?.b?.detected?.id || "transaction_id"
            },
            amount: {
              a: meta?.a?.detected?.amount || "amount",
              b: meta?.b?.detected?.amount || "amount"
            },
            date: {
              a: meta?.a?.detected?.date || "date",
              b: meta?.b?.detected?.date || "date"
            },
            description: { a: "description", b: "description" }
          }
        };
    
        // Only send rules in custom mode; auto mode ignores them.
        if (strategy === "custom") {
          payload.rules = {
            amountTolerance: Number(rules.amountTolerance || 0),
            dateToleranceDays: Number(rules.dateToleranceDays || 0),
            compositeKeysA: [
              meta?.a?.detected?.amount || "amount",
              meta?.a?.detected?.date || "date"
            ],
            compositeKeysB: [
              meta?.b?.detected?.amount || "amount",
              meta?.b?.detected?.date || "date"
            ],
            fieldTypes: {
              [meta?.a?.detected?.amount || "amount"]: "number",
              [meta?.a?.detected?.date || "date"]: "date",
              [meta?.b?.detected?.amount || "amount"]: "number",
              [meta?.b?.detected?.date || "date"]: "date",
              description: "string"
            }
          };
        }
    
        console.log("PAYLOAD SENT:", payload);
    
        const data = await runReconcile(payload);
    
        console.log("RESPONSE RECEIVED:", data);
    
        setRecon(data);
        navigate("/review");
        setToast({ open: true, msg: "Reconciliation complete.", severity: "success" });
      } catch (e) {
        console.error("RECON ERROR:", e?.response?.data || e);
        setToast({ open: true, msg: e?.response?.data?.error || e.message, severity: "error" });
      } finally {
        setLoading(false);
      }
    }
    

    // Data used by the summary pie chart.
    const pieData = useMemo(() => {
      if (!recon?.summary) return [];
      return [
        { name: "Matched", value: recon.summary.MATCHED, key: "MATCHED" },
        { name: "Mismatch", value: recon.summary.MISMATCH, key: "MISMATCH" },
        { name: "Missing in A", value: recon.summary.MISSING_IN_A, key: "MISSING_IN_A" },
        { name: "Missing in B", value: recon.summary.MISSING_IN_B, key: "MISSING_IN_B" }
      ].filter(d => d.value > 0);
    }, [recon]);

    console.log("RECON RAW DATA:", recon);

    // Normalized rows for basic table use.
    const rows = useMemo(() => {
      if (!recon?.results) return [];
    
      return recon.results.map((r, idx) => ({
        id: idx + 1,
        status: r.status?.toUpperCase(), // 🔥 NORMALIZED HERE
        reason: r.reason,
        key: r.key,
        aRow: r.a?._rowId ?? "",
        bRow: r.b?._rowId ?? "",
      }));
    }, [recon]);
    


    // Apply status filter + search against A/B content and reasons.
    const filteredRows = useMemo(() => {
    if (!recon || !Array.isArray(recon.results)) return [];

    let rows = recon.results;

    // Normalize status to UPPER_SNAKE_CASE
    rows = rows.map(r => ({
      ...r,
      _normalizedStatus: r.status
        ?.toUpperCase()
        .replace(/\s+/g, "_"),
    }));

    if (filter !== "ALL") {
      rows = rows.filter(r => r._normalizedStatus === filter);
    }

    if (search.trim() !== "") {
      const q = search.toLowerCase();
      rows = rows.filter(r =>
        r.key?.toLowerCase().includes(q) ||
        r.reason?.toLowerCase().includes(q) ||
        JSON.stringify(r.a || {}).toLowerCase().includes(q) ||
        JSON.stringify(r.b || {}).toLowerCase().includes(q)
      );
    }

    return rows;
  }, [recon, filter, search]);

    
    

  // DataGrid expects a stable id; derive one from key or index.
  const gridRows = filteredRows.map((r, index) => ({
    id: r.key || index,
    status: r.status,
    reason: r.reason,
    key: r.key,
    aRow: r.a ? r.a.transaction_id : "-",
    bRow: r.b ? r.b.transaction_id : "-",
    a: r.a,   // ✅ ADD THIS
    b: r.b    // ✅ ADD THIS
  }));
  
    
    
    

    // Table column definitions for the reconciliation grid.
    const columns = useMemo(() => [
      {
        field: "status",
        headerName: "Status",
        width: 150,
        renderCell: (params) => <StatusChip status={params.value} />,
      },
      {
        field: "reason",
        headerName: "Reason",
        flex: 1,
        minWidth: 260,
      },
      {
        field: "key",
        headerName: "Key",
        width: 160,
      },
      {
        field: "aRow",
        headerName: "A Row",
        width: 110,
      },
      {
        field: "bRow",
        headerName: "B Row",
        width: 110,
      },
    ], []);
    

    // Small KPI card factory for the summary row.
    const kpi = (label, value, color) => (
      <Glass sx={{ p: 2.2 }}>
        <Typography variant="caption" sx={{ opacity: 0.75 }}>{label}</Typography>
        <Typography variant="h4" sx={{ fontWeight: 800, color }}>{value}</Typography>
      </Glass>
    );

    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Box sx={{
          minHeight: "100vh",
          background: "radial-gradient(1200px 700px at 12% 10%, rgba(124,92,255,0.35), transparent 55%), radial-gradient(900px 600px at 88% 25%, rgba(46,229,157,0.25), transparent 60%), #0b1220",
          py: 4
        }}>
          <Container maxWidth="lg">
            <Stack spacing={2.4}>
              <Stack spacing={0.5}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="h3" sx={{ letterSpacing: -0.6 }}>
                    Smart Reconciliation Visualizer
                  </Typography>
                  {isAuthed && (
                    <Button
                      variant="outlined"
                      onClick={() => {
                        setIsAuthed(false);
                        navigate("/auth");
                      }}
                    >
                      Log out
                    </Button>
                  )}
                </Stack>
                <Typography variant="body1" sx={{ opacity: 0.8 }}>
                  Turn messy ledgers into clear answers in minutes.
                </Typography>
                
              </Stack>

              {isAuthed && (
              <Glass>
                <Stepper activeStep={activeStep} alternativeLabel>
                  {steps.map((label) => (
                    <Step key={label}>
                      <StepLabel>{label}</StepLabel>
                    </Step>
                  ))}
                </Stepper>
              </Glass>
              )}

              <Routes>
                <Route
                  path="/"
                  element={<Navigate to={isAuthed ? "/upload" : "/auth"} replace />}
                />
                <Route
                  path="/auth"
                  element={
                    isAuthed ? (
                      <Navigate to="/upload" replace />
                    ) : (
                      <>
                        <AuthCard
                          mode={authMode}
                          onModeChange={setAuthMode}
                          onSubmit={() => {
                            setIsAuthed(true);
                            setToast({ open: true, msg: "Mock auth success.", severity: "success" });
                            navigate("/upload");
                          }}
                          onAbout={() => aboutRef.current?.scrollIntoView({ behavior: "smooth" })}
                        />
                        <Box
                          ref={aboutRef}
                          sx={{
                            mt: 4,
                            minHeight: "100vh",
                            backgroundImage: "url(/assets/recon-preview.png)",
                            backgroundSize: "cover",
                            backgroundPosition: "center",
                            backgroundRepeat: "no-repeat",
                            backgroundColor: "transparent",
                          }}
                        />
                      </>
                    )
                  }
                />
                <Route element={<ProtectedRoute isAuthed={isAuthed} />}>
                  <Route
                    path="/upload"
                    element={
                      <AnimatePresence mode="wait">
                        <motion.div
                          key="upload"
                          initial={{ opacity: 0, y: 12 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -12 }}
                          transition={{ duration: 0.25 }}
                        >
                          <Stack spacing={2}>
                            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 2 }}>
                              <FileCard title="Dataset A" file={fileA} onPick={setFileA} meta={meta?.a} />
                              <FileCard title="Dataset B" file={fileB} onPick={setFileB} meta={meta?.b} />
                            </Box>

                            <Stack direction={{ xs: "column", sm: "row" }} spacing={1} justifyContent="space-between" alignItems={{ xs: "stretch", sm: "center" }}>
                              <Alert severity="info" sx={{ background: "rgba(124,92,255,0.10)", border: "1px solid rgba(124,92,255,0.25)" }}>
                                Pro tip: Use <b>transaction_id</b> for best matching. If not available, we support rule-based matching.
                              </Alert>
                              <Button
                                variant="contained"
                                size="large"
                                disabled={!canUpload || loading}
                                onClick={handleCreateSession}
                              >
                                {loading ? "Processing..." : "Continue"}
                              </Button>
                            </Stack>
                          </Stack>
                        </motion.div>
                      </AnimatePresence>
                    }
                  />
                  <Route
                    path="/strategy"
                    element={
                      !sessionId ? (
                        <Navigate to="/upload" replace />
                      ) : (
                        <AnimatePresence mode="wait">
                          <motion.div
                            key="strategy"
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -12 }}
                            transition={{ duration: 0.25 }}
                          >
                            <Stack spacing={2}>
                              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 2, alignItems: "stretch" }}>
                                <StrategyCard
                                  title="Auto Match"
                                  icon={<AutoAwesomeIcon />}
                                  selected={strategy === "auto"}
                                  onClick={() => setStrategy("auto")}
                                  description={detectedHasId
                                    ? "We detected an ID column in both files. We'll match by ID and validate amount/date."
                                    : "We'll try best-effort matching. Works best if both files have a transaction ID column."}
                                />
                                <StrategyCard
                                  title="Customize Rules"
                                  icon={<TuneIcon />}
                                  selected={strategy === "custom"}
                                  onClick={() => setStrategy("custom")}
                                  description="Match using rules (e.g., Amount + Date) with optional tolerances. Great for messy real-world data."
                                />
                              </Box>
                              <AnimatePresence>
                              {strategy === "custom" && (
                    <AnimatePresence>
                      <motion.div
                        initial={{ opacity: 0, y: -12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -12 }}
                        transition={{ duration: 0.3, ease: "easeOut" }}
                      >
                        <Glass
                          sx={{
                            mt: 3,
                            p: 3,
                            border: "1.5px solid rgba(124,92,255,0.6)",
                            background:
                              "linear-gradient(180deg, rgba(124,92,255,0.18), rgba(255,255,255,0.05))",
                          }}
                        >
                          <Typography variant="h6" sx={{ mb: 2 }}>
                            Tolerance Settings
                          </Typography>

                          <Stack spacing={2}>
                          <TextField
                    label="Amount tolerance (±)"
                    type="number"
                    fullWidth
                    value={rules.amountTolerance}
                    onChange={(e) =>
                      setRules((prev) => ({
                        ...prev,
                        amountTolerance: e.target.value,
                      }))
                    }
                    inputProps={{ min: 0 }}
                  />

                  <TextField
                    label="Date tolerance (days ±)"
                    type="number"
                    fullWidth
                    value={rules.dateToleranceDays}
                    onChange={(e) =>
                      setRules((prev) => ({
                        ...prev,
                        dateToleranceDays: e.target.value,
                      }))
                    }
                    inputProps={{ min: 0 }}
                  />

                          </Stack>
                        </Glass>
                      </motion.div>
                    </AnimatePresence>
                  )}

                  </AnimatePresence>


                              <Stack direction={{ xs: "column", sm: "row" }} spacing={1} justifyContent="space-between" alignItems={{ xs: "stretch", sm: "center" }}>
                                <Button variant="outlined" onClick={() => navigate("/upload")}>Back</Button>
                                <Button variant="contained" size="large" onClick={handleReconcile} disabled={loading}>
                                  {loading ? "Reconciling..." : "Run Reconciliation"}
                                </Button>
                              </Stack>
                            </Stack>
                          </motion.div>
                        </AnimatePresence>
                      )
                    }
                  />
                  <Route
                    path="/review"
                    element={
                      !recon?.results ? (
                        <Navigate to="/upload" replace />
                      ) : (
                        <AnimatePresence mode="wait">
                          <motion.div
                            key="review"
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -12 }}
                            transition={{ duration: 0.25 }}
                          >
                            <Stack spacing={2}>
                              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1.2fr 0.8fr" }, gap: 2 }}>
                                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, 1fr)" }, gap: 2 }}>
                                  {kpi("Matched", recon.summary.MATCHED, theme.palette.success.main)}
                                  {kpi("Mismatched", recon.summary.MISMATCH, theme.palette.error.main)}
                                  {kpi("Missing in A", recon.summary.MISSING_IN_A, theme.palette.warning.main)}
                                  {kpi("Missing in B", recon.summary.MISSING_IN_B, theme.palette.warning.main)}
                                </Box>

                                <Glass sx={{ p: 1.2, height: 200 }}>
                                  <Typography variant="h6" sx={{ px: 1, pt: 1 }}>Overview</Typography>
                                  <Box sx={{ height: 150 }}>
                                    <ResponsiveContainer width="100%" height="100%">
                                      <PieChart>
                                        <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={42} outerRadius={62} paddingAngle={3}>
                                          {pieData.map((entry) => (
                                            <Cell key={entry.key} fill={
                                              entry.key === "MATCHED" ? theme.palette.success.main :
                                              entry.key === "MISMATCH" ? theme.palette.error.main :
                                              theme.palette.warning.main
                                            } />
                                          ))}
                                        </Pie>
                                        <RTooltip />
                                      </PieChart>
                                    </ResponsiveContainer>
                                  </Box>
                                </Glass>
                              </Box>

                              <Glass>
                                <Stack direction={{ xs: "column", md: "row" }} spacing={1.2} alignItems={{ xs: "stretch", md: "center" }} justifyContent="space-between">
                                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                                    {["ALL","MATCHED","MISMATCH","MISSING_IN_A","MISSING_IN_B"].map(f => (
                                      <Chip
                                        key={f}
                                        label={f === "ALL" ? "All" :
                                          f === "MISSING_IN_A" ? "Missing in A" :
                                          f === "MISSING_IN_B" ? "Missing in B" :
                                          f === "MISMATCH" ? "Mismatch" : "Matched"}
                                        color={filter === f ? "primary" : "default"}
                                        onClick={() => setFilter(f)}
                                        variant={filter === f ? "filled" : "outlined"}
                                      />
                                    ))}
                                  </Stack>

                                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems="center">
                                    <TextField
                                      value={search}
                                      onChange={(e) => setSearch(e.target.value)}
                                      placeholder="Search key / reason / fields…"
                                      size="small"
                                      fullWidth
                                    />
                                    <Tooltip title="Export current filter">
                                      <Button
                                        variant="contained"
                                        startIcon={<DownloadIcon />}
                                        component="a"
                                        href={exportUrl(sessionId, filter === "ALL" ? "ALL" : filter)}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        Export
                                      </Button>
                                    </Tooltip>
                                  </Stack>
                                </Stack>
                              </Glass>

                              <Glass sx={{ p: 0 }}>
                                <Box sx={{ height: 520 }}>
                              
                                  <DataGrid
                                    rows={gridRows}              // ✅ USE GRID ROWS
                                    columns={columns}
                                    getRowId={(row) => row.id}   // ✅ id already exists
                                    disableRowSelectionOnClick
                                    onRowClick={(p) => setDrawer({ open: true, row: p.row })}
                                    sx={{
                                      border: 0,
                                      "& .MuiDataGrid-columnHeaders": { background: "rgba(255,255,255,0.06)" },
                                      "& .MuiDataGrid-row:hover": { background: "rgba(124,92,255,0.08)" }
                                    }}
                                  />
                                </Box>
                              </Glass>
                            </Stack>

                            <Drawer
                              anchor="right"
                              open={drawer.open}
                              onClose={() => setDrawer({ open: false, row: null })}
                              PaperProps={{ sx: { width: { xs: "100%", md: 520 }, background: "#0b1220" } }}
                            >
                              <Box sx={{ p: 2 }}>
                                <Stack direction="row" justifyContent="space-between" alignItems="center">
                                  <Typography variant="h6">Record Details</Typography>
                                  <IconButton onClick={() => setDrawer({ open: false, row: null })}>
                                    <CloseIcon />
                                  </IconButton>
                                </Stack>

                                {drawer.row && (
                                  <Stack spacing={2} sx={{ mt: 1.5 }}>
                                    <Stack direction="row" spacing={1} alignItems="center">
                                      <StatusChip status={drawer.row.status} />
                                    
                                    </Stack>

                                    <Glass>
                                      <Typography variant="subtitle2" sx={{ mb: 1, opacity: 0.8 }}>
                                        Side-by-side comparison
                                      </Typography>

                                      <Stack spacing={1.2}>
                                        <DiffRow
                                          label="Key"
                                          a={drawer.row.key}
                                          b={drawer.row.key}
                                          highlight={false}
                                        />
                                        <DiffRow
                                          label="Amount"
                                          a={drawer.row.a?.[meta?.a?.detected?.amount || "amount"]}
                                          b={drawer.row.b?.[meta?.b?.detected?.amount || "amount"]}
                                          highlight={String(drawer.row.reason || "").includes("AMOUNT")}
                                        />
                                        <DiffRow
                                          label="Date"
                                          a={drawer.row.a?.[meta?.a?.detected?.date || "date"]}
                                          b={drawer.row.b?.[meta?.b?.detected?.date || "date"]}
                                          highlight={String(drawer.row.reason || "").includes("DATE")}
                                        />
                                        <DiffRow
                                          label="Description"
                                          a={drawer.row.a?.description}
                                          b={drawer.row.b?.description}
                                          highlight={false}
                                        />
                                      </Stack>
                                    </Glass>

                                    <Alert severity="info" sx={{ background: "rgba(46,229,157,0.08)", border: "1px solid rgba(46,229,157,0.2)" }}>
                                      Hint: Use tolerances if you expect rounding or timezone differences.
                                    </Alert>
                                  </Stack>
                                )}
                              </Box>
                            </Drawer>
                            <Box
                    sx={{
                      position: "sticky",
                      bottom: 0,
                      width: "100%",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      px: 2,
                      py: 1.5,
                      backdropFilter: "blur(8px)",
                      background: "rgba(10, 12, 20, 0.55)",
                      borderTop: "1px solid rgba(255,255,255,0.08)",
                      zIndex: 10,
                    }}
                  >
                    {/* LEFT — Back */}
                    <Button
                    variant="outlined"
                    onClick={() => navigate("/strategy")}
                    sx={{
                      opacity: 0.75,               // 👈 more visible by default
                      borderColor: "rgba(255,255,255,0.35)",
                      color: "#fff",
                      transition: "opacity 0.2s, border-color 0.2s",
                      "&:hover": {
                        opacity: 1,
                        borderColor: "rgba(255,255,255,0.8)",
                        background: "rgba(255,255,255,0.06)",
                      },
                    }}
                  >
                    Back
                  </Button>


                    {/* RIGHT — Start New */}
                    <Button
                      variant="contained"
                      color="primary"
                      onClick={resetAll}
                      sx={{
                        opacity: 0.6,
                        transition: "opacity 0.2s",
                        "&:hover": { opacity: 1 },
                      }}
                    >
                      Start New Reconciliation
                    </Button>
                  </Box>


                          </motion.div>
                        </AnimatePresence>
                      )
                    }
                  />
                </Route>
                <Route
                  path="*"
                  element={<Navigate to={isAuthed ? "/upload" : "/auth"} replace />}
                />
              </Routes>

              <Snackbar open={toast.open} autoHideDuration={3000} onClose={() => setToast(t => ({ ...t, open: false }))}>
                <Alert severity={toast.severity} sx={{ width: "100%" }} onClose={() => setToast(t => ({ ...t, open: false }))}>
                  {toast.msg}
                </Alert>
              </Snackbar>

            </Stack>
          </Container>
        </Box>
      </ThemeProvider>
    );
  }

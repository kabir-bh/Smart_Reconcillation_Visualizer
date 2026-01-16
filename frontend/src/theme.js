import { createTheme } from "@mui/material/styles";

// App-wide MUI theme; tuned for a dark, glassy UI.
export const theme = createTheme({
  palette: {
    mode: "light",
    background: { default: "#0b1220", paper: "rgba(255,255,255,0.06)" },
    text: { primary: "#e7eefc", secondary: "rgba(231,238,252,0.72)" },
    primary: { main: "#7c5cff" },
    success: { main: "#2ee59d" },
    warning: { main: "#ffcc66" },
    error: { main: "#ff5c7a" }
  },
  shape: { borderRadius: 18 },
  typography: {
    fontFamily: ["Inter", "system-ui", "Avenir", "Helvetica", "Arial", "sans-serif"].join(","),
    h3: { fontWeight: 750 },
    h6: { fontWeight: 700 }
  },
  components: {
    MuiPaper: { styleOverrides: { root: { backdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.10)" } } },
    MuiButton: { styleOverrides: { root: { textTransform: "none", borderRadius: 14, fontWeight: 700 } } },
    MuiChip: { styleOverrides: { root: { borderRadius: 12, fontWeight: 700 } } }
  }
});

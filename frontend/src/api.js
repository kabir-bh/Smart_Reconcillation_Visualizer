import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE || "https://smart-reconcillation-visualizer-5.onrender.com";

export async function createSession(fileA, fileB) {
  const form = new FormData();
  form.append("fileA", fileA);
  form.append("fileB", fileB);
  const { data } = await axios.post(`${API_BASE}/api/sessions`, form, {
    headers: { "Content-Type": "multipart/form-data" }
  });
  return data;
}

export async function runReconcile(payload) {
  const res = await axios.post(`${API_BASE}/api/reconcile`, payload);
  return res.data;
}

export function exportUrl(sessionId, filter = "ALL") {
  return `${API_BASE}/api/export/${sessionId}?filter=${encodeURIComponent(filter)}`;
}

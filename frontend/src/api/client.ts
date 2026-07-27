import type { HealthResponse, ScanResponse, ScanListResponse } from "./types";

const API_BASE = "http://127.0.0.1:8000/api/v1";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  health: () => request<HealthResponse>("/health"),

  startScan: (folderPath: string) =>
    request<ScanResponse>("/scans", {
      method: "POST",
      body: JSON.stringify({ folder_path: folderPath }),
    }),

  getScan: (scanId: number) =>
    request<ScanResponse>(`/scans/${scanId}`),

  listScans: (page = 1, pageSize = 20) =>
    request<ScanListResponse>(`/scans?page=${page}&page_size=${pageSize}`),

  deleteScan: (scanId: number) =>
    request<{ status: string; scan_id: number }>(`/scans/${scanId}`, {
      method: "DELETE",
    }),
};

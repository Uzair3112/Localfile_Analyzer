import type {
  HealthResponse,
  ScanResponse,
  ScanListResponse,
  ScannedFileListResponse,
  DuplicateListResponse,
  SettingsResponse,
  ExtensionBreakdownResponse,
} from "./types";

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

  startScan: (
    folderPath: string,
    settingsOverride?: Partial<{
      ignore_hidden: boolean;
      ignore_node_modules: boolean;
      max_file_size: number;
      custom_ignore_globs: string[];
    }>,
  ) =>
    request<ScanResponse>("/scans", {
      method: "POST",
      body: JSON.stringify({
        folder_path: folderPath,
        settings_override: settingsOverride,
      }),
    }),

  getScan: (scanId: number) => request<ScanResponse>(`/scans/${scanId}`),

  listScans: (page = 1, pageSize = 20) =>
    request<ScanListResponse>(`/scans?page=${page}&page_size=${pageSize}`),

  deleteScan: (scanId: number) =>
    request<{ status: string; scan_id: number }>(`/scans/${scanId}`, {
      method: "DELETE",
    }),

  getScanFiles: (
    scanId: number,
    params?: {
      page?: number;
      page_size?: number;
      extension?: string;
      search?: string;
      sort?: string;
      order?: string;
    },
  ) => {
    const query = new URLSearchParams();
    if (params?.page) query.set("page", String(params.page));
    if (params?.page_size) query.set("page_size", String(params.page_size));
    if (params?.extension) query.set("extension", params.extension);
    if (params?.search) query.set("search", params.search);
    if (params?.sort) query.set("sort", params.sort);
    if (params?.order) query.set("order", params.order);
    const qs = query.toString();
    return request<ScannedFileListResponse>(`/scans/${scanId}/files${qs ? `?${qs}` : ""}`);
  },

  getScanDuplicates: (scanId: number) =>
    request<DuplicateListResponse>(`/scans/${scanId}/duplicates`),

  getScanExtensions: (scanId: number, limit?: number) =>
    request<ExtensionBreakdownResponse>(
      `/scans/${scanId}/extensions${limit ? `?limit=${limit}` : ""}`,
    ),

  getSettings: () => request<SettingsResponse>("/settings"),

  updateSettings: (settings: Partial<SettingsResponse>) =>
    request<SettingsResponse>("/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),
};

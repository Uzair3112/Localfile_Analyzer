export interface HealthResponse {
  status: string;
  db: string;
}

export interface Scan {
  scan_id: number;
  status: "pending" | "running" | "completed" | "failed";
  folder_path: string;
  started_at: string | null;
  completed_at: string | null;
  total_files: number;
  total_size: number;
  total_lines: number;
}

export interface ScannedFile {
  id: number;
  scan_id: number;
  filename: string;
  full_path: string;
  extension: string | null;
  size: number;
  line_count: number | null;
  sha256: string | null;
  created_at: string | null;
  modified_at: string | null;
}

export interface Todo {
  id: number;
  file_id: number;
  line_number: number;
  type: "TODO" | "FIXME";
  message: string | null;
}

export interface Duplicate {
  id: number;
  scan_id: number;
  hash: string;
  file1_id: number;
  file2_id: number;
}

export interface ScanSettings {
  ignore_hidden: boolean;
  ignore_node_modules: boolean;
  max_file_size: number;
  custom_ignore_globs: string[];
}

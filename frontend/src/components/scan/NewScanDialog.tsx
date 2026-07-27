import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { ScanResponse } from "../../api/types";

interface NewScanDialogProps {
  folderPath: string;
  onCancel: () => void;
  onStart: (scan: ScanResponse) => void;
}

export default function NewScanDialog({ folderPath, onCancel, onStart }: NewScanDialogProps) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleStart = async () => {
    setStarting(true);
    setError(null);
    try {
      const scan = await api.startScan(folderPath);
      onStart(scan);
      navigate(`/scans/${scan.scan_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start scan");
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2 className="dialog-title">New Scan</h2>
        <div className="dialog-body">
          <label className="dialog-label">Folder to scan</label>
          <div className="dialog-path">{folderPath}</div>
        </div>
        {error && <div className="dialog-error">{error}</div>}
        <div className="dialog-actions">
          <button className="btn-secondary" onClick={onCancel} disabled={starting}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleStart} disabled={starting}>
            {starting ? "Starting..." : "Start Scan"}
          </button>
        </div>
      </div>
    </div>
  );
}

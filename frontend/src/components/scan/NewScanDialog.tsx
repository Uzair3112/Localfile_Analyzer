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
  const [showOverrides, setShowOverrides] = useState(false);
  const [overrideHidden, setOverrideHidden] = useState<boolean | null>(null);
  const [overrideNodeModules, setOverrideNodeModules] = useState<boolean | null>(null);
  const [overrideMaxSize, setOverrideMaxSize] = useState<number | null>(null);
  const navigate = useNavigate();

  const handleStart = async () => {
    setStarting(true);
    setError(null);
    try {
      const overrides: Record<string, unknown> = {};
      if (overrideHidden !== null) overrides.ignore_hidden = overrideHidden;
      if (overrideNodeModules !== null) overrides.ignore_node_modules = overrideNodeModules;
      if (overrideMaxSize !== null) overrides.max_file_size = overrideMaxSize;
      const settingsOverride = Object.keys(overrides).length > 0 ? overrides : undefined;

      const scan = await api.startScan(folderPath, settingsOverride as Record<string, boolean | number>);
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

          <div style={{ marginTop: 16 }}>
            <button
              className="btn-secondary"
              onClick={() => setShowOverrides(!showOverrides)}
              style={{ fontSize: 13, padding: "6px 12px" }}
            >
              {showOverrides ? "Hide" : "Override"} scan settings
            </button>
          </div>

          {showOverrides && (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              <label className="dialog-label" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={overrideHidden ?? true}
                  onChange={(e) => setOverrideHidden(e.target.checked)}
                />
                Ignore hidden files
              </label>
              <label className="dialog-label" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={overrideNodeModules ?? true}
                  onChange={(e) => setOverrideNodeModules(e.target.checked)}
                />
                Ignore node_modules
              </label>
              <label className="dialog-label" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                Max file size (bytes, 0 = no limit)
                <input
                  className="settings-input"
                  type="number"
                  value={overrideMaxSize ?? 52428800}
                  onChange={(e) => setOverrideMaxSize(Number(e.target.value))}
                  min={0}
                />
              </label>
            </div>
          )}
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

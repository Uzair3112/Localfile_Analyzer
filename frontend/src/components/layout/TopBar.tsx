import { useState } from "react";
import { useFolderPicker } from "../../hooks/useFolderPicker";
import NewScanDialog from "../scan/NewScanDialog";
import type { ScanResponse } from "../../api/types";

interface TopBarProps {
  title: string;
}

export default function TopBar({ title }: TopBarProps) {
  const { pickFolder, clearFolder, loading, error } = useFolderPicker();
  const [pendingPath, setPendingPath] = useState<string | null>(null);

  const handleNewScan = async () => {
    const path = await pickFolder();
    if (path) {
      setPendingPath(path);
    }
  };

  const handleCancel = () => {
    setPendingPath(null);
    clearFolder();
  };

  const handleStart = (_scan: ScanResponse) => {
    setPendingPath(null);
    clearFolder();
  };

  return (
    <>
      <header className="topbar">
        <h1 className="topbar-title">{title}</h1>
        <button className="btn-primary" onClick={handleNewScan} disabled={loading}>
          {loading ? "Selecting..." : "New Scan"}
        </button>
      </header>
      {pendingPath && (
        <NewScanDialog
          folderPath={pendingPath}
          onCancel={handleCancel}
          onStart={handleStart}
        />
      )}
      {error && (
        <div className="topbar-error">{error}</div>
      )}
    </>
  );
}

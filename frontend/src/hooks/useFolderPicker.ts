import { useState, useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";

interface UseFolderPickerReturn {
  folderPath: string | null;
  pickFolder: () => Promise<string | null>;
  clearFolder: () => void;
  loading: boolean;
  error: string | null;
}

export function useFolderPicker(): UseFolderPickerReturn {
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickFolder = useCallback(async (): Promise<string | null> => {
    setLoading(true);
    setError(null);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select a folder to scan",
      });
      if (selected && typeof selected === "string") {
        setFolderPath(selected);
        return selected;
      }
      return null;
    } catch (err) {
      console.warn("Folder picker unavailable (browser dev mode?):", err);
      setError("Folder picker is only available in the Tauri desktop app.");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const clearFolder = useCallback(() => {
    setFolderPath(null);
    setError(null);
  }, []);

  return { folderPath, pickFolder, clearFolder, loading, error };
}

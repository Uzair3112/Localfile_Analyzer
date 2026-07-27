import { useState, useEffect, useRef } from "react";
import { api } from "../api/client";
import type { ScanResponse } from "../api/types";

export function useScanPolling(scanId: number | null) {
  const [scan, setScan] = useState<ScanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (scanId === null || scanId === undefined) {
      setScan(null);
      setLoading(false);
      setError(null);
      return;
    }

    const poll = async () => {
      try {
        const data = await api.getScan(scanId);
        setScan(data);
        setError(null);

        if (data.status === "completed" || data.status === "failed") {
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
            setLoading(false);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to poll scan");
      }
    };

    setLoading(true);
    poll();
    intervalRef.current = setInterval(poll, 1500);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [scanId]);

  return { scan, loading, error };
}

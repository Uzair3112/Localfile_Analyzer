import { useState } from "react";
import type { ScanResponse } from "../api/types";

export function useScans() {
  const [scans, setScans] = useState<ScanResponse[]>([]);
  const [loading, setLoading] = useState(false);

  return { scans, loading, setScans, setLoading };
}

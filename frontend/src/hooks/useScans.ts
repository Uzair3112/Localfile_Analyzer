import { useState } from "react";
import type { Scan } from "../api/types";

export function useScans() {
  const [scans, setScans] = useState<Scan[]>([]);
  const [loading, setLoading] = useState(false);

  return { scans, loading, setScans, setLoading };
}

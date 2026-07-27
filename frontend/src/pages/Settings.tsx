import { useState, useEffect } from "react";
import { api } from "../api/client";

export default function Settings() {
  const [ignoreHidden, setIgnoreHidden] = useState(true);
  const [ignoreNodeModules, setIgnoreNodeModules] = useState(true);
  const [maxFileSize, setMaxFileSize] = useState(52428800);
  const [customGlobs, setCustomGlobs] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    api.getSettings()
      .then((s) => {
        setIgnoreHidden(s.ignore_hidden);
        setIgnoreNodeModules(s.ignore_node_modules);
        setMaxFileSize(s.max_file_size);
        setCustomGlobs(s.custom_ignore_globs.join(", "));
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await api.updateSettings({
        ignore_hidden: ignoreHidden,
        ignore_node_modules: ignoreNodeModules,
        max_file_size: maxFileSize,
        custom_ignore_globs: customGlobs
          .split(",")
          .map((g) => g.trim())
          .filter(Boolean),
      });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <h1>Settings</h1>
        <p style={{ marginTop: 16, color: "var(--color-text-muted)" }}>Loading...</p>
      </div>
    );
  }

  return (
    <div className="page">
      <h1>Settings</h1>
      <p style={{ marginTop: 8, color: "var(--color-text-muted)", fontSize: 14 }}>
        These defaults apply to all new scans. Each scan can override them individually.
      </p>

      <div className="settings-form" style={{ marginTop: 24, maxWidth: 480 }}>
        <label className="settings-field">
          <span className="settings-label">Ignore hidden files</span>
          <span className="settings-desc">Skip dotfiles and dotfolders (e.g. .git, .env)</span>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={ignoreHidden}
              onChange={(e) => setIgnoreHidden(e.target.checked)}
            />
            <span className="settings-toggle-slider"></span>
          </label>
        </label>

        <label className="settings-field">
          <span className="settings-label">Ignore node_modules</span>
          <span className="settings-desc">Skip node_modules directories entirely</span>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={ignoreNodeModules}
              onChange={(e) => setIgnoreNodeModules(e.target.checked)}
            />
            <span className="settings-toggle-slider"></span>
          </label>
        </label>

        <div className="settings-field">
          <span className="settings-label">Max file size (bytes)</span>
          <span className="settings-desc">Files larger than this are skipped (0 = no limit)</span>
          <input
            className="settings-input"
            type="number"
            value={maxFileSize}
            onChange={(e) => setMaxFileSize(Number(e.target.value))}
            min={0}
          />
        </div>

        <div className="settings-field">
          <span className="settings-label">Custom ignore globs</span>
          <span className="settings-desc">Comma-separated glob patterns (e.g. *.log, dist/*)</span>
          <input
            className="settings-input"
            type="text"
            value={customGlobs}
            onChange={(e) => setCustomGlobs(e.target.value)}
            placeholder="*.log, dist/*, build/**"
          />
        </div>

        {error && <div className="dialog-error" style={{ marginTop: 12 }}>{error}</div>}
        {success && (
          <div style={{ marginTop: 12, background: "#D4EDDA", color: "#155724", padding: "10px 14px", borderRadius: 8, fontSize: 13 }}>
            Settings saved successfully.
          </div>
        )}

        <button
          className="btn-primary"
          onClick={handleSave}
          disabled={saving}
          style={{ marginTop: 20 }}
        >
          {saving ? "Saving..." : "Save Settings"}
        </button>
      </div>
    </div>
  );
}

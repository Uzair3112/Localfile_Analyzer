import { NavLink, useLocation } from "react-router-dom";

const navItems = [
  { to: "/", label: "Dashboard" },
  { to: "/scans", label: "Scans" },
  { to: "/duplicates", label: "Duplicates" },
  { to: "/settings", label: "Settings" },
];

export default function Sidebar() {
  const location = useLocation();
  const match = location.pathname.match(/^\/scans\/(\d+)$/);
  const currentScanId = match ? match[1] : null;

  const getTo = (item: typeof navItems[number]) => {
    if (item.to === "/duplicates" && currentScanId) {
      return `/duplicates?scanId=${currentScanId}`;
    }
    return item.to;
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">File Analyzer</div>

      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={getTo(item)}
            end={item.to === "/"}
            className={({ isActive }) =>
              `sidebar-link${isActive ? " active" : ""}`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-tips">
        <div className="tips-card">
          <strong>Pro Tip</strong>
          <p>Run a scan to analyze your project folder</p>
        </div>
      </div>
    </aside>
  );
}

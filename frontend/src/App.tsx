import { useEffect } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import Sidebar from "./components/layout/Sidebar";
import TopBar from "./components/layout/TopBar";
import Dashboard from "./pages/Dashboard";
import ScansList from "./pages/ScansList";
import ScanDetail from "./pages/ScanDetail";
import Duplicates from "./pages/Duplicates";
import Settings from "./pages/Settings";
import { api } from "./api/client";
import "./App.css";

function AppLayout() {
  const location = useLocation();

  const getTitle = () => {
    if (location.pathname.startsWith("/scans/")) return "Scan Detail";
    switch (location.pathname) {
      case "/": return "Dashboard";
      case "/scans": return "Scans";
      case "/duplicates": return "Duplicates";
      case "/settings": return "Settings";
      default: return "File Analyzer";
    }
  };

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-area">
        <TopBar title={getTitle()} />
        <main className="content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/scans" element={<ScansList />} />
            <Route path="/scans/:scanId" element={<ScanDetail />} />
            <Route path="/duplicates" element={<Duplicates />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function App() {
  useEffect(() => {
    api.health()
      .then((data) => console.log("Backend connected:", data))
      .catch((err) => console.warn("Backend unreachable:", err.message));
  }, []);

  return (
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  );
}

export default App;

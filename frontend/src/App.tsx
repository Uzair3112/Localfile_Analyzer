import { useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Sidebar from "./components/layout/Sidebar";
import TopBar from "./components/layout/TopBar";
import Dashboard from "./pages/Dashboard";
import ScanDetail from "./pages/ScanDetail";
import Duplicates from "./pages/Duplicates";
import Todos from "./pages/Todos";
import Settings from "./pages/Settings";
import { api } from "./api/client";
import "./App.css";

const pageTitles: Record<string, string> = {
  "/": "Dashboard",
  "/scans": "Scans",
  "/duplicates": "Duplicates",
  "/todos": "TODO / FIXME",
  "/settings": "Settings",
};

function App() {
  useEffect(() => {
    api.health()
      .then((data) => console.log("Backend connected:", data))
      .catch((err) => console.warn("Backend unreachable:", err.message));
  }, []);

  return (
    <BrowserRouter>
      <div className="app-layout">
        <Sidebar />
        <div className="main-area">
          <Routes>
            <Route path="/" element={<><TopBar title={pageTitles["/"]} /><main className="content"><Dashboard /></main></>} />
            <Route path="/scans" element={<><TopBar title={pageTitles["/scans"]} /><main className="content"><ScanDetail /></main></>} />
            <Route path="/duplicates" element={<><TopBar title={pageTitles["/duplicates"]} /><main className="content"><Duplicates /></main></>} />
            <Route path="/todos" element={<><TopBar title={pageTitles["/todos"]} /><main className="content"><Todos /></main></>} />
            <Route path="/settings" element={<><TopBar title={pageTitles["/settings"]} /><main className="content"><Settings /></main></>} />
          </Routes>
        </div>
      </div>
    </BrowserRouter>
  );
}

export default App;

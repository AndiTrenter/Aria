import { useState, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth, useTheme, API, formatApiError } from "@/App";
import axios from "axios";
import { toast } from "sonner";
import { SignOut, ArrowSquareOut, Circle } from "@phosphor-icons/react";

const Dashboard = () => {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [services, setServices] = useState([]);
  const [stats, setStats] = useState({});
  const [healthData, setHealthData] = useState([]);
  const [clock, setClock] = useState(new Date());

  const fetchData = async () => {
    try {
      const healthPromise = axios.get(`${API}/health/services`, { timeout: 3000 }).catch(() => ({ data: [] }));
      const [servicesRes, statsRes, healthRes] = await Promise.all([
        axios.get(`${API}/services`),
        axios.get(`${API}/dashboard/stats`),
        healthPromise
      ]);
      setServices(servicesRes.data);
      setStats(statsRes.data);
      setHealthData(healthRes.data);
    } catch (e) {
      console.error("Failed to fetch dashboard data:", e);
    }
  };

  useEffect(() => { fetchData(); }, []);
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const getServiceHealth = (serviceId) => {
    const h = healthData.find(h => h.id === serviceId);
    return h?.status || "unknown";
  };

  const navItems = [
    { path: "/", label: "Dashboard", shortLabel: "DASH" },
    { path: "/health", label: "Health", shortLabel: "HEALTH" },
    { path: "/chat", label: "Chat", shortLabel: "CHAT" },
    { path: "/weather", label: "Wetter", shortLabel: "WETTER" },
    { path: "/account", label: "Konto", shortLabel: "KONTO" },
    { path: "/logs", label: "Logs", shortLabel: "LOGS" },
  ];

  if (user?.role === "admin" || user?.role === "superadmin") {
    navItems.push({ path: "/admin", label: "Admin", shortLabel: "ADMIN" });
  }

  // LCARS Theme
  if (theme === "startrek") {
    const stardate = `${clock.toLocaleDateString("de-DE")} ${clock.toLocaleTimeString("de-DE")} | STARDATE ${Math.floor(Date.now() / 86400000)}`;
    return (
      <div className="min-h-screen flex flex-col" data-testid="lcars-dashboard">
        {/* LCARS Header - sticky */}
        <div className="lcars-header sticky top-0 z-50">
          <div className="lcars-header-cap" data-testid="lcars-header-cap">
            ARIA
          </div>
          <div className="lcars-header-bar">
            <span className="text-xs text-gray-500 ml-3 tracking-wider whitespace-nowrap">{stardate}</span>
          </div>
          <div className="lcars-header-end">
            <button onClick={handleLogout} className="text-black text-xs font-bold tracking-wider" data-testid="logout-button">
              ABMELDEN
            </button>
          </div>
        </div>

        {/* Main Layout: Sidebar + Content */}
        <div className="flex flex-1 overflow-hidden">
          {/* LCARS Sidebar - sticky */}
          <div className="lcars-sidebar sticky top-[50px] h-[calc(100vh-50px)] overflow-auto" data-testid="lcars-sidebar">
            {navItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`lcars-sidebar-item ${location.pathname === item.path ? "active" : ""}`}
                data-testid={`nav-${item.shortLabel.toLowerCase()}`}
              >
                {item.shortLabel}
              </Link>
            ))}
            <Link
              to="#"
              onClick={(e) => { e.preventDefault(); setTheme(theme === "startrek" ? "disney" : "startrek"); }}
              className="lcars-sidebar-item"
              style={{ background: "var(--lcars-tan)" }}
              data-testid="nav-theme"
            >
              THEME
            </Link>
            <div className="lcars-sidebar-spacer" />
            <div className="lcars-sidebar-bottom" />
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-auto p-6">
            {/* Welcome */}
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-[var(--lcars-orange)] tracking-wider">
                Willkommen, {user?.name}
              </h1>
              <div className="flex gap-8 mt-2 text-sm">
                <span className="text-[var(--lcars-mauve)]">{stats.services || 0} DIENSTE</span>
                <span className="text-[var(--lcars-blue)]">{stats.users || 0} BENUTZER</span>
                <span className="text-[var(--lcars-purple)]">{stats.logs_today || 0} LOGS HEUTE</span>
              </div>
            </div>

            {/* Services Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {services.map((service) => {
                const health = getServiceHealth(service.id);
                const colors = {
                  casedesk: "var(--lcars-blue)",
                  forgepilot: "var(--lcars-purple)",
                  nextcloud: "var(--lcars-mauve)",
                  unraid: "var(--lcars-salmon)",
                };
                const borderColor = colors[service.id] || "var(--lcars-orange)";
                return (
                  <div
                    key={service.id}
                    className="bg-[#0a0a14]/80 rounded-r-xl p-4 relative overflow-hidden"
                    style={{ borderLeft: `6px solid ${borderColor}` }}
                    data-testid={`service-card-${service.id}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-bold text-sm tracking-wider" style={{ color: borderColor }}>{service.name}</h3>
                      <Circle size={10} weight="fill" className={health === "healthy" ? "text-green-400" : health === "offline" ? "text-red-400" : "text-yellow-400"} />
                    </div>
                    <p className="text-xs text-gray-500 mb-1">{service.category}</p>
                    <p className="text-xs text-gray-400 mb-3">{service.description}</p>
                    <div className="flex items-center justify-between">
                      <span className={`text-[10px] font-bold tracking-wider ${health === "healthy" ? "text-green-400" : health === "offline" ? "text-red-400" : "text-yellow-400"}`}>
                        {health === "healthy" ? "ONLINE" : health === "offline" ? "OFFLINE" : "UNBEKANNT"}
                      </span>
                      <div className="flex gap-2">
                        {service.linked && (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-green-900/40 text-green-400 font-bold">VERKNÜPFT</span>
                        )}
                        <a
                          href={service.url}
                          target="_blank"
                          rel="noreferrer"
                          className="lcars-button text-[10px] py-1 px-3 flex items-center gap-1"
                          data-testid={`service-access-${service.id}`}
                        >
                          ZUGRIFF <ArrowSquareOut size={10} />
                        </a>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="lcars-footer-bar mt-8">
              <div /><div /><div /><div />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Disney Theme
  return (
    <div className="min-h-screen relative z-10" data-testid="disney-dashboard">
      <header className="disney-header py-4 px-6 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center gap-4">
          <h1 className="disney-title text-2xl font-bold">Aria Dashboard</h1>
          <span className="text-purple-400 text-xs">{clock.toLocaleDateString("de-DE")} {clock.toLocaleTimeString("de-DE")}</span>
          <div className="flex-1" />
          <nav className="flex gap-3">
            {navItems.map((item) => (
              <Link key={item.path} to={item.path}
                className={`text-sm px-3 py-1 rounded-full transition-all ${location.pathname === item.path ? "bg-purple-600 text-white" : "text-purple-300 hover:bg-purple-800/50"}`}
                data-testid={`nav-${item.shortLabel.toLowerCase()}`}
              >
                {item.label}
              </Link>
            ))}
            <button onClick={() => setTheme("startrek")} className="text-sm px-3 py-1 text-purple-300 hover:bg-purple-800/50 rounded-full" data-testid="nav-theme">Theme</button>
            <button onClick={handleLogout} className="text-sm px-3 py-1 text-red-300 hover:bg-red-900/50 rounded-full" data-testid="logout-button">
              <SignOut size={16} />
            </button>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h2 className="disney-title text-3xl font-bold disney-glow">Willkommen, {user?.name}!</h2>
          <div className="flex gap-6 mt-3">
            <div className="disney-card p-4 text-center flex-1">
              <div className="text-2xl font-bold text-purple-200">{stats.services || 0}</div>
              <div className="text-xs text-purple-400">Dienste</div>
            </div>
            <div className="disney-card p-4 text-center flex-1">
              <div className="text-2xl font-bold text-purple-200">{stats.users || 0}</div>
              <div className="text-xs text-purple-400">Benutzer</div>
            </div>
            <div className="disney-card p-4 text-center flex-1">
              <div className="text-2xl font-bold text-purple-200">{stats.logs_today || 0}</div>
              <div className="text-xs text-purple-400">Logs heute</div>
            </div>
          </div>
        </div>

        <h3 className="disney-title text-xl font-bold mb-4">Aktive Dienste</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {services.map((service) => {
            const health = getServiceHealth(service.id);
            return (
              <div key={service.id} className="disney-card" data-testid={`service-card-${service.id}`}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold">{service.name}</h3>
                  <Circle size={10} weight="fill" className={health === "healthy" ? "text-green-400" : health === "offline" ? "text-red-400" : "text-yellow-400"} />
                </div>
                <p className="text-sm text-purple-300 mb-1">{service.category}</p>
                <p className="text-sm text-purple-400 mb-3">{service.description}</p>
                <div className="flex justify-between items-center">
                  <span className={`text-xs font-bold ${health === "healthy" ? "text-green-400" : health === "offline" ? "text-red-400" : "text-yellow-400"}`}>
                    {health === "healthy" ? "ONLINE" : health === "offline" ? "OFFLINE" : "UNBEKANNT"}
                  </span>
                  <a href={service.url} target="_blank" rel="noreferrer" className="disney-button text-xs py-1.5 px-4" data-testid={`service-access-${service.id}`}>
                    Zugriff <ArrowSquareOut size={12} className="inline ml-1" />
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
};

export default Dashboard;

import { useState, useEffect } from "react";
import { useAuth, useTheme, API } from "@/App";
import axios from "axios";
import { ArrowSquareOut, Circle, Globe, House } from "@phosphor-icons/react";

const Dashboard = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [services, setServices] = useState([]);
  const [stats, setStats] = useState({});
  const [healthData, setHealthData] = useState([]);

  const fetchData = async () => {
    try { const r = await axios.get(`${API}/services`); setServices(r.data); } catch {}
    try { const r = await axios.get(`${API}/dashboard/stats`); setStats(r.data); } catch {}
    try { const r = await axios.get(`${API}/health/services`, { timeout: 3000 }); setHealthData(r.data); } catch {}
  };

  useEffect(() => { fetchData(); }, []);

  const getServiceHealth = (serviceId) => {
    const h = healthData.find(h => h.id === serviceId);
    return h?.status || "unknown";
  };

  // Build proxy URL: same origin + /api/proxy/service_id/ + auth token
  const getProxyUrl = (service) => {
    const origin = window.location.origin;
    const token = localStorage.getItem("token") || "";
    return `${origin}/api/proxy/${service.id}/?token=${encodeURIComponent(token)}`;
  };

  // Check if user is on local network
  const isLocal = window.location.hostname.match(/^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|localhost|127\.)/);

  const getServiceUrl = (service) => {
    // If on local network, use direct URL. If external, use proxy.
    return isLocal ? service.url : getProxyUrl(service);
  };

  const isLcars = theme === "startrek";

  return (
    <div className="p-6" data-testid="dashboard-content">
      {/* Welcome */}
      <div className="mb-6">
        <h1 className={`text-2xl font-bold tracking-wider ${isLcars ? "text-[var(--lcars-orange)]" : "disney-title disney-glow text-3xl"}`}>
          Willkommen, {user?.name}{isLcars ? "" : "!"}
        </h1>
        <div className={`flex gap-6 mt-3 ${isLcars ? "" : "flex-wrap"}`}>
          {isLcars ? (
            <>
              <span className="text-[var(--lcars-mauve)]">{stats.services || 0} DIENSTE</span>
              <span className="text-[var(--lcars-blue)]">{stats.users || 0} BENUTZER</span>
              <span className="text-[var(--lcars-purple)]">{stats.logs_today || 0} LOGS HEUTE</span>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>

      {/* Services Grid */}
      {!isLcars && <h3 className="disney-title text-xl font-bold mb-4">Aktive Dienste</h3>}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {services.map((service) => {
          const health = getServiceHealth(service.id);
          if (isLcars) {
            const colors = {
              casedesk: "var(--lcars-blue)", forgepilot: "var(--lcars-purple)",
              nextcloud: "var(--lcars-mauve)", unraid: "var(--lcars-salmon)",
            };
            const borderColor = colors[service.id] || "var(--lcars-orange)";
            return (
              <div key={service.id} className="bg-[#0a0a14]/80 rounded-r-xl p-4" style={{ borderLeft: `6px solid ${borderColor}` }} data-testid={`service-card-${service.id}`}>
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
                  <div className="flex items-center gap-1">
                    {!isLocal && (
                      <span className="text-[9px] text-gray-500 mr-1" title="Zugriff über Aria-Proxy">
                        <Globe size={10} className="inline" />
                      </span>
                    )}
                    <a href={getServiceUrl(service)} target="_blank" rel="noreferrer" className="lcars-button text-[10px] py-1 px-3 flex items-center gap-1" data-testid={`service-access-${service.id}`}>
                      ZUGRIFF <ArrowSquareOut size={10} />
                    </a>
                  </div>
                </div>
              </div>
            );
          }
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
                <div className="flex items-center gap-2">
                  {!isLocal && (
                    <span className="text-[10px] text-purple-500" title="Zugriff über Aria-Proxy">
                      <Globe size={12} className="inline" />
                    </span>
                  )}
                  <a href={getServiceUrl(service)} target="_blank" rel="noreferrer" className="disney-button text-xs py-1.5 px-4" data-testid={`service-access-${service.id}`}>
                    Zugriff <ArrowSquareOut size={12} className="inline ml-1" />
                  </a>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* LCARS Footer */}
      {isLcars && (
        <div className="lcars-footer-bar mt-8">
          <div /><div /><div /><div />
        </div>
      )}
    </div>
  );
};

export default Dashboard;

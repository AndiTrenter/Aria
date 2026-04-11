import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth, useTheme, API } from "@/App";
import axios from "axios";
import { ArrowLeft, ArrowClockwise, Circle } from "@phosphor-icons/react";

const ProgressBar = ({ percent = 0, color = "orange", height = "h-2" }) => {
  const barColor = percent > 90 ? "from-red-500 to-red-600" : percent > 70 ? "from-orange-500 to-yellow-500" : "from-green-500 to-emerald-400";
  return (
    <div className={`w-full ${height} bg-gray-800 rounded-full overflow-hidden`}>
      <div className={`h-full bg-gradient-to-r ${barColor} transition-all duration-700 ease-out rounded-full`}
        style={{ width: `${Math.min(percent, 100)}%` }} />
    </div>
  );
};

const DonutChart = ({ percent = 0, size = 100, strokeWidth = 10, color = "#ff9900", label }) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#1a1a2e" strokeWidth={strokeWidth} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth}
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
          className="transition-all duration-700 ease-out" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-bold" style={{ color }}>{Math.round(percent)}%</span>
        {label && <span className="text-[10px] text-gray-400 uppercase tracking-wider">{label}</span>}
      </div>
    </div>
  );
};

const formatBytes = (bytes) => {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

const EMPTY_SYSTEM = {
  cpu: { model: "N/A", physical_cores: 0, logical_cores: 0, frequency_mhz: 0, overall_percent: 0, per_core_percent: [], load_avg_1m: 0, load_avg_5m: 0, load_avg_15m: 0 },
  memory: { total_gb: 0, used_gb: 0, available_gb: 0, percent: 0, swap_total_gb: 0, swap_used_gb: 0, swap_percent: 0 },
  uptime: { days: 0, hours: 0, minutes: 0 },
  disks: [],
  network: { bytes_sent: 0, bytes_recv: 0, interfaces: [] },
};

const Health = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [system, setSystem] = useState(EMPTY_SYSTEM);
  const [docker, setDocker] = useState({ available: false, containers: [], running: 0, stopped: 0 });
  const [services, setServices] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);

  const fetchData = async () => {
    setRefreshing(true);
    const token = localStorage.getItem('aria_token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    try {
      const sysResp = await axios.get(`${API}/health/system`, { headers });
      if (sysResp.data) setSystem(sysResp.data);
    } catch (e) { /* keep previous */ }
    try {
      const dkResp = await axios.get(`${API}/health/docker`, { headers });
      if (dkResp.data) setDocker(dkResp.data);
    } catch (e) { /* keep previous */ }
    try {
      const svcResp = await axios.get(`${API}/health/services`, { headers });
      if (svcResp.data) setServices(svcResp.data);
    } catch (e) { /* keep previous */ }
    setRefreshing(false);
    setLastUpdate(new Date().toLocaleTimeString("de-DE"));
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(fetchData, 15000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh]);

  const isLcars = theme === "startrek";
  const cardClass = isLcars ? "lcars-card" : "disney-card";
  const cpu = system?.cpu || EMPTY_SYSTEM.cpu;
  const mem = system?.memory || EMPTY_SYSTEM.memory;
  const uptime = system?.uptime || EMPTY_SYSTEM.uptime;
  const disks = system?.disks || [];
  const network = system?.network || EMPTY_SYSTEM.network;

  return (
    <div className="p-6 space-y-6">
      {/* Page Title + Controls */}
      <div className="flex items-center gap-4 flex-wrap">
        <h2 className={`${isLcars ? "text-lg tracking-widest text-[var(--lcars-orange)]" : "disney-title text-2xl font-bold"}`}>
          {isLcars ? "SYSTEM DIAGNOSTIK" : "System-Gesundheit"}
        </h2>
        <div className="flex-1" />
        {lastUpdate && <span className="text-xs text-gray-500">{lastUpdate}</span>}
        <button onClick={() => setAutoRefresh(!autoRefresh)} data-testid="auto-refresh-toggle"
          className={`text-[10px] px-3 py-1 rounded-full font-bold ${autoRefresh ? "bg-green-700 text-green-200" : "bg-gray-800 text-gray-500"}`}>{autoRefresh ? "LIVE" : "PAUSE"}</button>
        <button onClick={fetchData} data-testid="refresh-button" className={isLcars ? "lcars-button py-1 px-3 text-xs" : "disney-button py-1 px-3"}>
          <ArrowClockwise size={14} className={refreshing ? "animate-spin" : ""} />
        </button>
      </div>

        {/* Uptime */}
        <div className={`${cardClass} flex items-center gap-4`} data-testid="uptime-banner">
          <div className={`text-2xl ${isLcars ? "text-orange-500" : "text-purple-400"}`}>&#9200;</div>
          <div>
            <span className={`text-xs ${isLcars ? "text-orange-400 tracking-widest" : "text-purple-300"}`}>UPTIME</span>
            <div className="text-lg font-bold">
              {uptime.days} Tage, {uptime.hours} Stunden, {uptime.minutes} Minuten
            </div>
          </div>
        </div>

        {/* CPU */}
        <div className={cardClass} data-testid="cpu-section">
          <div className="flex items-center gap-3 mb-4">
            <span className={`text-xl ${isLcars ? "text-orange-500" : "text-purple-400"}`}>&#128187;</span>
            <span className={`font-bold ${isLcars ? "text-xs tracking-widest text-orange-400" : "text-sm text-purple-300"}`}>PROZESSOR</span>
          </div>
          <div className="text-sm text-gray-300 mb-3">{cpu.model}</div>
          <div className="flex items-center gap-4 mb-4">
            <span className="text-sm text-gray-400">Gesamtlast:</span>
            <span className="font-bold text-lg">{cpu.overall_percent}%</span>
            <div className="flex-1">
              <ProgressBar percent={cpu.overall_percent} height="h-3" />
            </div>
          </div>
          <div className="text-xs text-gray-500 mb-2">
            {cpu.physical_cores} physische / {cpu.logical_cores} logische Kerne
            {cpu.frequency_mhz > 0 ? ` @ ${cpu.frequency_mhz} MHz` : ""}
          </div>
          {cpu.per_core_percent.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 mt-3">
              {cpu.per_core_percent.map((pct, i) => (
                <div key={i} className="bg-gray-900/50 rounded-lg p-2 text-center">
                  <div className="text-[10px] text-gray-500 mb-1">Kern {i}</div>
                  <div className={`text-sm font-bold ${pct > 80 ? "text-red-400" : pct > 50 ? "text-orange-400" : "text-green-400"}`}>{pct}%</div>
                  <div className="mt-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-500 ${pct > 80 ? "bg-red-500" : pct > 50 ? "bg-orange-500" : "bg-green-500"}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-6 mt-3 text-xs text-gray-500">
            <span>Load 1m: {cpu.load_avg_1m}</span>
            <span>Load 5m: {cpu.load_avg_5m}</span>
            <span>Load 15m: {cpu.load_avg_15m}</span>
          </div>
        </div>

        {/* Memory + Disk */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Memory */}
          <div className={cardClass} data-testid="memory-section">
            <div className="flex items-center gap-3 mb-4">
              <span className={`text-xl ${isLcars ? "text-orange-500" : "text-purple-400"}`}>&#128190;</span>
              <span className={`font-bold ${isLcars ? "text-xs tracking-widest text-orange-400" : "text-sm text-purple-300"}`}>ARBEITSSPEICHER</span>
            </div>
            <div className="flex items-center gap-6">
              <DonutChart percent={mem.percent} size={110} color={isLcars ? "#ff9900" : "#9b59b6"} label="RAM" />
              <div className="flex-1 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Gesamt</span>
                  <span className="font-bold">{mem.total_gb} GB</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Belegt</span>
                  <span className="font-bold text-orange-400">{mem.used_gb} GB</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Verfügbar</span>
                  <span className="font-bold text-green-400">{mem.available_gb} GB</span>
                </div>
                {mem.swap_total_gb > 0 && (
                  <div className="pt-2 border-t border-gray-700">
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>Swap: {mem.swap_used_gb} / {mem.swap_total_gb} GB</span>
                      <span>{mem.swap_percent}%</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Disks */}
          <div className={cardClass} data-testid="disk-section">
            <div className="flex items-center gap-3 mb-4">
              <span className={`text-xl ${isLcars ? "text-orange-500" : "text-purple-400"}`}>&#128451;</span>
              <span className={`font-bold ${isLcars ? "text-xs tracking-widest text-orange-400" : "text-sm text-purple-300"}`}>SPEICHER</span>
            </div>
            <div className="space-y-3">
              {disks.length > 0 ? disks.map((disk, i) => (
                <div key={i} className="bg-gray-900/40 rounded-lg p-3">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-300 truncate max-w-[60%]" title={disk.mountpoint}>{disk.mountpoint}</span>
                    <span className={`font-bold ${disk.percent > 90 ? "text-red-400" : disk.percent > 70 ? "text-orange-400" : "text-green-400"}`}>{disk.percent}%</span>
                  </div>
                  <ProgressBar percent={disk.percent} />
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>{disk.used_gb} GB / {disk.total_gb} GB</span>
                    <span>{disk.fstype}</span>
                  </div>
                </div>
              )) : (
                <div className="text-gray-500 text-sm text-center py-4">Keine Festplatten gefunden</div>
              )}
            </div>
          </div>
        </div>

        {/* Network */}
        {network.interfaces && network.interfaces.length > 0 && (
          <div className={cardClass} data-testid="network-section">
            <div className="flex items-center gap-3 mb-4">
              <span className={`text-xl ${isLcars ? "text-orange-500" : "text-purple-400"}`}>&#127760;</span>
              <span className={`font-bold ${isLcars ? "text-xs tracking-widest text-orange-400" : "text-sm text-purple-300"}`}>NETZWERK</span>
            </div>
            <div className="flex gap-6 mb-3 text-sm">
              <span className="text-gray-400">Gesendet: <span className="font-bold text-gray-200">{formatBytes(network.bytes_sent)}</span></span>
              <span className="text-gray-400">Empfangen: <span className="font-bold text-gray-200">{formatBytes(network.bytes_recv)}</span></span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {network.interfaces.map((iface, i) => (
                <div key={i} className="bg-gray-900/40 rounded-lg p-3 flex items-center gap-3">
                  <Circle size={10} weight="fill" className={iface.is_up ? "text-green-500" : "text-red-500"} />
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm truncate">{iface.name}</div>
                    <div className="text-xs text-gray-500">{iface.ip || "N/A"}</div>
                  </div>
                  {iface.speed_mbps > 0 && <span className="text-xs text-gray-500">{iface.speed_mbps} Mbps</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Docker Containers */}
        <div className={cardClass} data-testid="docker-section">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <span className={`text-xl ${isLcars ? "text-orange-500" : "text-purple-400"}`}>&#128230;</span>
              <span className={`font-bold ${isLcars ? "text-xs tracking-widest text-orange-400" : "text-sm text-purple-300"}`}>DOCKER CONTAINER</span>
            </div>
            {docker?.available && (
              <div className="flex gap-3 text-xs">
                <span className="text-green-400">{docker.running || 0} laufend</span>
                <span className="text-red-400">{docker.stopped || 0} gestoppt</span>
              </div>
            )}
          </div>

          {docker?.available && docker?.containers?.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {docker.containers.map((c) => (
                <div key={c.id} data-testid={`container-${c.name}`}
                  className={`bg-gray-900/40 rounded-lg p-3 border transition-all ${
                    c.status === "running" ? "border-green-900/50 hover:border-green-700/50" : "border-red-900/50 hover:border-red-700/50"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Circle size={10} weight="fill" className={c.status === "running" ? "text-green-500" : "text-red-500"} />
                    <span className="font-bold text-sm truncate" title={c.name}>{c.name}</span>
                  </div>
                  <div className="text-xs text-gray-500 truncate mb-1" title={c.image}>{c.image}</div>
                  {c.uptime && <div className="text-xs text-gray-400">{c.uptime}</div>}
                  {c.ports && c.ports.length > 0 && (
                    <div className="mt-1 text-[10px] text-gray-500 truncate" title={c.ports.join(", ")}>{c.ports[0]}</div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <div className="text-4xl mb-3">&#128230;</div>
              <div className="text-gray-400 text-sm mb-1">Docker Socket nicht verfügbar</div>
              <div className="text-gray-600 text-xs">
                Auf Unraid wird der Docker-Status automatisch angezeigt wenn<br />
                <code className={`${isLcars ? "text-orange-400/70" : "text-purple-400/70"}`}>/var/run/docker.sock</code> gemountet ist.
              </div>
            </div>
          )}
        </div>

        {/* Services Health */}
        {services.length > 0 && (
          <div className={cardClass} data-testid="services-health-section">
            <div className="flex items-center gap-3 mb-4">
              <Circle size={22} className={isLcars ? "text-orange-500" : "text-purple-400"} />
              <span className={`font-bold ${isLcars ? "text-xs tracking-widest text-orange-400" : "text-sm text-purple-300"}`}>DIENSTE STATUS</span>
            </div>
            <div className="space-y-2">
              {services.map((s) => (
                <div key={s.id} data-testid={`service-health-${s.id}`} className="flex items-center gap-4 p-3 bg-gray-900/30 rounded-lg">
                  <Circle size={12} weight="fill"
                    className={s.status === "healthy" ? "text-green-500" : s.status === "offline" ? "text-red-500" : "text-yellow-500"} />
                  <div className="flex-1 font-bold text-sm">{s.name}</div>
                  <div className="text-xs text-gray-400">{s.response_time ? `${s.response_time}ms` : "-"}</div>
                  <div className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider ${
                    s.status === "healthy" ? "bg-green-900/50 text-green-400" :
                    s.status === "offline" ? "bg-red-900/50 text-red-400" :
                    "bg-yellow-900/50 text-yellow-400"
                  }`}>
                    {s.status === "healthy" ? "ONLINE" : s.status === "offline" ? "OFFLINE" : "UNBEKANNT"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
    </div>
  );
};

export default Health;

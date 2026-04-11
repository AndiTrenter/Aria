import { useState, useEffect } from "react";
import { useAuth, useTheme, API } from "@/App";
import axios from "axios";
import { ClockClockwise, ArrowClockwise, SignIn, ChatsCircle } from "@phosphor-icons/react";

const Logs = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/logs?limit=100`);
      setLogs(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const getIcon = (type) => {
    switch (type) {
      case 'user_login': return <SignIn size={16} className="text-green-500" />;
      case 'chat': return <ChatsCircle size={16} className="text-blue-500" />;
      default: return <ClockClockwise size={16} className="text-gray-500" />;
    }
  };

  const filteredLogs = filter ? logs.filter(l => l.type === filter) : logs;
  const isLcars = theme === "startrek";
  const cardClass = isLcars ? "lcars-card" : "disney-card";

  return (
    <div className="p-6" data-testid="logs-page">
      {/* Page Title + Controls */}
      <div className="flex items-center gap-4 mb-6">
        <h2 className={`${isLcars ? "text-lg tracking-widest text-[var(--lcars-orange)]" : "disney-title text-2xl font-bold"}`}>
          {isLcars ? "SYSTEM LOGS" : "Aktivitäts-Log"}
        </h2>
        <div className="flex-1" />
        <button onClick={fetchData} className={isLcars ? "lcars-button py-1 px-3 text-xs" : "disney-button py-1 px-3"} data-testid="logs-refresh">
          <ArrowClockwise size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Filter */}
      <div className="flex gap-2 mb-6">
        <button onClick={() => setFilter("")} className={`px-4 py-2 rounded-full text-sm ${!filter ? (isLcars ? "lcars-button" : "disney-button") : "bg-gray-700"}`} data-testid="filter-all">
          Alle
        </button>
        <button onClick={() => setFilter("user_login")} className={`px-4 py-2 rounded-full text-sm ${filter === "user_login" ? (isLcars ? "lcars-button" : "disney-button") : "bg-gray-700"}`} data-testid="filter-login">
          Logins
        </button>
        <button onClick={() => setFilter("chat")} className={`px-4 py-2 rounded-full text-sm ${filter === "chat" ? (isLcars ? "lcars-button" : "disney-button") : "bg-gray-700"}`} data-testid="filter-chat">
          Chat
        </button>
      </div>

      <div className={cardClass}>
        <div className="space-y-2 max-h-[600px] overflow-y-auto">
          {filteredLogs.map((log, i) => (
            <div key={i} className="flex items-center gap-3 p-3 bg-gray-900/30 rounded-lg text-sm" data-testid={`log-entry-${i}`}>
              {getIcon(log.type)}
              <div className="flex-1">
                <span className="font-bold">{log.type}</span>
                {log.email && <span className="ml-2 text-gray-400">{log.email}</span>}
                {log.message && <span className="ml-2 text-gray-400 truncate">{log.message}</span>}
              </div>
              <div className="text-xs text-gray-500">
                {new Date(log.timestamp).toLocaleString('de-DE')}
              </div>
            </div>
          ))}
          {filteredLogs.length === 0 && (
            <div className="text-center py-8 text-gray-500">Keine Logs gefunden</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Logs;

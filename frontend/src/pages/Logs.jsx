import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth, useTheme, API } from "@/App";
import axios from "axios";
import { ArrowLeft, ClockClockwise, ArrowClockwise, User, SignIn, ChatsCircle } from "@phosphor-icons/react";

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
  const cardClass = theme === "startrek" ? "lcars-card" : "disney-card";

  return (
    <div className="min-h-screen relative z-10">
      <header className={theme === "startrek" ? "lcars-header px-6 flex items-center" : "disney-header py-4 px-6"}>
        <div className="max-w-7xl mx-auto flex items-center gap-4 w-full">
          <Link to="/" className={theme === "startrek" ? "text-black" : "text-purple-200"}>
            <ArrowLeft size={24} />
          </Link>
          {theme === "startrek" ? (
            <span className="text-black font-bold text-xl tracking-widest">SYSTEM LOGS</span>
          ) : (
            <h1 className="disney-title text-2xl font-bold">📜 Aktivitäts-Log</h1>
          )}
          <div className="flex-1" />
          <button onClick={fetchData} className={theme === "startrek" ? "lcars-button" : "disney-button"}>
            <ArrowClockwise size={18} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Filter */}
        <div className="flex gap-2 mb-6">
          <button onClick={() => setFilter("")} className={`px-4 py-2 rounded-full text-sm ${!filter ? (theme === "startrek" ? "lcars-button" : "disney-button") : "bg-gray-700"}`}>
            Alle
          </button>
          <button onClick={() => setFilter("user_login")} className={`px-4 py-2 rounded-full text-sm ${filter === "user_login" ? (theme === "startrek" ? "lcars-button" : "disney-button") : "bg-gray-700"}`}>
            Logins
          </button>
          <button onClick={() => setFilter("chat")} className={`px-4 py-2 rounded-full text-sm ${filter === "chat" ? (theme === "startrek" ? "lcars-button" : "disney-button") : "bg-gray-700"}`}>
            Chat
          </button>
        </div>

        <div className={cardClass}>
          <div className="space-y-2 max-h-[600px] overflow-y-auto">
            {filteredLogs.map((log, i) => (
              <div key={i} className="flex items-center gap-3 p-3 bg-gray-900/30 rounded-lg text-sm">
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
      </main>
    </div>
  );
};

export default Logs;

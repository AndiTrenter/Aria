import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth, useTheme, API } from "@/App";
import axios from "axios";
import { ArrowLeft, Heart, Circle, ArrowClockwise } from "@phosphor-icons/react";

const Health = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [services, setServices] = useState([]);
  const [system, setSystem] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [servicesRes, systemRes] = await Promise.all([
        axios.get(`${API}/health/services`),
        axios.get(`${API}/health/system`)
      ]);
      setServices(servicesRes.data);
      setSystem(systemRes.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const cardClass = theme === "startrek" ? "lcars-card" : "disney-card";

  return (
    <div className="min-h-screen relative z-10">
      <header className={theme === "startrek" ? "lcars-header px-6 flex items-center" : "disney-header py-4 px-6"}>
        <div className="max-w-7xl mx-auto flex items-center gap-4 w-full">
          <Link to="/" className={theme === "startrek" ? "text-black" : "text-purple-200"}>
            <ArrowLeft size={24} />
          </Link>
          {theme === "startrek" ? (
            <span className="text-black font-bold text-xl tracking-widest">SYSTEM DIAGNOSTIK</span>
          ) : (
            <h1 className="disney-title text-2xl font-bold">💗 System-Gesundheit</h1>
          )}
          <div className="flex-1" />
          <button onClick={fetchData} className={theme === "startrek" ? "lcars-button" : "disney-button"}>
            <ArrowClockwise size={18} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* System Stats */}
        <div className="grid grid-cols-2 gap-6 mb-8">
          <div className={cardClass}>
            <div className={theme === "startrek" ? "text-xs text-orange-400 mb-2 tracking-widest" : "text-sm text-purple-300 mb-2"}>
              CPU AUSLASTUNG
            </div>
            <div className="text-4xl font-bold">{system.cpu_percent || 0}%</div>
            <div className="mt-2 h-3 bg-gray-700 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-green-500 to-orange-500" style={{width: `${system.cpu_percent || 0}%`}} />
            </div>
          </div>
          <div className={cardClass}>
            <div className={theme === "startrek" ? "text-xs text-orange-400 mb-2 tracking-widest" : "text-sm text-purple-300 mb-2"}>
              SPEICHER
            </div>
            <div className="text-4xl font-bold">{system.memory_percent || 0}%</div>
            <div className="text-sm text-gray-400">{system.memory_used_mb || 0} / {system.memory_total_mb || 0} MB</div>
            <div className="mt-2 h-3 bg-gray-700 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-blue-500 to-purple-500" style={{width: `${system.memory_percent || 0}%`}} />
            </div>
          </div>
        </div>

        {/* Services Health */}
        <div className={cardClass}>
          <h2 className={theme === "startrek" ? "text-lg tracking-widest mb-6" : "disney-title text-xl mb-6"}>
            {theme === "startrek" ? "DIENSTE STATUS" : "Dienste-Status"}
          </h2>
          <div className="space-y-3">
            {services.map((s) => (
              <div key={s.id} className="flex items-center gap-4 p-4 bg-gray-900/30 rounded-lg">
                <Circle 
                  size={16} 
                  weight="fill" 
                  className={s.status === 'healthy' ? 'text-green-500' : s.status === 'offline' ? 'text-red-500' : 'text-yellow-500'} 
                />
                <div className="flex-1 font-bold">{s.name}</div>
                <div className="text-sm text-gray-400">
                  {s.response_time ? `${s.response_time}ms` : '-'}
                </div>
                <div className={`px-3 py-1 rounded text-xs uppercase font-bold ${
                  s.status === 'healthy' ? 'bg-green-900/50 text-green-400' : 
                  s.status === 'offline' ? 'bg-red-900/50 text-red-400' : 
                  'bg-yellow-900/50 text-yellow-400'
                }`}>
                  {s.status}
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
};

export default Health;

import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth, useTheme, API } from "@/App";
import axios from "axios";
import { toast } from "sonner";
import { 
  HardDrives, Files, Code, Cloud, SignOut, Gear, User, 
  Heart, ClockClockwise, ChatsCircle, House, CaretDown,
  ArrowSquareOut, Circle, MagnifyingGlass
} from "@phosphor-icons/react";

const iconMap = {
  "hard-drives": HardDrives,
  "files": Files,
  "code": Code,
  "cloud": Cloud,
};

const Dashboard = () => {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const [services, setServices] = useState([]);
  const [stats, setStats] = useState({});
  const [healthData, setHealthData] = useState([]);
  const [chatMessage, setChatMessage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [servicesRes, statsRes, healthRes] = await Promise.all([
        axios.get(`${API}/services`),
        axios.get(`${API}/dashboard/stats`),
        axios.get(`${API}/health/services`).catch(() => ({ data: [] }))
      ]);
      setServices(servicesRes.data);
      setStats(statsRes.data);
      setHealthData(healthRes.data);
    } catch (e) {
      console.error("Failed to fetch data:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    toast.success("Abgemeldet");
  };

  const handleChat = async (e) => {
    e.preventDefault();
    if (!chatMessage.trim()) return;
    try {
      const { data } = await axios.post(`${API}/chat`, { message: chatMessage });
      toast.success(data.response);
      setChatMessage("");
    } catch (e) {
      toast.error("Chat-Fehler");
    }
  };

  const getServiceHealth = (serviceId) => {
    const health = healthData.find(h => h.id === serviceId);
    return health?.status || "unknown";
  };

  // LCARS Star Trek Theme
  if (theme === "startrek") {
    return (
      <div className="min-h-screen flex">
        {/* LCARS Sidebar */}
        <div className="lcars-sidebar flex-shrink-0">
          <div className="h-16 bg-gradient-to-b from-orange-500 to-orange-600 rounded-br-3xl mb-4" />
          
          <Link to="/" className="lcars-sidebar-item active">Dashboard</Link>
          <Link to="/health" className="lcars-sidebar-item">Health</Link>
          <Link to="/account" className="lcars-sidebar-item">Konto</Link>
          <Link to="/logs" className="lcars-sidebar-item">Logs</Link>
          {user?.role === "superadmin" || user?.role === "admin" ? (
            <Link to="/admin" className="lcars-sidebar-item">Admin</Link>
          ) : null}
          
          <div className="flex-1" />
          
          <div className="lcars-sidebar-item" onClick={() => setTheme("disney")}>Theme</div>
          <div className="lcars-sidebar-item text-red-900" onClick={handleLogout}>Logout</div>
          
          <div className="h-20 bg-gradient-to-t from-purple-500 to-purple-600 rounded-tr-3xl mt-4" />
        </div>

        {/* Main Content */}
        <div className="flex-1 p-6">
          {/* Header Bar */}
          <div className="lcars-header mb-6 flex items-center px-6">
            <div className="flex items-center gap-4">
              <HardDrives size={32} weight="bold" className="text-black" />
              <span className="text-black font-bold text-xl tracking-widest">ARIA DASHBOARD</span>
            </div>
            <div className="flex-1" />
            <div className="text-black font-bold text-sm">
              {new Date().toLocaleDateString('de-DE')} | STARDATE {Math.floor(Date.now() / 86400000)}
            </div>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="lcars-card">
              <div className="text-xs text-orange-400 mb-1">DIENSTE</div>
              <div className="text-3xl font-bold">{stats.services || 0}</div>
            </div>
            <div className="lcars-card">
              <div className="text-xs text-orange-400 mb-1">BENUTZER</div>
              <div className="text-3xl font-bold">{stats.users || 0}</div>
            </div>
            <div className="lcars-card">
              <div className="text-xs text-orange-400 mb-1">LOGS HEUTE</div>
              <div className="text-3xl font-bold">{stats.logs_today || 0}</div>
            </div>
          </div>

          {/* Services Grid */}
          <div className="mb-6">
            <div className="text-sm text-orange-400 mb-3 tracking-widest">AKTIVE DIENSTE</div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {services.map((service) => {
                const Icon = iconMap[service.icon] || HardDrives;
                const health = getServiceHealth(service.id);
                return (
                  <a
                    key={service.id}
                    href={service.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="lcars-card hover:border-yellow-500 transition-all cursor-pointer group"
                    data-testid={`service-${service.id}`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <Icon size={28} weight="duotone" className="text-orange-500" />
                        <div>
                          <div className="font-bold tracking-wide">{service.name}</div>
                          <div className="text-xs text-gray-400">{service.category}</div>
                        </div>
                      </div>
                      <div className={`flex items-center gap-1 text-xs ${health === 'healthy' ? 'status-online' : health === 'offline' ? 'status-offline' : 'text-yellow-500'}`}>
                        <Circle size={8} weight="fill" />
                        {health === 'healthy' ? 'ONLINE' : health === 'offline' ? 'OFFLINE' : 'UNKNOWN'}
                      </div>
                    </div>
                    <div className="text-xs text-gray-500 mt-2">{service.description}</div>
                    <div className="flex items-center gap-1 text-xs text-orange-400 mt-3 group-hover:text-yellow-400">
                      <ArrowSquareOut size={14} />
                      <span>ZUGRIFF</span>
                    </div>
                  </a>
                );
              })}
            </div>
          </div>

          {/* Chat Input */}
          <div className="lcars-card">
            <div className="text-sm text-orange-400 mb-3 tracking-widest">COMPUTER EINGABE</div>
            <form onSubmit={handleChat} className="flex gap-3">
              <input
                type="text"
                value={chatMessage}
                onChange={(e) => setChatMessage(e.target.value)}
                placeholder="Befehl eingeben..."
                className="lcars-input flex-1"
                data-testid="chat-input"
              />
              <button type="submit" className="lcars-button">SENDEN</button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // Disney Magical Theme
  return (
    <div className="min-h-screen relative z-10">
      {/* Header */}
      <header className="disney-header py-4 px-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-3xl">🏰</div>
            <h1 className="disney-title text-2xl font-bold">Aria</h1>
          </div>
          
          <nav className="flex items-center gap-6">
            <Link to="/" className="text-purple-200 hover:text-white transition-colors flex items-center gap-2">
              <House size={18} /> Dashboard
            </Link>
            <Link to="/health" className="text-purple-200 hover:text-white transition-colors flex items-center gap-2">
              <Heart size={18} /> Health
            </Link>
            <Link to="/account" className="text-purple-200 hover:text-white transition-colors flex items-center gap-2">
              <User size={18} /> Konto
            </Link>
            <Link to="/logs" className="text-purple-200 hover:text-white transition-colors flex items-center gap-2">
              <ClockClockwise size={18} /> Logs
            </Link>
            {(user?.role === "superadmin" || user?.role === "admin") && (
              <Link to="/admin" className="text-purple-200 hover:text-white transition-colors flex items-center gap-2">
                <Gear size={18} /> Admin
              </Link>
            )}
          </nav>

          <div className="flex items-center gap-4">
            <button 
              onClick={() => setTheme("startrek")}
              className="text-sm text-purple-300 hover:text-white"
            >
              🚀 Theme
            </button>
            <button 
              onClick={handleLogout}
              className="disney-button text-sm"
              data-testid="logout-button"
            >
              <SignOut size={16} className="inline mr-1" /> Logout
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Welcome */}
        <div className="text-center mb-10">
          <h2 className="disney-title text-4xl font-bold mb-2 disney-glow">
            Willkommen, {user?.name}! ✨
          </h2>
          <p className="text-purple-300">Dein magisches Dashboard wartet auf dich</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-6 mb-10">
          <div className="disney-card text-center">
            <div className="text-4xl mb-2">🌟</div>
            <div className="text-3xl font-bold disney-glow">{stats.services || 0}</div>
            <div className="text-purple-300 text-sm">Dienste</div>
          </div>
          <div className="disney-card text-center">
            <div className="text-4xl mb-2">👑</div>
            <div className="text-3xl font-bold disney-glow">{stats.users || 0}</div>
            <div className="text-purple-300 text-sm">Benutzer</div>
          </div>
          <div className="disney-card text-center">
            <div className="text-4xl mb-2">📜</div>
            <div className="text-3xl font-bold disney-glow">{stats.logs_today || 0}</div>
            <div className="text-purple-300 text-sm">Logs heute</div>
          </div>
        </div>

        {/* Services */}
        <h3 className="disney-title text-xl font-bold mb-4">Deine Dienste</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
          {services.map((service) => {
            const Icon = iconMap[service.icon] || HardDrives;
            const health = getServiceHealth(service.id);
            return (
              <a
                key={service.id}
                href={service.url}
                target="_blank"
                rel="noopener noreferrer"
                className="disney-card group cursor-pointer"
                data-testid={`service-${service.id}`}
              >
                <div className="flex items-center gap-4 mb-3">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                    <Icon size={24} weight="fill" className="text-white" />
                  </div>
                  <div>
                    <h4 className="font-bold text-white">{service.name}</h4>
                    <span className="text-xs text-purple-300">{service.category}</span>
                  </div>
                  <div className="ml-auto">
                    <Circle 
                      size={10} 
                      weight="fill" 
                      className={health === 'healthy' ? 'text-green-400' : health === 'offline' ? 'text-red-400' : 'text-yellow-400'} 
                    />
                  </div>
                </div>
                <p className="text-sm text-purple-200 mb-3">{service.description}</p>
                <div className="flex items-center gap-2 text-sm text-pink-400 group-hover:text-pink-300">
                  <ArrowSquareOut size={14} />
                  <span>Öffnen</span>
                </div>
              </a>
            );
          })}
        </div>

        {/* Chat */}
        <div className="disney-card">
          <h3 className="disney-title text-lg font-bold mb-4">💬 Frag Aria</h3>
          <form onSubmit={handleChat} className="flex gap-3">
            <input
              type="text"
              value={chatMessage}
              onChange={(e) => setChatMessage(e.target.value)}
              placeholder="Was kann ich für dich tun?"
              className="disney-input flex-1"
              data-testid="chat-input"
            />
            <button type="submit" className="disney-button">Senden ✨</button>
          </form>
        </div>
      </main>
    </div>
  );
};

export default Dashboard;

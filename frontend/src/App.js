import { useEffect, useState, createContext, useContext, useCallback } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import axios from "axios";
import { Toaster } from "@/components/ui/sonner";

import SetupWizard from "@/pages/SetupWizard";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Admin from "@/pages/Admin";
import Health from "@/pages/Health";
import Logs from "@/pages/Logs";
import Account from "@/pages/Account";
import Chat from "@/pages/Chat";
import Weather from "@/pages/Weather";
import SmartHome from "@/pages/SmartHome";
import Automations from "@/pages/Automations";
import KioskMode from "@/pages/KioskMode";
import Mediathek from "@/pages/Mediathek";
import VoiceAssistant from "@/components/VoiceAssistant";
import LcarsLayout from "@/components/LcarsLayout";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || '';
export const API = `${BACKEND_URL}/api`;

axios.defaults.withCredentials = true;

// Add request interceptor to include token from localStorage
axios.interceptors.request.use((config) => {
  const token = localStorage.getItem('aria_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const AuthContext = createContext(null);
export const ThemeContext = createContext(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
};

export const formatApiError = (detail) => {
  if (detail == null) return "Etwas ist schiefgelaufen.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((e) => e?.msg || JSON.stringify(e)).join(" ");
  return String(detail);
};

const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [setupRequired, setSetupRequired] = useState(null);
  const [theme, setThemeState] = useState("startrek");

  const checkSetupStatus = async () => {
    try {
      const { data } = await axios.get(`${API}/setup/status`);
      setSetupRequired(!data.setup_completed);
      return !data.setup_completed;
    } catch (e) {
      console.error("Setup status check failed:", e);
      return false;
    }
  };

  const checkAuth = async () => {
    try {
      const { data } = await axios.get(`${API}/auth/me`);
      setUser(data);
      setThemeState(data.theme || "startrek");
      localStorage.setItem('aria_user', JSON.stringify(data));
      return data;
    } catch (e) {
      // Try localStorage backup
      const stored = localStorage.getItem('aria_user');
      if (stored) {
        try {
          const userData = JSON.parse(stored);
          setUser(userData);
          setThemeState(userData.theme || "startrek");
          return userData;
        } catch {}
      }
      setUser(null);
      localStorage.removeItem('aria_user');
      return null;
    }
  };

  const login = async (email, password) => {
    const { data } = await axios.post(`${API}/auth/login`, { email, password });
    // Store token FIRST before setting user state
    if (data.access_token) {
      localStorage.setItem('aria_token', data.access_token);
    }
    localStorage.setItem('aria_user', JSON.stringify(data));
    // Now set user state (this triggers Dashboard re-render)
    setUser(data);
    setThemeState(data.theme || "startrek");
    return data;
  };

  const logout = async () => {
    try { await axios.post(`${API}/auth/logout`); } catch (e) {}
    setUser(null);
    localStorage.removeItem('aria_user');
    localStorage.removeItem('aria_token');
  };

  const completeSetup = async (email, password, name) => {
    const { data } = await axios.post(`${API}/setup/complete`, { email, password, name });
    setUser(data);
    setSetupRequired(false);
    return data;
  };

  const setTheme = async (newTheme) => {
    setThemeState(newTheme);
    try {
      await axios.put(`${API}/auth/theme`, { theme: newTheme });
      // Update localStorage
      const stored = localStorage.getItem('aria_user');
      if (stored) {
        const userData = JSON.parse(stored);
        userData.theme = newTheme;
        localStorage.setItem('aria_user', JSON.stringify(userData));
      }
    } catch (e) {
      console.error("Failed to update theme:", e);
    }
  };

  useEffect(() => {
    const init = async () => {
      const needsSetup = await checkSetupStatus();
      if (!needsSetup) await checkAuth();
      setLoading(false);
    };
    init();
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, setupRequired, login, logout, completeSetup, checkAuth }}>
      <ThemeContext.Provider value={{ theme, setTheme }}>
        {children}
      </ThemeContext.Provider>
    </AuthContext.Provider>
  );
};

const ProtectedRoute = ({ children }) => {
  const { user, loading, setupRequired } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-pulse">Loading...</div></div>;
  if (setupRequired) return <Navigate to="/setup" replace />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
};

const AppRouter = () => {
  const { user, loading, setupRequired } = useAuth();
  const { theme } = useTheme();

  // Disney fairy dust click effect + floating stars
  useEffect(() => {
    if (theme !== "disney") return;
    
    // Fairy dust on click
    const colors = ["#ffd700", "#ff6b9d", "#5dade2", "#9b59b6", "#fff", "#ffcc00"];
    const handleClick = (e) => {
      for (let i = 0; i < 8; i++) {
        const particle = document.createElement("div");
        particle.className = "fairy-dust-particle";
        const angle = (Math.PI * 2 / 8) * i + Math.random() * 0.5;
        const dist = 30 + Math.random() * 40;
        particle.style.left = e.clientX + "px";
        particle.style.top = e.clientY + "px";
        particle.style.background = colors[Math.floor(Math.random() * colors.length)];
        particle.style.boxShadow = `0 0 6px ${particle.style.background}`;
        particle.style.setProperty("--dx", Math.cos(angle) * dist + "px");
        particle.style.setProperty("--dy", Math.sin(angle) * dist - 20 + "px");
        document.body.appendChild(particle);
        setTimeout(() => particle.remove(), 800);
      }
    };
    document.addEventListener("click", handleClick);

    // Floating stars
    const starInterval = setInterval(() => {
      const star = document.createElement("div");
      star.className = "disney-floating-star";
      star.style.left = Math.random() * 100 + "vw";
      star.style.width = (1 + Math.random() * 2) + "px";
      star.style.height = star.style.width;
      star.style.animationDuration = (8 + Math.random() * 12) + "s";
      star.style.opacity = String(0.3 + Math.random() * 0.5);
      document.body.appendChild(star);
      setTimeout(() => star.remove(), 20000);
    }, 2000);

    return () => {
      document.removeEventListener("click", handleClick);
      clearInterval(starInterval);
    };
  }, [theme]);

  if (loading) return <div className={`min-h-screen flex items-center justify-center ${theme === 'startrek' ? 'bg-black text-orange-500' : 'bg-indigo-950 text-purple-200'}`}><div className="animate-pulse text-2xl">ARIA wird geladen...</div></div>;

  return (
    <div className={theme === 'startrek' ? 'theme-startrek' : 'theme-disney'}>
      <Routes>
        <Route path="/setup" element={setupRequired ? <SetupWizard /> : <Navigate to="/" replace />} />
        <Route path="/login" element={setupRequired ? <Navigate to="/setup" replace /> : user ? <Navigate to="/" replace /> : <Login />} />
        <Route path="/" element={<ProtectedRoute><LcarsLayout><Dashboard /></LcarsLayout></ProtectedRoute>} />
        <Route path="/health" element={<ProtectedRoute><LcarsLayout><Health /></LcarsLayout></ProtectedRoute>} />
        <Route path="/chat" element={<ProtectedRoute><LcarsLayout><Chat /></LcarsLayout></ProtectedRoute>} />
        <Route path="/weather" element={<ProtectedRoute><LcarsLayout><Weather /></LcarsLayout></ProtectedRoute>} />
        <Route path="/logs" element={<ProtectedRoute><LcarsLayout><Logs /></LcarsLayout></ProtectedRoute>} />
        <Route path="/account" element={<ProtectedRoute><LcarsLayout><Account /></LcarsLayout></ProtectedRoute>} />
        <Route path="/smarthome" element={<ProtectedRoute><LcarsLayout><SmartHome /></LcarsLayout></ProtectedRoute>} />
        <Route path="/automations" element={<ProtectedRoute><LcarsLayout><Automations /></LcarsLayout></ProtectedRoute>} />
        <Route path="/mediathek" element={<ProtectedRoute><LcarsLayout><Mediathek /></LcarsLayout></ProtectedRoute>} />
        <Route path="/kiosk" element={<ProtectedRoute><KioskMode /></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute><LcarsLayout><Admin /></LcarsLayout></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {user && <VoiceAssistant />}
    </div>
  );
};

function App() {
  return (
    <div className="App min-h-screen">
      <BrowserRouter>
        <AuthProvider>
          <AppRouter />
          <Toaster position="top-right" toastOptions={{
            style: { background: '#1a1a2e', color: '#e0e0e0', border: '1px solid #333' },
            className: 'aria-toast',
          }} />
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;

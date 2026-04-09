import { useEffect, useState, createContext, useContext } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import axios from "axios";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";

// Pages
import SetupWizard from "@/pages/SetupWizard";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Admin from "@/pages/Admin";

// Use relative URL if REACT_APP_BACKEND_URL is empty (for Docker deployment)
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || '';
export const API = `${BACKEND_URL}/api`;

// Configure axios defaults
axios.defaults.withCredentials = true;

// Auth Context
export const AuthContext = createContext(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
};

// Helper to format API errors
export const formatApiError = (detail) => {
  if (detail == null) return "Something went wrong. Please try again.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail.map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e))).filter(Boolean).join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
};

// Auth Provider
const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [setupRequired, setSetupRequired] = useState(null);

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
      return data;
    } catch (e) {
      setUser(null);
      return null;
    }
  };

  const login = async (email, password) => {
    const { data } = await axios.post(`${API}/auth/login`, { email, password });
    setUser(data);
    return data;
  };

  const logout = async () => {
    try {
      await axios.post(`${API}/auth/logout`);
    } catch (e) {
      // Ignore logout errors
    }
    setUser(null);
  };

  const completeSetup = async (email, password, name) => {
    const { data } = await axios.post(`${API}/setup/complete`, { email, password, name });
    setUser(data);
    setSetupRequired(false);
    return data;
  };

  useEffect(() => {
    const init = async () => {
      const needsSetup = await checkSetupStatus();
      if (!needsSetup) {
        await checkAuth();
      }
      setLoading(false);
    };
    init();
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, setupRequired, login, logout, completeSetup, checkAuth }}>
      {children}
    </AuthContext.Provider>
  );
};

// Protected Route
const ProtectedRoute = ({ children }) => {
  const { user, loading, setupRequired } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="animate-pulse text-zinc-400">Loading...</div>
      </div>
    );
  }

  if (setupRequired) {
    return <Navigate to="/setup" replace />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

// App Router
const AppRouter = () => {
  const { user, loading, setupRequired } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="animate-pulse text-zinc-400">Loading Aria...</div>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/setup"
        element={setupRequired ? <SetupWizard /> : <Navigate to="/" replace />}
      />
      <Route
        path="/login"
        element={
          setupRequired ? (
            <Navigate to="/setup" replace />
          ) : user ? (
            <Navigate to="/" replace />
          ) : (
            <Login />
          )
        }
      />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <Admin />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

function App() {
  return (
    <div className="App min-h-screen bg-zinc-950">
      <BrowserRouter>
        <AuthProvider>
          <AppRouter />
          <Toaster position="top-right" theme="dark" />
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;

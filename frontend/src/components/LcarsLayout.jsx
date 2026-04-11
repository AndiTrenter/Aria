import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth, useTheme } from "@/App";
import { SignOut } from "@phosphor-icons/react";

const LcarsLayout = ({ children }) => {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const location = useLocation();
  const [clock, setClock] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const navItems = [
    { path: "/", shortLabel: "DASH" },
    { path: "/health", shortLabel: "HEALTH" },
    { path: "/chat", shortLabel: "CHAT" },
    { path: "/weather", shortLabel: "WETTER" },
    { path: "/account", shortLabel: "KONTO" },
    { path: "/logs", shortLabel: "LOGS" },
  ];
  if (user?.role === "admin" || user?.role === "superadmin") {
    navItems.push({ path: "/admin", shortLabel: "ADMIN" });
  }

  const isLcars = theme === "startrek";

  if (!isLcars) {
    // Disney layout: top nav bar
    return (
      <div className="min-h-screen relative z-10">
        <header className="disney-header py-3 px-6 sticky top-0 z-50">
          <div className="max-w-7xl mx-auto flex items-center gap-3">
            <Link to="/" className="disney-title text-xl font-bold">Aria</Link>
            <span className="text-purple-400 text-xs">{clock.toLocaleDateString("de-DE")} {clock.toLocaleTimeString("de-DE")}</span>
            <div className="flex-1" />
            <nav className="flex gap-1 flex-wrap">
              {navItems.map((item) => (
                <Link key={item.path} to={item.path}
                  className={`text-xs px-3 py-1.5 rounded-full transition-all ${location.pathname === item.path ? "bg-purple-600 text-white" : "text-purple-300 hover:bg-purple-800/50"}`}
                  data-testid={`nav-${item.shortLabel.toLowerCase()}`}
                >
                  {item.shortLabel}
                </Link>
              ))}
              <button onClick={() => setTheme("startrek")} className="text-xs px-3 py-1.5 text-purple-300 hover:bg-purple-800/50 rounded-full" data-testid="nav-theme">Theme</button>
              <button onClick={logout} className="text-xs px-3 py-1.5 text-red-300 hover:bg-red-900/50 rounded-full" data-testid="logout-button">
                <SignOut size={14} />
              </button>
            </nav>
          </div>
        </header>
        <main>{children}</main>
      </div>
    );
  }

  // LCARS layout: header + sidebar + content
  const stardate = `${clock.toLocaleDateString("de-DE")} ${clock.toLocaleTimeString("de-DE")} | STARDATE ${Math.floor(Date.now() / 86400000)}`;

  return (
    <div className="min-h-screen flex flex-col">
      {/* LCARS Header - sticky */}
      <div className="lcars-header sticky top-0 z-50">
        <Link to="/" className="lcars-header-cap" data-testid="lcars-header-cap">ARIA</Link>
        <div className="lcars-header-bar">
          <span className="text-xs text-gray-500 ml-3 tracking-wider whitespace-nowrap">{stardate}</span>
        </div>
        <div className="lcars-header-end">
          <button onClick={logout} className="text-black text-xs font-bold tracking-wider" data-testid="logout-button">
            ABMELDEN
          </button>
        </div>
      </div>

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
            onClick={(e) => { e.preventDefault(); setTheme("disney"); }}
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
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </div>
    </div>
  );
};

export default LcarsLayout;

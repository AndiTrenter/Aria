import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth, useTheme } from "@/App";
import { SignOut, Palette, CaretDown } from "@phosphor-icons/react";

const LcarsLayout = ({ children }) => {
  const { user, logout } = useAuth();
  const { theme, setTheme, availableThemes } = useTheme();
  const location = useLocation();
  const [clock, setClock] = useState(new Date());
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const themeMenuRef = useRef(null);

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Close theme menu when clicking outside
  useEffect(() => {
    if (!themeMenuOpen) return;
    const handler = (e) => {
      if (themeMenuRef.current && !themeMenuRef.current.contains(e.target)) {
        setThemeMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [themeMenuOpen]);

  const isAdmin = user?.role === "admin" || user?.role === "superadmin";
  const visibleTabs = user?.visible_tabs || ["dash", "home", "chat", "weather", "account"];

  const TAB_MAP = {
    dash: { path: "/", shortLabel: "DASH" },
    home: { path: "/smarthome", shortLabel: "SMARTHOME" },
    health: { path: "/health", shortLabel: "HEALTH" },
    chat: { path: "/chat", shortLabel: "CHAT" },
    weather: { path: "/weather", shortLabel: "WETTER" },
    media: { path: "/mediathek", shortLabel: "MEDIA" },
    account: { path: "/account", shortLabel: "KONTO" },
    logs: { path: "/logs", shortLabel: "LOGS" },
  };

  const navItems = [];
  for (const tabId of ["dash", "home", "health", "chat", "weather", "media", "account", "logs"]) {
    if (isAdmin || visibleTabs.includes(tabId)) {
      navItems.push(TAB_MAP[tabId]);
    }
  }
  if (isAdmin) {
    navItems.push({ path: "/admin", shortLabel: "ADMIN" });
  }

  const isLcars = theme === "startrek";
  const isMinesweeper = theme === "minesweeper";

  // Shared theme menu content (used by both layouts)
  const handleThemePick = (id) => {
    setTheme(id);
    setThemeMenuOpen(false);
  };
  const ThemeMenu = ({ positionClass }) => (
    <div className={`theme-submenu ${positionClass}`} data-testid="theme-submenu" ref={themeMenuRef}>
      {availableThemes.map(t => (
        <div key={t.id}
          className={`theme-submenu-item ${theme === t.id ? "active" : ""}`}
          onClick={() => handleThemePick(t.id)}
          data-testid={`theme-option-${t.id}`}>
          <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: t.accent, boxShadow: `0 0 6px ${t.accent}` }} />
          <span>{t.label}</span>
        </div>
      ))}
    </div>
  );

  // ============ TOP-NAV LAYOUT (Disney / Fortnite / Minesweeper) ============
  if (!isLcars) {
    const btnBase = isMinesweeper
      ? "text-xs px-3 py-0.5 rounded-none border border-transparent"
      : "text-xs px-3 py-1.5 rounded-full";
    const activeBtn = isMinesweeper
      ? "bg-[var(--ms-title-bar,#000080)] text-white"
      : theme === "fortnite"
        ? "bg-cyan-500/30 text-cyan-100"
        : "bg-purple-600 text-white";
    const hoverBtn = isMinesweeper
      ? "hover:bg-gray-300"
      : theme === "fortnite"
        ? "hover:bg-cyan-900/40 text-cyan-200"
        : "text-purple-300 hover:bg-purple-800/50";

    return (
      <div className="min-h-screen relative z-10">
        <header className="disney-header py-3 px-6 sticky top-0 z-50">
          <div className="max-w-7xl mx-auto flex items-center gap-3">
            <Link to="/" className="disney-title text-xl font-bold">Aria</Link>
            <span className="text-xs opacity-70">{clock.toLocaleDateString("de-DE")} {clock.toLocaleTimeString("de-DE")}</span>
            <div className="flex-1" />
            <nav className="flex gap-1 flex-wrap items-center">
              {navItems.map((item) => (
                <Link key={item.path} to={item.path}
                  className={`${btnBase} transition-all ${location.pathname === item.path ? activeBtn : hoverBtn}`}
                  data-testid={`nav-${item.shortLabel.toLowerCase()}`}>
                  {item.shortLabel}
                </Link>
              ))}
              {/* Theme dropdown */}
              <div className="relative" ref={themeMenuRef}>
                <button
                  onClick={() => setThemeMenuOpen(v => !v)}
                  className={`${btnBase} ${hoverBtn} flex items-center gap-1`}
                  data-testid="nav-theme">
                  <Palette size={12} />
                  Theme
                  <CaretDown size={10} />
                </button>
                {themeMenuOpen && <ThemeMenu positionClass="right-0 top-full mt-1" />}
              </div>
              <button onClick={logout} className={`${btnBase} ${isMinesweeper ? "hover:bg-red-200" : "text-red-300 hover:bg-red-900/50"}`} data-testid="logout-button">
                <SignOut size={14} />
              </button>
            </nav>
          </div>
        </header>
        <main>{children}</main>
      </div>
    );
  }

  // ============ LCARS LAYOUT (Star Trek) ============
  const stardate = `${clock.toLocaleDateString("de-DE")} ${clock.toLocaleTimeString("de-DE")} | STARDATE ${Math.floor(Date.now() / 86400000)}`;

  return (
    <div className="min-h-screen flex flex-col">
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
        <div className="lcars-sidebar sticky top-[50px] h-[calc(100vh-50px)] overflow-auto" data-testid="lcars-sidebar">
          {navItems.map((item) => (
            <Link key={item.path} to={item.path}
              className={`lcars-sidebar-item ${location.pathname === item.path ? "active" : ""}`}
              data-testid={`nav-${item.shortLabel.toLowerCase()}`}>
              {item.shortLabel}
            </Link>
          ))}
          {/* Theme submenu trigger */}
          <div className="relative" ref={themeMenuRef}>
            <button
              onClick={() => setThemeMenuOpen(v => !v)}
              className="lcars-sidebar-item w-full flex items-center justify-between gap-2"
              style={{ background: "var(--lcars-tan)" }}
              data-testid="nav-theme">
              <span>THEME</span>
              <CaretDown size={12} />
            </button>
            {themeMenuOpen && <ThemeMenu positionClass="left-full top-0 ml-1" />}
          </div>
          <div className="lcars-sidebar-spacer" />
          <div className="lcars-sidebar-bottom" />
        </div>

        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </div>
    </div>
  );
};

export default LcarsLayout;

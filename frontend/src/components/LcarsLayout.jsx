import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router-dom";
import { useAuth, useTheme } from "@/App";
import { SignOut, Palette, CaretDown, SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react";
import { isThemeSoundMuted, setThemeSoundMuted, playThemeSound } from "@/utils/themeSounds";

const LcarsLayout = ({ children }) => {
  const { user, logout } = useAuth();
  const { theme, setTheme, availableThemes } = useTheme();
  const location = useLocation();
  const [clock, setClock] = useState(new Date());
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 200 });
  const [soundMuted, setSoundMuted] = useState(isThemeSoundMuted());
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Close theme menu when clicking outside (excluding trigger + menu)
  useEffect(() => {
    if (!themeMenuOpen) return;
    const handler = (e) => {
      if (triggerRef.current && triggerRef.current.contains(e.target)) return;
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      setThemeMenuOpen(false);
    };
    const resize = () => setThemeMenuOpen(false);
    document.addEventListener("mousedown", handler);
    window.addEventListener("resize", resize);
    window.addEventListener("scroll", resize, true);
    return () => {
      document.removeEventListener("mousedown", handler);
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", resize, true);
    };
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

  const openThemeMenu = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const menuWidth = 210;
    const menuHeight = 4 * 38 + 12; // 4 items + padding
    let top, left;
    if (isLcars) {
      // Open to the right of the sidebar button
      top = rect.top;
      left = rect.right + 4;
      // Keep inside viewport vertically
      if (top + menuHeight > window.innerHeight) top = window.innerHeight - menuHeight - 8;
    } else {
      // Open below the top-nav button, right-aligned
      top = rect.bottom + 4;
      left = rect.right - menuWidth;
    }
    // Clamp to viewport
    if (left < 8) left = 8;
    if (left + menuWidth > window.innerWidth - 8) left = window.innerWidth - menuWidth - 8;
    if (top < 8) top = 8;
    setMenuPos({ top, left, width: menuWidth });
    setThemeMenuOpen(true);
  };

  const handleThemePick = (id) => {
    setTheme(id);
    setThemeMenuOpen(false);
  };

  const ThemeMenuPortal = () => {
    if (!themeMenuOpen) return null;
    const themeClass = `theme-${theme}`;
    const toggleMute = (e) => {
      e.stopPropagation();
      const next = !soundMuted;
      setSoundMuted(next);
      setThemeSoundMuted(next);
      // If unmuting, play a preview so user can confirm
      if (!next) setTimeout(() => playThemeSound(theme), 50);
    };
    return createPortal(
      <div className={themeClass}>
        <div
          ref={menuRef}
          className="theme-submenu"
          data-testid="theme-submenu"
          style={{
            position: "fixed",
            top: `${menuPos.top}px`,
            left: `${menuPos.left}px`,
            width: `${menuPos.width}px`,
            zIndex: 9999,
          }}
        >
          {availableThemes.map(t => (
            <div key={t.id}
              className={`theme-submenu-item ${theme === t.id ? "active" : ""}`}
              onClick={() => handleThemePick(t.id)}
              onMouseEnter={() => { if (!soundMuted && theme !== t.id) playThemeSound(t.id); }}
              style={{ "--preview-accent": t.accent }}
              data-testid={`theme-option-${t.id}`}>
              <span className="theme-accent-dot w-3 h-3 rounded-full flex-shrink-0" style={{ background: t.accent, boxShadow: `0 0 6px ${t.accent}` }} />
              <span>{t.label}</span>
            </div>
          ))}
          <div
            onClick={toggleMute}
            className="theme-submenu-item"
            style={{ borderTop: "1px solid rgba(128,128,128,0.25)", marginTop: 4, paddingTop: 10, opacity: 0.85, fontSize: 11 }}
            data-testid="theme-sound-toggle"
            title={soundMuted ? "Sounds aktivieren" : "Sounds stumm schalten"}>
            {soundMuted ? <SpeakerSlash size={14} /> : <SpeakerHigh size={14} />}
            <span>{soundMuted ? "Sounds aus" : "Sounds an"}</span>
          </div>
        </div>
      </div>,
      document.body
    );
  };

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
              <button
                ref={triggerRef}
                onClick={() => themeMenuOpen ? setThemeMenuOpen(false) : openThemeMenu()}
                className={`${btnBase} ${hoverBtn} flex items-center gap-1`}
                data-testid="nav-theme">
                <Palette size={12} />
                Theme
                <CaretDown size={10} />
              </button>
              <button onClick={logout} className={`${btnBase} ${isMinesweeper ? "hover:bg-red-200" : "text-red-300 hover:bg-red-900/50"}`} data-testid="logout-button">
                <SignOut size={14} />
              </button>
            </nav>
          </div>
        </header>
        <main>{children}</main>
        <ThemeMenuPortal />
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
          <button
            ref={triggerRef}
            onClick={() => themeMenuOpen ? setThemeMenuOpen(false) : openThemeMenu()}
            className="lcars-sidebar-item w-full flex items-center justify-between gap-2"
            style={{ background: "var(--lcars-tan)" }}
            data-testid="nav-theme">
            <span>THEME</span>
            <CaretDown size={12} />
          </button>
          <div className="lcars-sidebar-spacer" />
          <div className="lcars-sidebar-bottom" />
        </div>

        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </div>

      <ThemeMenuPortal />
    </div>
  );
};

export default LcarsLayout;

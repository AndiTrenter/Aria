import axios from "axios";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router-dom";
import { useAuth, useTheme, API } from "@/App";
import { SignOut, Palette, CaretDown, SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react";
import { isThemeSoundMuted, setThemeSoundMuted, playThemeSound, playThemeClick } from "@/utils/themeSounds";

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

  // CookPilot submenu state
  const [cpMenuOpen, setCpMenuOpen] = useState(false);
  const [cpMenuPos, setCpMenuPos] = useState({ top: 0, left: 0, width: 200 });
  const [cpStatus, setCpStatus] = useState(null); // {configured, available, perms, is_admin}
  const cpTriggerRef = useRef(null);
  const cpMenuRef = useRef(null);

  // Fetch CookPilot status (perms + availability) once on mount + when user changes
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    axios.get(`${API}/cookpilot/status`)
      .then(r => { if (!cancelled) setCpStatus(r.data); })
      .catch(() => { if (!cancelled) setCpStatus(null); });
    return () => { cancelled = true; };
  }, [user]);

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

  // Close CookPilot menu on outside click
  useEffect(() => {
    if (!cpMenuOpen) return;
    const handler = (e) => {
      if (cpTriggerRef.current && cpTriggerRef.current.contains(e.target)) return;
      if (cpMenuRef.current && cpMenuRef.current.contains(e.target)) return;
      setCpMenuOpen(false);
    };
    const resize = () => setCpMenuOpen(false);
    document.addEventListener("mousedown", handler);
    window.addEventListener("resize", resize);
    window.addEventListener("scroll", resize, true);
    return () => {
      document.removeEventListener("mousedown", handler);
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", resize, true);
    };
  }, [cpMenuOpen]);

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

  // Click-sound helper — plays the light click variant of current theme
  const onNavClick = () => playThemeClick(theme);

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

  // CookPilot submenu — only show items the user has rights to
  const cpVisible = !!cpStatus && (cpStatus.is_admin || cpStatus.perms?.visible);
  const cpItems = (() => {
    if (!cpVisible) return [];
    const p = cpStatus?.perms || {};
    const isCpAdmin = cpStatus?.is_admin;
    const items = [];
    if (isCpAdmin || p.recipes_view) items.push({ path: "/cookpilot/recipes", label: "REZEPTE", labelN: "Rezepte" });
    if (isCpAdmin || p.meal_plan_view) items.push({ path: "/cookpilot/meal-plan", label: "WOCHENPLAN", labelN: "Wochenplan" });
    if (isCpAdmin || p.shopping_view) items.push({ path: "/cookpilot/shopping", label: "EINKAUFSLISTE", labelN: "Einkaufsliste" });
    if (isCpAdmin || p.pantry_view) items.push({ path: "/cookpilot/pantry", label: "VORRAT", labelN: "Vorrat" });
    if (isCpAdmin || p.chat) items.push({ path: "/cookpilot/chat", label: "KOCH-CHAT", labelN: "Koch-Chat" });
    if (isCpAdmin || p.tablet) items.push({ path: "/cookpilot/tablet", label: "KÜCHEN-TABLET", labelN: "Küchen-Tablet" });
    return items;
  })();

  const openCpMenu = () => {
    if (!cpTriggerRef.current) return;
    const rect = cpTriggerRef.current.getBoundingClientRect();
    const menuWidth = 220;
    const menuHeight = cpItems.length * 38 + 12;
    let top, left;
    if (isLcars) {
      top = rect.top;
      left = rect.right + 4;
      if (top + menuHeight > window.innerHeight) top = window.innerHeight - menuHeight - 8;
    } else {
      top = rect.bottom + 4;
      left = rect.right - menuWidth;
    }
    if (left < 8) left = 8;
    if (left + menuWidth > window.innerWidth - 8) left = window.innerWidth - menuWidth - 8;
    if (top < 8) top = 8;
    setCpMenuPos({ top, left, width: menuWidth });
    setCpMenuOpen(true);
  };

  const CookPilotMenuPortal = () => {
    if (!cpMenuOpen) return null;
    return createPortal(
      <div
        ref={cpMenuRef}
        className={`fixed z-[10000] rounded-lg shadow-2xl py-1 ${
          isLcars
            ? "bg-[#0a0a14] border-2 border-[var(--lcars-orange)]/60"
            : "bg-purple-950/95 backdrop-blur-lg border border-purple-500/40"
        }`}
        style={{ top: cpMenuPos.top, left: cpMenuPos.left, width: cpMenuPos.width }}
        data-testid="cookpilot-submenu"
      >
        {cpStatus && !cpStatus.available && (
          <div className={`text-[10px] px-3 py-1 ${isLcars ? "text-red-400" : "text-red-300"}`} style={{ textTransform: "none" }}>
            CookPilot offline
          </div>
        )}
        {cpItems.map(item => (
          <Link
            key={item.path}
            to={item.path}
            onClick={() => { onNavClick(); setCpMenuOpen(false); }}
            className={`block px-3 py-2 text-xs transition-colors ${
              location.pathname === item.path
                ? isLcars ? "bg-[var(--lcars-orange)]/30 text-[var(--lcars-orange)] tracking-wider" : "bg-purple-700/60 text-purple-100"
                : isLcars ? "text-gray-300 hover:bg-[var(--lcars-orange)]/15 hover:text-[var(--lcars-orange)] tracking-wider" : "text-purple-200 hover:bg-purple-700/40"
            }`}
            data-testid={`cookpilot-submenu-${item.path.replace("/cookpilot/", "")}`}
          >
            {isLcars ? item.label : item.labelN}
          </Link>
        ))}
        {cpItems.length === 0 && (
          <div className={`text-[11px] px-3 py-2 ${isLcars ? "text-gray-500" : "text-purple-400"}`} style={{ textTransform: "none" }}>
            Keine Bereiche freigegeben.
          </div>
        )}
      </div>,
      document.body
    );
  };

  const ThemeMenuPortal = () => {
    if (!themeMenuOpen) return null;
    const themeClass = `theme-${theme}`;
    const toggleMute = async (e) => {
      e.stopPropagation();
      const next = !soundMuted;
      setSoundMuted(next);
      setThemeSoundMuted(next);
      // Persist to DB so it survives re-login
      try {
        await axios.put(`${API}/auth/sound`, { enabled: !next });
      } catch { /* tolerate failure — localStorage still works */ }
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
                <Link key={item.path} to={item.path} onClick={onNavClick}
                  className={`${btnBase} transition-all ${location.pathname === item.path ? activeBtn : hoverBtn}`}
                  data-testid={`nav-${item.shortLabel.toLowerCase()}`}>
                  {item.shortLabel}
                </Link>
              ))}
              {cpVisible && cpItems.length > 0 && (
                <button
                  ref={cpTriggerRef}
                  onClick={() => { onNavClick(); cpMenuOpen ? setCpMenuOpen(false) : openCpMenu(); }}
                  className={`${btnBase} ${location.pathname.startsWith("/cookpilot") ? activeBtn : hoverBtn} flex items-center gap-1`}
                  data-testid="nav-cookpilot">
                  CookPilot
                  <CaretDown size={10} />
                </button>
              )}
              <button
                ref={triggerRef}
                onClick={() => { onNavClick(); themeMenuOpen ? setThemeMenuOpen(false) : openThemeMenu(); }}
                className={`${btnBase} ${hoverBtn} flex items-center gap-1`}
                data-testid="nav-theme">
                <Palette size={12} />
                Theme
                <CaretDown size={10} />
              </button>
              <button onClick={() => { onNavClick(); logout(); }} className={`${btnBase} ${isMinesweeper ? "hover:bg-red-200" : "text-red-300 hover:bg-red-900/50"}`} data-testid="logout-button">
                <SignOut size={14} />
              </button>
            </nav>
          </div>
        </header>
        <main>{children}</main>
        <ThemeMenuPortal />
        <CookPilotMenuPortal />
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
          <button onClick={() => { onNavClick(); logout(); }} className="text-black text-xs font-bold tracking-wider" data-testid="logout-button">
            ABMELDEN
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="lcars-sidebar sticky top-[50px] h-[calc(100vh-50px)] overflow-auto" data-testid="lcars-sidebar">
          {navItems.map((item) => (
            <Link key={item.path} to={item.path} onClick={onNavClick}
              className={`lcars-sidebar-item ${location.pathname === item.path ? "active" : ""}`}
              data-testid={`nav-${item.shortLabel.toLowerCase()}`}>
              {item.shortLabel}
            </Link>
          ))}
          {cpVisible && cpItems.length > 0 && (
            <button
              ref={cpTriggerRef}
              onClick={() => { onNavClick(); cpMenuOpen ? setCpMenuOpen(false) : openCpMenu(); }}
              className={`lcars-sidebar-item w-full flex items-center justify-between gap-2 ${location.pathname.startsWith("/cookpilot") ? "active" : ""}`}
              style={{ background: cpStatus?.available === false ? "var(--lcars-salmon)" : "var(--lcars-mauve)" }}
              data-testid="nav-cookpilot">
              <span>COOKPILOT</span>
              <CaretDown size={12} />
            </button>
          )}
          <button
            ref={triggerRef}
            onClick={() => { onNavClick(); themeMenuOpen ? setThemeMenuOpen(false) : openThemeMenu(); }}
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
      <CookPilotMenuPortal />
    </div>
  );
};

export default LcarsLayout;

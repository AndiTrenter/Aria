import { useState, useEffect } from "react";
import { useAuth, useTheme, API, formatApiError } from "@/App";
import axios from "axios";
import { toast } from "sonner";
import { User, Link as LinkIcon, Check, X, Eye, EyeSlash, SpeakerHigh, SpeakerSlash, Microphone, Palette, DownloadSimple, AndroidLogo } from "@phosphor-icons/react";
import { playThemeSound, setThemeSoundMuted } from "@/utils/themeSounds";

const THEME_PREVIEWS = {
  startrek: { icon: "\u{1F680}", label: "Star Trek", sub: "LCARS Interface", accent: "#FF9900" },
  disney: { icon: "\u{1F3F0}", label: "Disney", sub: "Magical Theme", accent: "#c084fc" },
  fortnite: { icon: "\u{1F3AE}", label: "Fortnite", sub: "Neon Battle Royale", accent: "#00eaff" },
  minesweeper: { icon: "\u{1F4BB}", label: "Minesweeper 95", sub: "Windows Classic", accent: "#000080" },
};

const Account = () => {
  const { user, checkAuth } = useAuth();
  const { theme, setTheme, availableThemes } = useTheme();
  const [soundEnabled, setSoundEnabled] = useState(user?.sound_effects_enabled !== false);

  // ── Android APK release info (from GitHub) ─────────────────────────
  const [androidRelease, setAndroidRelease] = useState(null);
  const [androidLoading, setAndroidLoading] = useState(true);

  useEffect(() => {
    const repo = process.env.REACT_APP_GITHUB_REPO || "";
    if (!repo) { setAndroidLoading(false); return; }
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
          headers: { Accept: "application/vnd.github+json" },
        });
        if (!res.ok) { setAndroidLoading(false); return; }
        const data = await res.json();
        const apk = (data?.assets || []).find((a) => /\.apk$/i.test(a.name));
        if (!alive) return;
        setAndroidRelease(apk ? {
          tag: data?.tag_name || data?.name || "",
          url: apk.browser_download_url,
          size: apk.size,
          published_at: data?.published_at,
          body: (data?.body || "").slice(0, 600),
        } : null);
      } catch { /* silent */ }
      finally { if (alive) setAndroidLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  const repoName = process.env.REACT_APP_GITHUB_REPO || "";

  useEffect(() => {
    setSoundEnabled(user?.sound_effects_enabled !== false);
  }, [user?.sound_effects_enabled]);

  const toggleSound = async () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    setThemeSoundMuted(!next);
    try {
      await axios.put(`${API}/auth/sound`, { enabled: next });
      // Play a preview so user hears what they enabled
      if (next) setTimeout(() => playThemeSound(theme), 80);
      toast.success(next ? "Sound-Effekte aktiviert" : "Sound-Effekte deaktiviert");
      checkAuth();
    } catch (e) {
      setSoundEnabled(!next); // revert
      setThemeSoundMuted(next);
      toast.error(formatApiError(e));
    }
  };
  const [services, setServices] = useState([]);
  const [linkForm, setLinkForm] = useState({ service_id: "", username: "", password: "" });
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [showLinkPassword, setShowLinkPassword] = useState(false);

  // Voice settings
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState(user?.voice || "");
  const [voicePin, setVoicePin] = useState("");
  const [playingVoice, setPlayingVoice] = useState(null);

  useEffect(() => {
    axios.get(`${API}/services`).then(res => setServices(res.data)).catch(() => {});
    axios.get(`${API}/voice/options`).then(res => {
      setVoices(res.data.voices);
      if (!selectedVoice) setSelectedVoice(res.data.default_voice);
    }).catch(() => {});
  }, []);

  const previewVoice = async (voiceId) => {
    try {
      setPlayingVoice(voiceId);
      const resp = await axios.post(`${API}/voice/tts`,
        { text: "Hallo, ich bin Aria. So klinge ich mit dieser Stimme.", voice: voiceId },
        { responseType: "blob" }
      );
      const url = URL.createObjectURL(resp.data);
      const audio = new Audio(url);
      audio.onended = () => { setPlayingVoice(null); URL.revokeObjectURL(url); };
      audio.onerror = () => { setPlayingVoice(null); };
      await audio.play();
    } catch { setPlayingVoice(null); toast.error("TTS nicht verfügbar"); }
  };

  const saveVoiceSettings = async () => {
    const body = { voice: selectedVoice };
    if (voicePin) body.voice_pin = voicePin;
    try {
      await axios.put(`${API}/voice/user-settings`, body);
      toast.success("Spracheinstellungen gespeichert");
      setVoicePin("");
    } catch { toast.error("Fehler beim Speichern"); }
  };

  useEffect(() => {
    axios.get(`${API}/services`).then(res => setServices(res.data)).catch(() => {});
  }, []);

  const handleLinkService = async () => {
    try {
      await axios.post(`${API}/services/${linkForm.service_id}/link`, linkForm);
      toast.success("Konto verknüpft!");
      setShowLinkForm(false);
      checkAuth();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  const handleUnlinkService = async (serviceId) => {
    try {
      await axios.delete(`${API}/services/${serviceId}/link`);
      toast.success("Verknüpfung entfernt");
      checkAuth();
    } catch (e) {
      toast.error("Fehler");
    }
  };

  const isLcars = theme === "startrek";
  const cardClass = isLcars ? "lcars-card" : "disney-card";
  const btnClass = isLcars ? "lcars-button" : "disney-button";
  const inputClass = isLcars ? "lcars-input" : "disney-input";

  const [pinInput, setPinInput] = useState("");
  const [pinSaved, setPinSaved] = useState(false);

  const handleSavePin = async () => {
    if (!pinInput || pinInput.length < 4 || pinInput.length > 8 || !/^\d+$/.test(pinInput)) {
      toast.error("PIN muss 4-8 Ziffern haben");
      return;
    }
    try {
      await axios.put(`${API}/auth/pin`, { pin: pinInput });
      toast.success("PIN gespeichert");
      setPinInput("");
      setPinSaved(true);
    } catch (e) {
      toast.error("Fehler beim Speichern");
    }
  };

  return (
    <div className="p-6 max-w-3xl" data-testid="account-page">
      {/* Page Title */}
      <h2 className={`mb-6 ${isLcars ? "text-lg tracking-widest text-[var(--lcars-orange)]" : "disney-title text-2xl font-bold"}`}>
        {isLcars ? "BENUTZER PROFIL" : "Mein Konto"}
      </h2>

      {/* Profile */}
      <div className={`${cardClass} mb-6`}>
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-orange-500 to-purple-600 flex items-center justify-center">
            <User size={32} className="text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold">{user?.name}</h2>
            <p className="text-gray-400">{user?.email}</p>
            <span className={`inline-block mt-1 px-2 py-0.5 rounded text-xs ${user?.role === 'superadmin' ? 'bg-purple-600' : 'bg-orange-600'}`}>
              {user?.role}
            </span>
          </div>
          <div className="flex-1" />
          <a href="/konto/profil" className={`text-xs px-3 py-1.5 rounded ${isLcars ? "bg-[var(--lcars-purple)]/20 text-[var(--lcars-purple)] border border-[var(--lcars-purple)]/40" : "bg-purple-800/40 text-purple-200"}`} style={{ textTransform: "none" }} data-testid="link-profile">
            Profil bearbeiten →
          </a>
        </div>
      </div>

      {/* Theme */}
      <div className={`${cardClass} mb-6`}>
        <div className="flex items-center gap-2 mb-4">
          <Palette size={18} style={{ color: THEME_PREVIEWS[theme]?.accent || "#fff" }} />
          <h3 className={isLcars ? "text-sm tracking-widest" : "font-bold"}>
            {isLcars ? "INTERFACE DESIGN" : "Theme wählen"}
          </h3>
        </div>
        <p className="text-xs text-gray-500 mb-3" style={{ textTransform: "none" }}>
          Wähle dein Standard-Theme. Es wird nach jedem Login aktiviert und ist nur für dich gespeichert.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {availableThemes.map(t => {
            const p = THEME_PREVIEWS[t.id] || {};
            const selected = theme === t.id;
            const accent = p.accent || t.accent;
            return (
              <button
                key={t.id}
                onClick={() => { setTheme(t.id); toast.success(`Theme: ${t.label}`); }}
                className={`theme-submenu-item p-4 rounded-lg border-2 transition-all text-left ${selected ? "border-[length:2px]" : "border-gray-600 opacity-80 hover:opacity-100"}`}
                style={{
                  "--preview-accent": accent,
                  ...(selected ? { borderColor: accent, background: `${accent}22` } : {}),
                  display: "block",
                }}
                data-testid={`theme-${t.id}`}>
                <div className="text-2xl mb-2">{p.icon || "\u{1F3A8}"}</div>
                <div className="font-bold text-sm" style={{ textTransform: "none" }}>{p.label || t.label}</div>
                <div className="text-xs text-gray-400" style={{ textTransform: "none" }}>{p.sub || ""}</div>
                {selected && <div className="mt-2 text-[10px] font-bold" style={{ color: accent }}>\u2713 AKTIV</div>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Sound Effects */}
      <div className={`${cardClass} mb-6`}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            {soundEnabled ? <SpeakerHigh size={22} /> : <SpeakerSlash size={22} className="text-gray-500" />}
            <div>
              <div className={isLcars ? "text-sm tracking-widest font-bold" : "font-bold text-sm"} style={{ textTransform: "none" }}>
                Sound-Effekte
              </div>
              <div className="text-xs text-gray-500" style={{ textTransform: "none" }}>
                Spielt bei Menü-Klicks einen kurzen Ton passend zu deinem Theme. Jedes Theme hat seine eigene Signatur.
              </div>
            </div>
          </div>
          <button
            onClick={toggleSound}
            className={`relative w-16 h-8 rounded-full transition-colors flex-shrink-0 ${soundEnabled ? "" : "bg-gray-600"}`}
            style={soundEnabled ? { background: THEME_PREVIEWS[theme]?.accent || "#FF9900" } : {}}
            data-testid="sound-toggle"
            aria-label={soundEnabled ? "Sound aus" : "Sound an"}>
            <span className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow transition-all ${soundEnabled ? "left-9" : "left-1"}`} />
          </button>
        </div>
      </div>

      {/* PIN for critical devices */}
      <div className={`${cardClass} mb-6`}>
        <h3 className={isLcars ? "text-sm tracking-widest mb-4" : "font-bold mb-4"}>
          {isLcars ? "SICHERHEITS-PIN" : "Sicherheits-PIN"}
        </h3>
        <p className={`text-xs mb-3 ${isLcars ? "text-gray-400" : "text-purple-300"}`}>
          {isLcars ? "PIN FÜR KRITISCHE SMART HOME GERÄTE (SCHLÖSSER, ALARM, ETC.)" : "PIN für kritische Smart Home Geräte (Schlösser, Alarm, etc.)"}
        </p>
        <div className="flex gap-3">
          <input
            type="password"
            placeholder="4-8 Ziffern"
            value={pinInput}
            onChange={(e) => setPinInput(e.target.value.replace(/\D/g, "").slice(0, 8))}
            className={`${inputClass} w-40`}
            maxLength={8}
            data-testid="pin-input"
          />
          <button onClick={handleSavePin} className={btnClass} data-testid="pin-save">
            {isLcars ? "PIN SETZEN" : "PIN setzen"}
          </button>
        </div>
      </div>

      {/* Aria Stimme & Voice-PIN */}
      <div className={`${cardClass} mb-6`}>
        <h3 className={`${isLcars ? "text-sm tracking-widest mb-4 text-[var(--lcars-orange)]" : "font-bold mb-4"}`}>
          <SpeakerHigh size={18} className="inline mr-2" />
          {isLcars ? "ARIA STIMME" : "Aria Stimme"}
        </h3>
        <p className={`text-xs mb-4 ${isLcars ? "text-gray-400" : "text-purple-300"}`}>
          {isLcars ? "WÄHLE DIE STIMME MIT DER ARIA MIT DIR SPRICHT." : "Wähle die Stimme mit der Aria mit dir spricht."}
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4">
          {voices.map(v => (
            <button key={v.id} onClick={() => setSelectedVoice(v.id)}
              className={`p-3 rounded-lg text-left transition-all ${
                selectedVoice === v.id
                  ? isLcars ? "bg-[var(--lcars-orange)]/15 border-2 border-[var(--lcars-orange)]/50" : "bg-purple-600/20 border-2 border-purple-500/50"
                  : isLcars ? "bg-[#0a0a14] border border-gray-800 hover:border-gray-600" : "bg-gray-900/30 border border-gray-700 hover:border-gray-500"
              }`}
              data-testid={`voice-${v.id}`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className={`text-sm font-bold ${selectedVoice === v.id ? (isLcars ? "text-[var(--lcars-orange)]" : "text-purple-200") : "text-gray-400"}`}>
                  {v.name}
                  {v.premium && (
                    <span className={`ml-1 align-middle text-[8px] px-1 py-[1px] rounded ${isLcars ? "bg-[var(--lcars-orange)] text-black" : "bg-purple-500 text-white"}`}>
                      HD
                    </span>
                  )}
                  {v.is_new && !v.premium && (
                    <span className={`ml-1 align-middle text-[8px] px-1 py-[1px] rounded ${isLcars ? "bg-[var(--lcars-blue)] text-black" : "bg-cyan-500 text-white"}`}>
                      NEU
                    </span>
                  )}
                </span>
                <button onClick={(e) => { e.stopPropagation(); previewVoice(v.id); }}
                  className={`p-1 rounded ${isLcars ? "text-[var(--lcars-blue)] hover:bg-[var(--lcars-blue)]/10" : "text-purple-400 hover:bg-purple-800/30"}`}
                  data-testid={`preview-voice-${v.id}`}
                >
                  <SpeakerHigh size={14} className={playingVoice === v.id ? "animate-pulse" : ""} />
                </button>
              </div>
              <div className="text-[10px] text-gray-500">{v.desc}</div>
            </button>
          ))}
        </div>

        {/* Voice PIN */}
        <div className={`mt-4 pt-4 border-t ${isLcars ? "border-[var(--lcars-purple)]/20" : "border-purple-800/20"}`}>
          <h4 className={`text-xs font-bold mb-2 ${isLcars ? "text-[var(--lcars-blue)] tracking-wider" : "text-purple-300"}`}>
            <Microphone size={14} className="inline mr-1" />
            {isLcars ? "SPRACH-PIN" : "Sprach-PIN"}
          </h4>
          <p className={`text-[10px] mb-2 ${isLcars ? "text-gray-500" : "text-purple-400"}`}>
            {isLcars ? "SAGE DEINEN PIN WENN ARIA DANACH FRAGT, UM DICH ZU IDENTIFIZIEREN." : "Sage deinen PIN wenn Aria danach fragt, um dich zu identifizieren."}
          </p>
          <div className="flex gap-2 items-center">
            <input type="password" value={voicePin} onChange={(e) => setVoicePin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder={user?.voice_pin ? "Neuer PIN (aktuell gesetzt)" : "4-6 Ziffern"}
              className={`${inputClass} w-36`} maxLength={6} data-testid="voice-pin-input" />
            {user?.voice_pin && <Check size={14} className="text-green-400" title="PIN gesetzt" />}
          </div>
        </div>

        <button onClick={saveVoiceSettings} className={`${btnClass} mt-4`} data-testid="save-voice-settings">
          {isLcars ? "STIMME SPEICHERN" : "Stimme speichern"}
        </button>
      </div>

      {/* Linked Services */}
      <div className={cardClass}>
        <div className="flex justify-between items-center mb-4">
          <h3 className={isLcars ? "text-sm tracking-widest" : "font-bold"}>
            {isLcars ? "VERKNÜPFTE DIENSTE" : "Verknüpfte Konten"}
          </h3>
          <button onClick={() => setShowLinkForm(!showLinkForm)} className={btnClass} data-testid="link-service-toggle">
            <LinkIcon size={16} className="inline mr-1" /> Verknüpfen
          </button>
        </div>

        {showLinkForm && (
          <div className="mb-4 p-4 bg-gray-900/50 rounded-lg" data-testid="link-service-form">
            <div className="grid grid-cols-1 gap-3 mb-3">
              <select 
                value={linkForm.service_id} 
                onChange={(e) => setLinkForm({...linkForm, service_id: e.target.value})}
                className={inputClass}
                data-testid="link-service-select"
              >
                <option value="">Dienst wählen...</option>
                {services.filter(s => !s.linked).map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <input 
                placeholder="Benutzername" 
                value={linkForm.username}
                onChange={(e) => setLinkForm({...linkForm, username: e.target.value})}
                className={inputClass}
                data-testid="link-service-username"
              />
              <div className="relative">
                <input 
                  type={showLinkPassword ? "text" : "password"}
                  placeholder="Passwort" 
                  value={linkForm.password}
                  onChange={(e) => setLinkForm({...linkForm, password: e.target.value})}
                  className={`${inputClass} w-full pr-10`}
                  data-testid="link-service-password"
                />
                <button type="button" onClick={() => setShowLinkPassword(!showLinkPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">
                  {showLinkPassword ? <EyeSlash size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <button onClick={handleLinkService} className={btnClass} data-testid="link-service-submit">Verknüpfen</button>
          </div>
        )}

        <div className="space-y-2">
          {services.filter(s => s.linked).map(s => (
            <div key={s.id} className="flex items-center gap-3 p-3 bg-gray-900/30 rounded-lg">
              <Check size={18} className="text-green-500" />
              <div className="flex-1">
                <div className="font-bold">{s.name}</div>
                <div className="text-xs text-gray-400">{s.linked_username}</div>
              </div>
              <button onClick={() => handleUnlinkService(s.id)} className="p-2 hover:bg-red-900/50 rounded text-red-400">
                <X size={18} />
              </button>
            </div>
          ))}
          {services.filter(s => s.linked).length === 0 && (
            <p className="text-gray-500 text-center py-4">Keine Konten verknüpft</p>
          )}
        </div>
      </div>

      {/* ── Android App Download ──────────────────────────────────── */}
      <div className="bg-black/40 border border-orange-500/30 rounded-lg p-6 mt-6" data-testid="account-android-download">
        <h2 className="text-lg font-bold mb-3 flex items-center gap-2 text-orange-200">
          <AndroidLogo size={22} weight="bold" /> A.R.I.A. — Android-App
        </h2>
        {!repoName && (
          <p className="text-sm text-gray-500">
            Kein GitHub-Repository konfiguriert. Setze die Umgebungsvariable <code>REACT_APP_GITHUB_REPO</code> (Format: <code>owner/repo</code>).
          </p>
        )}
        {repoName && androidLoading && (
          <p className="text-sm text-gray-400">Suche nach aktuellem Release …</p>
        )}
        {repoName && !androidLoading && !androidRelease && (
          <div className="space-y-2">
            <p className="text-sm text-gray-400" style={{ textTransform: "none" }}>
              Aktuell ist im Repository <span className="text-orange-300">{repoName}</span> kein Android-Release mit APK-Asset verfügbar. Sobald der GitHub-Actions-Build durchläuft, erscheint hier der Download.
            </p>
            <a
              href={`https://github.com/${repoName}/releases`}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-xs text-orange-300 hover:text-orange-200 underline"
            >
              Releases auf GitHub öffnen →
            </a>
          </div>
        )}
        {androidRelease && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-sm">
              <span className="px-2 py-0.5 rounded bg-orange-500/20 text-orange-200 text-xs font-bold">
                {androidRelease.tag}
              </span>
              <span className="text-gray-500 text-xs">
                {(androidRelease.size / (1024 * 1024)).toFixed(1)} MB
                {androidRelease.published_at && ` · ${new Date(androidRelease.published_at).toLocaleDateString("de-DE")}`}
              </span>
            </div>
            {androidRelease.body && (
              <p className="text-xs text-gray-400 whitespace-pre-wrap" style={{ textTransform: "none" }}>
                {androidRelease.body}
              </p>
            )}
            <div className="flex gap-2 flex-wrap">
              <a
                href={androidRelease.url}
                target="_blank"
                rel="noreferrer"
                data-testid="android-download-btn"
                className="inline-flex items-center gap-2 px-4 py-2 rounded bg-gradient-to-b from-orange-500 to-orange-700 text-white text-sm font-bold hover:from-orange-400 hover:to-orange-600 transition"
              >
                <DownloadSimple size={16} weight="bold" /> APK herunterladen
              </a>
              <a
                href={`https://github.com/${repoName}/releases`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded border border-orange-500/40 text-orange-200 text-sm hover:bg-orange-500/10"
              >
                Alle Releases
              </a>
            </div>
            <p className="text-[11px] text-gray-500 mt-2" style={{ textTransform: "none" }}>
              Hinweis: Auf Android muss „Installation aus unbekannten Quellen" für deinen Browser einmalig erlaubt werden (Einstellungen → Apps → [Browser] → Unbekannte Apps installieren).
            </p>
          </div>
        )}
      </div>

      {/* ── Mobile: ARIA-Server-URL ändern (nur in der Android-App sichtbar) ── */}
      {typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.() && (
        <div className="bg-black/40 border border-orange-500/30 rounded-lg p-6 mt-6" data-testid="account-mobile-server">
          <h2 className="text-lg font-bold mb-3 text-orange-200">
            ARIA-Server-Verbindung
          </h2>
          <p className="text-xs text-gray-400 mb-3" style={{ textTransform: "none" }}>
            Aktueller Server: <code className="text-orange-300">{localStorage.getItem("aria_server_url") || "(nicht konfiguriert)"}</code>
          </p>
          <button
            data-testid="mobile-change-server-btn"
            onClick={() => {
              if (window.confirm("Server-URL zurücksetzen? Du wirst ausgeloggt und kannst dann eine neue URL eingeben.")) {
                localStorage.removeItem("aria_server_url");
                localStorage.removeItem("aria_token");
                localStorage.removeItem("aria_user");
                window.location.href = "/";
              }
            }}
            className="px-4 py-2 rounded border border-orange-500/40 text-orange-200 text-sm hover:bg-orange-500/10"
          >
            Server-URL ändern
          </button>
        </div>
      )}
    </div>
  );
};

export default Account;

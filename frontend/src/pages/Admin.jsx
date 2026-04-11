import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth, useTheme, API, formatApiError } from "@/App";
import axios from "axios";
import { toast } from "sonner";
import { ArrowLeft, Plus, User, Trash, PencilSimple, Check, X, HardDrives, Shield, Gear, Eye, EyeSlash } from "@phosphor-icons/react";

const Admin = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [activeTab, setActiveTab] = useState("users");
  const [users, setUsers] = useState([]);
  const [services, setServices] = useState([]);
  const [settings, setSettings] = useState({});
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [newUser, setNewUser] = useState({ email: "", password: "", name: "", role: "user" });
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [weatherCity, setWeatherCity] = useState("");
  const [weatherApiKey, setWeatherApiKey] = useState("");

  const fetchData = async () => {
    let anyError = false;
    try {
      const usersRes = await axios.get(`${API}/admin/users`);
      setUsers(usersRes.data);
    } catch { anyError = true; }
    try {
      const servicesRes = await axios.get(`${API}/services`);
      setServices(servicesRes.data);
    } catch { anyError = true; }
    try {
      const settingsRes = await axios.get(`${API}/admin/settings`);
      setSettings(settingsRes.data);
    } catch { anyError = true; }
    if (anyError && users.length === 0 && services.length === 0) {
      toast.error("Einige Daten konnten nicht geladen werden. Bitte Seite neu laden.");
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleCreateUser = async () => {
    try {
      await axios.post(`${API}/admin/users`, newUser);
      toast.success("Benutzer erstellt");
      setShowCreateUser(false);
      setNewUser({ email: "", password: "", name: "", role: "user" });
      fetchData();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Fehler");
    }
  };

  const handleDeleteUser = async (userId) => {
    if (!window.confirm("Benutzer wirklich löschen?")) return;
    try {
      await axios.delete(`${API}/admin/users/${userId}`);
      toast.success("Benutzer gelöscht");
      fetchData();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Fehler");
    }
  };

  const handleSaveSettings = async () => {
    const payload = {};
    if (apiKeyInput) payload.openai_api_key = apiKeyInput;
    if (weatherCity) payload.weather_city = weatherCity;
    if (weatherApiKey) payload.weather_api_key = weatherApiKey;
    if (Object.keys(payload).length === 0) {
      toast.error("Keine Änderungen eingegeben");
      return;
    }
    try {
      await axios.put(`${API}/admin/settings`, payload);
      const saved = [];
      if (payload.openai_api_key) saved.push("OpenAI Key");
      if (payload.weather_city) saved.push("Stadt");
      if (payload.weather_api_key) saved.push("Wetter Key");
      toast.success(`Gespeichert: ${saved.join(", ")}`);
      setApiKeyInput("");
      setWeatherApiKey("");
      setWeatherCity("");
      fetchData();
    } catch (e) {
      toast.error("Fehler beim Speichern der Einstellungen");
    }
  };

  const isLcars = theme === "startrek";
  const cardClass = isLcars ? "lcars-card" : "disney-card";
  const btnClass = isLcars ? "lcars-button" : "disney-button";
  const inputClass = isLcars ? "lcars-input" : "disney-input";

  const tabs = [
    { id: "users", label: isLcars ? "BENUTZER" : "Benutzer" },
    { id: "services", label: isLcars ? "DIENSTE" : "Dienste" },
    { id: "settings", label: isLcars ? "EINSTELLUNGEN" : "Einstellungen" },
  ];

  return (
    <div className="p-6">
      {/* Page Title */}
      <h2 className={`mb-4 ${isLcars ? "text-lg tracking-widest text-[var(--lcars-orange)]" : "disney-title text-2xl font-bold"}`}>
        {isLcars ? "ADMINISTRATION" : "Administration"}
      </h2>

      {/* Tabs */}
        <div className="flex gap-2 mb-6" data-testid="admin-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-full text-sm font-bold transition-all ${
                activeTab === tab.id
                  ? isLcars ? "bg-[var(--lcars-orange)] text-black" : "bg-purple-600 text-white"
                  : isLcars ? "bg-[var(--lcars-purple)]/20 text-[var(--lcars-purple)] hover:bg-[var(--lcars-purple)]/40" : "bg-purple-900/30 text-purple-400 hover:bg-purple-800/40"
              }`}
              data-testid={`tab-${tab.id}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Users Tab */}
        {activeTab === "users" && (
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className={isLcars ? "text-sm tracking-widest text-[var(--lcars-mauve)]" : "text-lg font-bold text-purple-200"}>
                {users.length} {isLcars ? "BENUTZER REGISTRIERT" : "Benutzer"}
              </h2>
              <button onClick={() => setShowCreateUser(!showCreateUser)} className={btnClass} data-testid="create-user-button">
                <Plus size={14} className="inline mr-1" /> {isLcars ? "NEU" : "Neuer Benutzer"}
              </button>
            </div>

            {showCreateUser && (
              <div className={`${cardClass} mb-4`} data-testid="create-user-form">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                  <input placeholder="Name" value={newUser.name} onChange={(e) => setNewUser({...newUser, name: e.target.value})} className={inputClass} data-testid="new-user-name" />
                  <input placeholder="E-Mail" value={newUser.email} onChange={(e) => setNewUser({...newUser, email: e.target.value})} className={inputClass} data-testid="new-user-email" />
                  <input type="password" placeholder="Passwort" value={newUser.password} onChange={(e) => setNewUser({...newUser, password: e.target.value})} className={inputClass} data-testid="new-user-password" />
                  <select value={newUser.role} onChange={(e) => setNewUser({...newUser, role: e.target.value})} className={inputClass} data-testid="new-user-role">
                    <option value="user">Benutzer</option>
                    <option value="admin">Admin</option>
                    <option value="readonly">Nur Lesen</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <button onClick={handleCreateUser} className={btnClass} data-testid="submit-create-user">Erstellen</button>
                  <button onClick={() => setShowCreateUser(false)} className={`${isLcars ? "lcars-button lcars-button-salmon" : "disney-button"} opacity-70`}>Abbrechen</button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {users.map((u) => (
                <div key={u.id} className={`${cardClass} flex items-center gap-4`} data-testid={`user-row-${u.id}`}>
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isLcars ? "bg-[var(--lcars-purple)]/20" : "bg-purple-800/40"}`}>
                    <User size={18} className={isLcars ? "text-[var(--lcars-purple)]" : "text-purple-400"} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm truncate">{u.name || u.email}</div>
                    <div className="text-xs text-gray-500">{u.email}</div>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded tracking-wider ${
                    u.role === "superadmin" ? (isLcars ? "bg-[var(--lcars-orange)]/20 text-[var(--lcars-orange)]" : "bg-purple-600/30 text-purple-300") :
                    u.role === "admin" ? (isLcars ? "bg-[var(--lcars-blue)]/20 text-[var(--lcars-blue)]" : "bg-blue-600/30 text-blue-300") :
                    isLcars ? "bg-gray-800 text-gray-400" : "bg-gray-700 text-gray-400"
                  }`}>
                    {u.role}
                  </span>
                  {u.id !== user?.id && (
                    <button onClick={() => handleDeleteUser(u.id)} className="text-red-400 hover:text-red-300 p-2" data-testid={`delete-user-${u.id}`}>
                      <Trash size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Services Tab */}
        {activeTab === "services" && (
          <div className="space-y-2">
            {services.map((s) => (
              <div key={s.id} className={`${cardClass} flex items-center gap-4`} data-testid={`service-admin-${s.id}`}>
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isLcars ? "bg-[var(--lcars-blue)]/20" : "bg-blue-800/40"}`}>
                  <HardDrives size={18} className={isLcars ? "text-[var(--lcars-blue)]" : "text-blue-400"} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm">{s.name}</div>
                  <div className="text-xs text-gray-500">{s.url}</div>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded bg-gray-800 text-gray-400">{s.category}</span>
                <span className={`text-[10px] font-bold ${s.enabled ? "text-green-400" : "text-red-400"}`}>{s.enabled ? "AKTIV" : "INAKTIV"}</span>
              </div>
            ))}
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === "settings" && (
          <div className="space-y-6">
            {/* AI Configuration */}
            <div className={cardClass} data-testid="settings-api-key">
              <div className="flex items-center gap-3 mb-4">
                <Gear size={20} className={isLcars ? "text-[var(--lcars-orange)]" : "text-purple-400"} />
                <h3 className={isLcars ? "text-sm tracking-widest text-[var(--lcars-orange)]" : "font-bold text-purple-200"}>
                  {isLcars ? "KI-KONFIGURATION" : "KI-Konfiguration"}
                </h3>
              </div>
              <p className="text-xs text-gray-400 mb-4">
                OpenAI API-Key für den Aria Chat-Assistenten. Wird für GPT-4o basierte Antworten verwendet.
              </p>
              <div className="space-y-3">
                <div>
                  <label className={isLcars ? "lcars-label block" : "text-sm text-purple-300 block mb-1"}>
                    {isLcars ? "AKTUELLER API-KEY" : "Aktueller API-Key"}
                  </label>
                  <div className={`p-2 rounded text-sm ${isLcars ? "bg-[#0a0a14] text-gray-400 border border-[var(--lcars-purple)]/30" : "bg-purple-950/50 text-purple-300"}`}>
                    {settings.openai_api_key || (isLcars ? "NICHT KONFIGURIERT" : "Nicht konfiguriert")}
                  </div>
                </div>
                <div>
                  <label className={isLcars ? "lcars-label block" : "text-sm text-purple-300 block mb-1"}>
                    {isLcars ? "NEUER API-KEY" : "Neuer API-Key"}
                  </label>
                  <div className="relative">
                    <input
                      type={showApiKey ? "text" : "password"}
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      placeholder="sk-..."
                      className={`${inputClass} w-full pr-10`}
                      data-testid="api-key-input"
                    />
                    <button onClick={() => setShowApiKey(!showApiKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">
                      {showApiKey ? <EyeSlash size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <p className="text-[10px] text-gray-600">
                  <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className={isLcars ? "text-[var(--lcars-blue)] underline" : "text-purple-400 underline"}>
                    API-Key bei OpenAI erstellen
                  </a>
                </p>
              </div>
            </div>

            {/* Weather Configuration */}
            <div className={cardClass} data-testid="settings-weather">
              <div className="flex items-center gap-3 mb-4">
                <Gear size={20} className={isLcars ? "text-[var(--lcars-blue)]" : "text-blue-400"} />
                <h3 className={isLcars ? "text-sm tracking-widest text-[var(--lcars-blue)]" : "font-bold text-purple-200"}>
                  {isLcars ? "WETTER-KONFIGURATION" : "Wetter-Konfiguration"}
                </h3>
              </div>
              <p className="text-xs text-gray-400 mb-4">
                OpenWeatherMap API-Key und Standort für die Wetteranzeige.
              </p>
              <div className="space-y-3">
                <div>
                  <label className={isLcars ? "lcars-label block" : "text-sm text-purple-300 block mb-1"}>
                    {isLcars ? "STANDORT" : "Standort (Stadt)"}
                  </label>
                  <input
                    type="text"
                    value={weatherCity}
                    onChange={(e) => setWeatherCity(e.target.value)}
                    placeholder={settings.weather_city || "z.B. Berlin,DE"}
                    className={`${inputClass} w-full`}
                    data-testid="weather-city-input"
                  />
                  {settings.weather_city && <span className="text-xs text-gray-500 mt-1 block">Aktuell: {settings.weather_city}</span>}
                </div>
                <div>
                  <label className={isLcars ? "lcars-label block" : "text-sm text-purple-300 block mb-1"}>
                    {isLcars ? "AKTUELLER WETTER-KEY" : "Aktueller Wetter-API-Key"}
                  </label>
                  <div className={`p-2 rounded text-sm ${isLcars ? "bg-[#0a0a14] text-gray-400 border border-[var(--lcars-purple)]/30" : "bg-purple-950/50 text-purple-300"}`}>
                    {settings.weather_api_key || (isLcars ? "NICHT KONFIGURIERT" : "Nicht konfiguriert")}
                  </div>
                </div>
                <div>
                  <label className={isLcars ? "lcars-label block" : "text-sm text-purple-300 block mb-1"}>
                    {isLcars ? "NEUER WETTER-KEY" : "Neuer Wetter-API-Key"}
                  </label>
                  <input
                    type="password"
                    value={weatherApiKey}
                    onChange={(e) => setWeatherApiKey(e.target.value)}
                    placeholder="API Key..."
                    className={`${inputClass} w-full`}
                    data-testid="weather-api-key-input"
                  />
                </div>
                <p className="text-[10px] text-gray-600">
                  <a href="https://home.openweathermap.org/api_keys" target="_blank" rel="noreferrer" className={isLcars ? "text-[var(--lcars-blue)] underline" : "text-purple-400 underline"}>
                    Kostenlosen API-Key bei OpenWeatherMap erstellen
                  </a>
                </p>
              </div>
            </div>

            {/* Save Button */}
            <button onClick={handleSaveSettings} className={`${btnClass} w-full`} data-testid="save-all-settings-button">
              {isLcars ? "ALLE EINSTELLUNGEN SPEICHERN" : "Alle Einstellungen speichern"}
            </button>
          </div>
        )}
    </div>
  );
};

export default Admin;

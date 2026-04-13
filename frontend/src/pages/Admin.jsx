import { useState, useEffect, useCallback } from "react";
import { useAuth, useTheme, API, formatApiError } from "@/App";
import axios from "axios";
import { toast } from "sonner";
import {
  Plus, Trash, PencilSimple, Check, X, House, Lightbulb, Power,
  ArrowClockwise, Shield, ShieldCheck, Eye, EyeSlash, Gear,
  User, HardDrives, LockSimple, ArrowsVertical, Thermometer,
  VideoCamera, SpeakerHigh, Fan, Robot, MagicWand, Lightning
} from "@phosphor-icons/react";

const DOMAIN_ICONS = {
  light: Lightbulb, switch: Power, climate: Thermometer, cover: ArrowsVertical,
  sensor: Eye, binary_sensor: Eye, camera: VideoCamera, lock: LockSimple,
  media_player: SpeakerHigh, fan: Fan, vacuum: Robot, scene: MagicWand,
  script: Gear, automation: Gear,
};

const ROOM_ICONS = [
  { id: "house", label: "Haus" }, { id: "couch", label: "Wohnzimmer" },
  { id: "bed", label: "Schlafzimmer" }, { id: "baby", label: "Kinderzimmer" },
  { id: "bathtub", label: "Bad" }, { id: "cooking-pot", label: "Küche" },
  { id: "garage", label: "Garage" }, { id: "tree", label: "Garten" },
  { id: "stairs", label: "Flur" }, { id: "desk", label: "Büro" },
  { id: "warehouse", label: "Keller" }, { id: "door", label: "Eingang" },
];

const ALL_TABS = [
  { id: "dash", label: "Dashboard" },
  { id: "home", label: "Smart Home" },
  { id: "auto", label: "Automationen" },
  { id: "health", label: "System Health" },
  { id: "chat", label: "Chat" },
  { id: "weather", label: "Wetter" },
  { id: "account", label: "Konto" },
  { id: "logs", label: "Logs" },
  { id: "kiosk", label: "Kiosk" },
];

const ROLES = [
  { value: "admin", label: "Admin", desc: "Voller Zugriff" },
  { value: "erwachsener", label: "Erwachsener", desc: "Steuern erlaubt" },
  { value: "user", label: "Benutzer", desc: "Standard" },
  { value: "kind", label: "Kind", desc: "Eingeschränkt" },
  { value: "gast", label: "Gast", desc: "Nur Anzeige" },
  { value: "wandtablet", label: "Wandtablet", desc: "Kiosk-Gerät" },
  { value: "readonly", label: "Nur Lesen", desc: "Kein Steuern" },
];

const Admin = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [activeTab, setActiveTab] = useState("users");
  const [users, setUsers] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [devices, setDevices] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [services, setServices] = useState([]);
  const [settings, setSettings] = useState({});
  const [auditLogs, setAuditLogs] = useState([]);

  // User form
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [userForm, setUserForm] = useState({ name: "", email: "", password: "", role: "user", assigned_rooms: [], visible_tabs: ["dash", "home", "chat", "weather", "account"] });

  // Room form
  const [showCreateRoom, setShowCreateRoom] = useState(false);
  const [newRoom, setNewRoom] = useState({ name: "", icon: "house", order: 0 });

  // Device state
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [syncing, setSyncing] = useState(false);

  // Permissions
  const [selectedUser, setSelectedUser] = useState(null);
  const [permissions, setPermissions] = useState([]);

  // Profile form
  const [showCreateProfile, setShowCreateProfile] = useState(false);
  const [newProfile, setNewProfile] = useState({ name: "", room_id: "", user_id: "", kiosk_mode: false, child_mode: false });

  // Settings
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [weatherCity, setWeatherCity] = useState("");
  const [weatherApiKey, setWeatherApiKey] = useState("");
  const [haUrl, setHaUrl] = useState("");
  const [haToken, setHaToken] = useState("");
  const [haStatus, setHaStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState(null);
  const [haTesting, setHaTesting] = useState(false);

  const isLcars = theme === "startrek";
  const cardClass = isLcars ? "lcars-card" : "disney-card";
  const btnClass = isLcars ? "lcars-button" : "disney-button";
  const inputClass = isLcars ? "lcars-input" : "disney-input";

  const fetchAll = useCallback(async () => {
    try {
      const [usersR, roomsR, devicesR, profilesR, servicesR, settingsR] = await Promise.all([
        axios.get(`${API}/admin/users`),
        axios.get(`${API}/smarthome/rooms`),
        axios.get(`${API}/smarthome/devices`),
        axios.get(`${API}/smarthome/profiles`),
        axios.get(`${API}/services`).catch(() => ({ data: [] })),
        axios.get(`${API}/admin/settings`).catch(() => ({ data: {} })),
      ]);
      setUsers(usersR.data);
      setRooms(roomsR.data);
      setDevices(devicesR.data);
      setProfiles(profilesR.data);
      setServices(servicesR.data);
      setSettings(settingsR.data);
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const fetchAuditLog = async () => {
    try {
      const { data } = await axios.get(`${API}/audit-log?limit=50`);
      setAuditLogs(data);
    } catch {}
  };

  const checkHaStatus = async () => {
    setHaTesting(true);
    try {
      const { data } = await axios.get(`${API}/ha/status`);
      setHaStatus(data);
      if (data.connected) {
        toast.success("Home Assistant verbunden!");
      } else {
        toast.error(data.message || "Home Assistant nicht erreichbar");
      }
    } catch (e) {
      setHaStatus(null);
      toast.error("Verbindungstest fehlgeschlagen");
    } finally {
      setHaTesting(false);
    }
  };

  useEffect(() => { checkHaStatus(); }, [settings]);

  // ==================== USER HANDLERS ====================
  const resetUserForm = () => {
    setUserForm({ name: "", email: "", password: "", role: "user", assigned_rooms: [], visible_tabs: ["dash", "home", "chat", "weather", "account"] });
    setEditingUser(null);
    setShowCreateUser(false);
  };

  const startEditUser = (u) => {
    setEditingUser(u.id);
    setUserForm({
      name: u.name || "",
      email: u.email || "",
      password: "",
      role: u.role || "user",
      assigned_rooms: u.assigned_rooms || [],
      visible_tabs: u.visible_tabs || ["dash", "home", "chat", "weather", "account"],
    });
    setShowCreateUser(true);
  };

  const handleSaveUser = async () => {
    if (editingUser) {
      // Update existing
      const body = { name: userForm.name, role: userForm.role, assigned_rooms: userForm.assigned_rooms, visible_tabs: userForm.visible_tabs };
      if (userForm.password) body.password = userForm.password;
      try {
        await axios.put(`${API}/admin/users/${editingUser}`, body);
        if (userForm.password) {
          await axios.post(`${API}/admin/users/${editingUser}/reset-password`, { new_password: userForm.password });
        }
        toast.success("Benutzer aktualisiert");
        resetUserForm();
        fetchAll();
      } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    } else {
      // Create new
      if (!userForm.email || !userForm.password) return toast.error("E-Mail und Passwort erforderlich");
      try {
        await axios.post(`${API}/admin/users`, userForm);
        toast.success("Benutzer erstellt");
        resetUserForm();
        fetchAll();
      } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    }
  };

  const handleDeleteUser = async (userId) => {
    if (!window.confirm("Benutzer wirklich löschen?")) return;
    try {
      await axios.delete(`${API}/admin/users/${userId}`);
      toast.success("Gelöscht");
      fetchAll();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const toggleRoom = (roomId) => {
    const cur = userForm.assigned_rooms;
    setUserForm({ ...userForm, assigned_rooms: cur.includes(roomId) ? cur.filter(r => r !== roomId) : [...cur, roomId] });
  };

  const toggleTab = (tabId) => {
    const cur = userForm.visible_tabs;
    setUserForm({ ...userForm, visible_tabs: cur.includes(tabId) ? cur.filter(t => t !== tabId) : [...cur, tabId] });
  };

  // ==================== ROOM HANDLERS ====================
  const handleCreateRoom = async () => {
    if (!newRoom.name.trim()) return toast.error("Name eingeben");
    try {
      await axios.post(`${API}/smarthome/rooms`, newRoom);
      toast.success("Raum erstellt");
      setShowCreateRoom(false);
      setNewRoom({ name: "", icon: "house", order: rooms.length });
      fetchAll();
    } catch (e) { toast.error("Fehler"); }
  };

  const handleDeleteRoom = async (roomId) => {
    if (!window.confirm("Raum wirklich löschen?")) return;
    try {
      await axios.delete(`${API}/smarthome/rooms/${roomId}`);
      toast.success("Raum gelöscht");
      fetchAll();
    } catch (e) { toast.error("Fehler"); }
  };

  // ==================== DEVICE HANDLERS ====================
  const handleAssignDevice = async (entityId, roomId) => {
    try {
      await axios.put(`${API}/smarthome/devices/${encodeURIComponent(entityId)}`, { room_id: roomId });
      toast.success("Zugewiesen");
      fetchAll();
    } catch (e) { toast.error("Fehler"); }
  };

  const handleToggleCritical = async (entityId, critical) => {
    try {
      await axios.put(`${API}/smarthome/devices/${encodeURIComponent(entityId)}`, { critical: !critical });
      toast.success(critical ? "Nicht mehr kritisch" : "Kritisch markiert");
      fetchAll();
    } catch (e) { toast.error("Fehler"); }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data } = await axios.post(`${API}/smarthome/sync`);
      toast.success(`${data.imported} Geräte importiert`);
      fetchAll();
    } catch (e) { toast.error(e.response?.data?.detail || "Sync fehlgeschlagen"); }
    finally { setSyncing(false); }
  };

  // ==================== PERMISSIONS HANDLERS ====================
  const loadPermissions = async (userId) => {
    setSelectedUser(userId);
    try {
      const { data } = await axios.get(`${API}/smarthome/permissions/${userId}`);
      setPermissions(data);
    } catch { setPermissions([]); }
  };

  const handleSetPermission = async (entityId, field, value) => {
    const existing = permissions.find(p => p.entity_id === entityId) || {};
    const body = {
      user_id: selectedUser, entity_id: entityId,
      visible: existing.visible || false, controllable: existing.controllable || false,
      automation_allowed: existing.automation_allowed || false, voice_allowed: existing.voice_allowed || false,
      [field]: value,
    };
    if (field === "visible" && !value) { body.controllable = false; body.automation_allowed = false; body.voice_allowed = false; }
    try {
      await axios.put(`${API}/smarthome/permissions`, body);
      loadPermissions(selectedUser);
    } catch { toast.error("Fehler"); }
  };

  const handleBulkPermission = async (roomId, perms) => {
    try {
      await axios.put(`${API}/smarthome/permissions/bulk`, { user_id: selectedUser, room_id: roomId, ...perms });
      toast.success("Aktualisiert");
      loadPermissions(selectedUser);
    } catch { toast.error("Fehler"); }
  };

  // ==================== SETTINGS HANDLERS ====================
  const handleSaveSettings = async () => {
    const payload = {};
    if (apiKeyInput) payload.openai_api_key = apiKeyInput;
    if (weatherCity) payload.weather_city = weatherCity;
    if (weatherApiKey) payload.weather_api_key = weatherApiKey;
    if (haUrl) payload.ha_url = haUrl;
    if (haToken) payload.ha_token = haToken;
    if (Object.keys(payload).length === 0) {
      toast.error("Keine Änderungen eingegeben");
      setSaveResult({ type: "error", msg: "Bitte zuerst Werte eingeben" });
      return;
    }
    setSaving(true);
    setSaveResult(null);
    try {
      await axios.put(`${API}/admin/settings`, payload);
      const saved = [];
      if (payload.openai_api_key) saved.push("OpenAI Key");
      if (payload.weather_city) saved.push("Standort");
      if (payload.weather_api_key) saved.push("Wetter Key");
      if (payload.ha_url) saved.push("HA URL");
      if (payload.ha_token) saved.push("HA Token");
      const msg = `Gespeichert: ${saved.join(", ")}`;
      toast.success(msg);
      setSaveResult({ type: "success", msg });
      setApiKeyInput(""); setWeatherApiKey(""); setWeatherCity(""); setHaUrl(""); setHaToken("");
      fetchAll();
      if (payload.ha_url || payload.ha_token) {
        setTimeout(() => checkHaStatus(), 500);
      }
    } catch (e) {
      const msg = "Fehler beim Speichern der Einstellungen";
      toast.error(msg);
      setSaveResult({ type: "error", msg });
    } finally {
      setSaving(false);
    }
  };

  // ==================== DERIVED DATA ====================
  const permMap = Object.fromEntries(permissions.map(p => [p.entity_id, p]));
  const selectedUserObj = users.find(u => u.id === selectedUser);
  const roomDevices = selectedRoom ? devices.filter(d => d.room_id === selectedRoom) : [];
  const unassignedDevices = devices.filter(d => !d.room_id);

  const tabs = [
    { id: "users", label: isLcars ? "BENUTZER" : "Benutzer" },
    { id: "rooms", label: isLcars ? "RÄUME" : "Räume" },
    { id: "devices", label: isLcars ? "GERÄTE" : "Geräte" },
    { id: "permissions", label: isLcars ? "FREIGABEN" : "Freigaben" },
    { id: "profiles", label: isLcars ? "PROFILE" : "Profile" },
    { id: "audit", label: isLcars ? "AUDIT-LOG" : "Audit-Log" },
    { id: "services", label: isLcars ? "DIENSTE" : "Dienste" },
    { id: "settings", label: isLcars ? "EINSTELLUNGEN" : "Einstellungen" },
  ];

  return (
    <div className="p-6" data-testid="admin-page">
      <div className="flex items-center gap-4 mb-4">
        <h2 className={`${isLcars ? "text-lg tracking-widest text-[var(--lcars-orange)]" : "disney-title text-2xl font-bold"}`}>
          {isLcars ? "ADMINISTRATION" : "Administration"}
        </h2>
        <div className="flex-1" />
        <button onClick={handleSync} disabled={syncing} className={`${btnClass} py-1 px-3 text-xs flex items-center gap-1`} data-testid="admin-sync-ha">
          <ArrowClockwise size={14} className={syncing ? "animate-spin" : ""} />
          {isLcars ? "HA SYNC" : "HA Sync"}
        </button>
      </div>

      {/* Tabs - scrollable */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2" data-testid="admin-tabs">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => { setActiveTab(tab.id); if (tab.id === "audit") fetchAuditLog(); }}
            className={`px-4 py-2 rounded-full text-sm font-bold transition-all whitespace-nowrap ${
              activeTab === tab.id
                ? isLcars ? "bg-[var(--lcars-orange)] text-black" : "bg-purple-600 text-white"
                : isLcars ? "bg-[var(--lcars-purple)]/20 text-[var(--lcars-purple)]" : "bg-purple-900/30 text-purple-400"
            }`}
            data-testid={`tab-${tab.id}`}
          >{tab.label}</button>
        ))}
      </div>

      {/* ==================== USERS TAB ==================== */}
      {activeTab === "users" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <span className={`text-sm ${isLcars ? "text-gray-400 tracking-wider" : "text-purple-300"}`}>
              {users.length} {isLcars ? "BENUTZER" : "Benutzer"}
            </span>
            <div className="flex-1" />
            <button onClick={() => { resetUserForm(); setShowCreateUser(true); }} className={`${btnClass} py-1 px-3 text-xs flex items-center gap-1`} data-testid="create-user-button">
              <Plus size={14} /> {isLcars ? "NEU" : "Neuer Benutzer"}
            </button>
          </div>

          {showCreateUser && (
            <div className={`${cardClass} mb-4`} data-testid="user-form">
              <h4 className={`text-xs font-bold mb-3 ${isLcars ? "text-[var(--lcars-orange)] tracking-wider" : "text-purple-200"}`}>
                {editingUser ? (isLcars ? "BENUTZER BEARBEITEN" : "Benutzer bearbeiten") : (isLcars ? "NEUER BENUTZER" : "Neuer Benutzer")}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                <input placeholder="Name" value={userForm.name} onChange={(e) => setUserForm({...userForm, name: e.target.value})} className={`${inputClass} w-full`} data-testid="new-user-name" />
                <input placeholder="E-Mail" value={userForm.email} onChange={(e) => setUserForm({...userForm, email: e.target.value})} disabled={!!editingUser} className={`${inputClass} w-full ${editingUser ? "opacity-50" : ""}`} data-testid="new-user-email" />
                <input type="password" placeholder={editingUser ? "Neues Passwort (leer = unverändert)" : "Passwort"} value={userForm.password} onChange={(e) => setUserForm({...userForm, password: e.target.value})} className={`${inputClass} w-full`} data-testid="new-user-password" />
                <select value={userForm.role} onChange={(e) => setUserForm({...userForm, role: e.target.value})} className={`${inputClass} w-full`} data-testid="new-user-role">
                  {ROLES.map(r => <option key={r.value} value={r.value}>{r.label} — {r.desc}</option>)}
                </select>
              </div>

              {/* Room Assignment */}
              <div className="mb-4">
                <label className={`block text-xs font-bold mb-2 ${isLcars ? "text-[var(--lcars-blue)] tracking-wider" : "text-purple-300"}`}>
                  {isLcars ? "ZUGEWIESENE RÄUME" : "Zugewiesene Räume"}
                </label>
                <div className="flex flex-wrap gap-2">
                  {rooms.map(r => (
                    <button key={r.id} onClick={() => toggleRoom(r.id)} type="button"
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all ${
                        userForm.assigned_rooms.includes(r.id)
                          ? isLcars ? "bg-[var(--lcars-orange)]/20 border border-[var(--lcars-orange)]/50 text-[var(--lcars-orange)]" : "bg-purple-600/30 border border-purple-500/50 text-purple-200"
                          : isLcars ? "bg-[#0a0a14] border border-gray-800 text-gray-500" : "bg-gray-900/30 border border-gray-700 text-gray-500"
                      }`}
                      data-testid={`assign-room-${r.id}`}
                    >
                      <House size={12} />
                      {r.name}
                      {userForm.assigned_rooms.includes(r.id) && <Check size={12} weight="bold" />}
                    </button>
                  ))}
                  {rooms.length === 0 && <span className="text-xs text-gray-600">Erstelle zuerst Räume im Tab "Räume"</span>}
                </div>
              </div>

              {/* Tab Visibility */}
              <div className="mb-4">
                <label className={`block text-xs font-bold mb-2 ${isLcars ? "text-[var(--lcars-mauve)] tracking-wider" : "text-purple-300"}`}>
                  {isLcars ? "SICHTBARE MENÜ-TABS" : "Sichtbare Menü-Tabs"}
                </label>
                <div className="flex flex-wrap gap-2">
                  {ALL_TABS.map(t => (
                    <button key={t.id} onClick={() => toggleTab(t.id)} type="button"
                      className={`px-3 py-1.5 rounded-lg text-xs transition-all ${
                        userForm.visible_tabs.includes(t.id)
                          ? isLcars ? "bg-[var(--lcars-mauve)]/20 border border-[var(--lcars-mauve)]/50 text-[var(--lcars-mauve)]" : "bg-indigo-600/30 border border-indigo-500/50 text-indigo-200"
                          : isLcars ? "bg-[#0a0a14] border border-gray-800 text-gray-500" : "bg-gray-900/30 border border-gray-700 text-gray-500"
                      }`}
                      data-testid={`assign-tab-${t.id}`}
                    >
                      {t.label}
                      {userForm.visible_tabs.includes(t.id) && <Check size={12} weight="bold" className="inline ml-1" />}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <button onClick={handleSaveUser} className={btnClass} data-testid="submit-create-user">
                  <Check size={14} className="inline mr-1" /> {editingUser ? "Speichern" : "Erstellen"}
                </button>
                <button onClick={resetUserForm} className="px-4 py-2 rounded text-gray-400 hover:bg-gray-800 text-sm">Abbrechen</button>
              </div>
            </div>
          )}

          {/* User List */}
          <div className="space-y-2">
            {users.map(u => {
              const userRooms = (u.assigned_rooms || []).map(rid => rooms.find(r => r.id === rid)?.name).filter(Boolean);
              return (
                <div key={u.id} className={`${cardClass} flex items-center gap-4`} data-testid={`user-row-${u.id}`}>
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${isLcars ? "bg-[var(--lcars-purple)]/20" : "bg-purple-800/40"}`}>
                    <User size={18} className={isLcars ? "text-[var(--lcars-purple)]" : "text-purple-400"} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm truncate">{u.name || u.email}</div>
                    <div className="text-xs text-gray-500">{u.email}</div>
                    {userRooms.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {userRooms.map(rn => (
                          <span key={rn} className={`text-[10px] px-1.5 py-0.5 rounded ${isLcars ? "bg-[var(--lcars-blue)]/15 text-[var(--lcars-blue)]" : "bg-blue-900/20 text-blue-400"}`}>{rn}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded tracking-wider flex-shrink-0 ${
                    u.role === "superadmin" ? (isLcars ? "bg-[var(--lcars-orange)]/20 text-[var(--lcars-orange)]" : "bg-purple-600/30 text-purple-300") :
                    u.role === "admin" ? (isLcars ? "bg-[var(--lcars-blue)]/20 text-[var(--lcars-blue)]" : "bg-blue-600/30 text-blue-300") :
                    u.role === "kind" ? (isLcars ? "bg-[var(--lcars-salmon)]/20 text-[var(--lcars-salmon)]" : "bg-pink-600/30 text-pink-300") :
                    isLcars ? "bg-gray-800 text-gray-400" : "bg-gray-700 text-gray-400"
                  }`}>{u.role}</span>
                  <button onClick={() => startEditUser(u)} className={`p-2 ${isLcars ? "text-[var(--lcars-blue)] hover:bg-[var(--lcars-blue)]/10" : "text-purple-400 hover:bg-purple-900/30"} rounded`} data-testid={`edit-user-${u.id}`}>
                    <PencilSimple size={16} />
                  </button>
                  {u.id !== user?.id && (
                    <button onClick={() => handleDeleteUser(u.id)} className="p-2 text-red-400 hover:bg-red-900/30 rounded" data-testid={`delete-user-${u.id}`}>
                      <Trash size={16} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ==================== ROOMS TAB ==================== */}
      {activeTab === "rooms" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <span className={`text-sm ${isLcars ? "text-gray-400 tracking-wider" : "text-purple-300"}`}>
              {rooms.length} {isLcars ? "RÄUME" : "Räume"} | {devices.length} {isLcars ? "GERÄTE" : "Geräte"}
            </span>
            <div className="flex-1" />
            <button onClick={() => setShowCreateRoom(true)} className={`${btnClass} py-1 px-3 text-xs flex items-center gap-1`} data-testid="create-room-btn">
              <Plus size={14} /> {isLcars ? "RAUM" : "Raum erstellen"}
            </button>
          </div>
          {showCreateRoom && (
            <div className={`${cardClass} mb-4`} data-testid="create-room-form">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                <input placeholder="Raumname..." value={newRoom.name} onChange={(e) => setNewRoom({...newRoom, name: e.target.value})} className={`${inputClass} w-full`} data-testid="room-name-input" />
                <select value={newRoom.icon} onChange={(e) => setNewRoom({...newRoom, icon: e.target.value})} className={`${inputClass} w-full`} data-testid="room-icon-select">
                  {ROOM_ICONS.map(i => <option key={i.id} value={i.id}>{i.label}</option>)}
                </select>
                <div className="flex gap-2">
                  <button onClick={handleCreateRoom} className={`${btnClass} flex-1`} data-testid="room-save-btn"><Check size={16} /></button>
                  <button onClick={() => setShowCreateRoom(false)} className="p-2 text-red-400 hover:bg-red-900/30 rounded"><X size={16} /></button>
                </div>
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {rooms.map(room => {
              const devCount = devices.filter(d => d.room_id === room.id).length;
              const assignedUsers = users.filter(u => (u.assigned_rooms || []).includes(room.id));
              return (
                <div key={room.id} className={cardClass} data-testid={`room-card-${room.id}`}>
                  <div className="flex items-center gap-3 mb-2">
                    <House size={24} className={isLcars ? "text-[var(--lcars-orange)]" : "text-purple-400"} />
                    <div className="flex-1">
                      <div className={`font-bold ${isLcars ? "tracking-wider text-sm" : ""}`}>{isLcars ? room.name.toUpperCase() : room.name}</div>
                      <div className="text-xs text-gray-500">{devCount} Geräte</div>
                    </div>
                    <button onClick={() => handleDeleteRoom(room.id)} className="p-2 text-red-400 hover:bg-red-900/30 rounded" data-testid={`delete-room-${room.id}`}>
                      <Trash size={16} />
                    </button>
                  </div>
                  {assignedUsers.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {assignedUsers.map(au => (
                        <span key={au.id} className={`text-[10px] px-1.5 py-0.5 rounded ${isLcars ? "bg-[var(--lcars-purple)]/15 text-[var(--lcars-purple)]" : "bg-purple-900/20 text-purple-400"}`}>
                          {au.name || au.email}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ==================== DEVICES TAB ==================== */}
      {activeTab === "devices" && (
        <div>
          <div className="flex items-center gap-3 mb-4">
            <span className={`text-sm ${isLcars ? "text-gray-400 tracking-wider" : "text-purple-300"}`}>{devices.length} {isLcars ? "GERÄTE" : "Geräte"}</span>
            <div className="flex-1" />
            {/* Room filter */}
            <select value={selectedRoom || ""} onChange={(e) => setSelectedRoom(e.target.value || null)} className={`${inputClass} text-xs w-40`} data-testid="device-room-filter">
              <option value="">Alle Räume</option>
              <option value="__unassigned">Nicht zugewiesen</option>
              {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            {devices
              .filter(d => !selectedRoom ? true : selectedRoom === "__unassigned" ? !d.room_id : d.room_id === selectedRoom)
              .map(dev => {
              const Icon = DOMAIN_ICONS[dev.domain] || Power;
              const room = rooms.find(r => r.id === dev.room_id);
              return (
                <div key={dev.entity_id} className={`flex items-center gap-3 p-3 rounded-lg ${isLcars ? "bg-[#0a0a14] border border-[var(--lcars-purple)]/20" : "bg-purple-950/30 border border-purple-800/20"}`} data-testid={`device-row-${dev.entity_id}`}>
                  <Icon size={20} className={dev.ha_state === "on" ? (isLcars ? "text-[var(--lcars-gold)]" : "text-yellow-400") : "text-gray-500"} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{dev.display_name}</div>
                    <div className="text-[10px] text-gray-500">{dev.entity_id} | {dev.domain}</div>
                  </div>
                  <button onClick={() => handleToggleCritical(dev.entity_id, dev.critical)}
                    className={`p-1.5 rounded transition-all ${dev.critical ? "bg-red-900/30 text-red-400" : "text-gray-600 hover:text-red-400"}`}
                    data-testid={`critical-${dev.entity_id}`}
                  >
                    {dev.critical ? <ShieldCheck size={16} weight="fill" /> : <Shield size={16} />}
                  </button>
                  <select value={dev.room_id || ""} onChange={(e) => handleAssignDevice(dev.entity_id, e.target.value || null)}
                    className={`text-xs ${inputClass} w-32`} data-testid={`device-room-${dev.entity_id}`}>
                    <option value="">Kein Raum</option>
                    {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>
              );
            })}
            {devices.length === 0 && (
              <div className="text-center py-12 text-gray-500">
                Keine Geräte. Synchronisiere zuerst mit Home Assistant.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== PERMISSIONS TAB ==================== */}
      {activeTab === "permissions" && (
        <div>
          <div className={`mb-4 p-3 rounded-lg text-xs ${isLcars ? "bg-[#0a0a14] border border-[var(--lcars-purple)]/20 text-gray-400" : "bg-purple-950/30 border border-purple-800/30 text-purple-300"}`}>
            {isLcars ? "ERWEITERTE GERÄTE-FREIGABEN — ÜBERSCHREIBT RAUM-ZUWEISUNGEN PRO GERÄT" : "Erweiterte Geräte-Freigaben — Überschreibt Raum-Zuweisungen pro Gerät"}
          </div>
          <div className="flex gap-3 mb-6 flex-wrap">
            {users.map(u => (
              <button key={u.id} onClick={() => loadPermissions(u.id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all ${
                  selectedUser === u.id
                    ? isLcars ? "bg-[var(--lcars-orange)]/15 border border-[var(--lcars-orange)]/40 text-[var(--lcars-orange)]" : "bg-purple-600/20 border border-purple-500/40 text-purple-200"
                    : isLcars ? "bg-[#0a0a14] border border-[var(--lcars-purple)]/20 text-gray-400" : "bg-purple-950/30 border border-purple-800/20 text-purple-400"
                }`}
                data-testid={`perm-user-${u.id}`}
              >
                <User size={16} />
                <div>
                  <div className="font-bold text-xs">{u.name || u.email}</div>
                  <div className="text-[10px] opacity-60">{u.role}</div>
                </div>
              </button>
            ))}
          </div>
          {selectedUser && selectedUserObj && (
            <div>
              <div className={`mb-4 text-sm ${isLcars ? "text-[var(--lcars-orange)] tracking-wider" : "text-purple-200 font-bold"}`}>
                {isLcars ? `FREIGABEN FÜR ${(selectedUserObj.name || selectedUserObj.email).toUpperCase()}` : `Freigaben für ${selectedUserObj.name || selectedUserObj.email}`}
              </div>
              {rooms.map(room => {
                const roomDevs = devices.filter(d => d.room_id === room.id);
                if (roomDevs.length === 0) return null;
                return (
                  <div key={room.id} className={`${cardClass} mb-4`}>
                    <div className="flex items-center gap-3 mb-3">
                      <House size={18} className={isLcars ? "text-[var(--lcars-orange)]" : "text-purple-400"} />
                      <span className={`font-bold text-sm ${isLcars ? "tracking-wider" : ""}`}>{isLcars ? room.name.toUpperCase() : room.name}</span>
                      <span className="text-xs text-gray-500">{roomDevs.length} Geräte</span>
                      <div className="flex-1" />
                      <button onClick={() => handleBulkPermission(room.id, { visible: true, controllable: true, automation_allowed: false, voice_allowed: true })}
                        className={`text-[10px] px-2 py-1 rounded ${isLcars ? "bg-green-900/30 text-green-400" : "bg-green-900/20 text-green-400"}`}>Alle freigeben</button>
                      <button onClick={() => handleBulkPermission(room.id, { visible: false, controllable: false, automation_allowed: false, voice_allowed: false })}
                        className={`text-[10px] px-2 py-1 rounded ${isLcars ? "bg-red-900/30 text-red-400" : "bg-red-900/20 text-red-400"}`}>Alle sperren</button>
                    </div>
                    <div className="grid grid-cols-[1fr,60px,60px,60px,60px] gap-2 mb-2 text-[10px] text-gray-500 px-2">
                      <div>{isLcars ? "GERÄT" : "Gerät"}</div>
                      <div className="text-center">{isLcars ? "SICHT" : "Sicht"}</div>
                      <div className="text-center">{isLcars ? "STEUER" : "Steuer"}</div>
                      <div className="text-center">{isLcars ? "AUTO" : "Auto"}</div>
                      <div className="text-center">{isLcars ? "VOICE" : "Voice"}</div>
                    </div>
                    {roomDevs.map(dev => {
                      const perm = permMap[dev.entity_id] || {};
                      const Icon = DOMAIN_ICONS[dev.domain] || Power;
                      return (
                        <div key={dev.entity_id} className={`grid grid-cols-[1fr,60px,60px,60px,60px] gap-2 items-center px-2 py-1.5 rounded ${isLcars ? "hover:bg-[#0a0a14]" : "hover:bg-purple-950/30"}`} data-testid={`perm-row-${dev.entity_id}`}>
                          <div className="flex items-center gap-2 min-w-0">
                            <Icon size={14} className="text-gray-500 flex-shrink-0" />
                            <span className="text-xs truncate">{dev.display_name}</span>
                            {dev.critical && <Shield size={10} className="text-red-400 flex-shrink-0" />}
                          </div>
                          {["visible", "controllable", "automation_allowed", "voice_allowed"].map(field => (
                            <div key={field} className="flex justify-center">
                              <button onClick={() => handleSetPermission(dev.entity_id, field, !perm[field])}
                                className={`w-8 h-8 rounded flex items-center justify-center transition-all ${perm[field] ? isLcars ? "bg-green-900/30 text-green-400" : "bg-green-900/20 text-green-400" : "text-gray-600 hover:text-gray-400"}`}
                                data-testid={`perm-${field}-${dev.entity_id}`}
                              >
                                {perm[field] ? <Check size={14} weight="bold" /> : <X size={14} />}
                              </button>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
          {!selectedUser && <div className="text-center py-12 text-gray-500">{isLcars ? "BENUTZER AUSWÄHLEN" : "Wähle einen Benutzer"}</div>}
        </div>
      )}

      {/* ==================== PROFILES TAB ==================== */}
      {activeTab === "profiles" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <span className={`text-sm ${isLcars ? "text-gray-400 tracking-wider" : "text-purple-300"}`}>{profiles.length} {isLcars ? "PROFILE" : "Profile"}</span>
            <div className="flex-1" />
            <button onClick={() => setShowCreateProfile(true)} className={`${btnClass} py-1 px-3 text-xs flex items-center gap-1`} data-testid="create-profile-btn">
              <Plus size={14} /> {isLcars ? "PROFIL" : "Profil erstellen"}
            </button>
          </div>
          {showCreateProfile && (
            <div className={`${cardClass} mb-4`} data-testid="create-profile-form">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                <input placeholder="Profilname (z.B. Kinderzimmer Tablet)" value={newProfile.name} onChange={(e) => setNewProfile({...newProfile, name: e.target.value})} className={`${inputClass} w-full`} data-testid="profile-name" />
                <select value={newProfile.room_id} onChange={(e) => setNewProfile({...newProfile, room_id: e.target.value})} className={`${inputClass} w-full`} data-testid="profile-room">
                  <option value="">Raum wählen...</option>
                  {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                <select value={newProfile.user_id} onChange={(e) => setNewProfile({...newProfile, user_id: e.target.value})} className={`${inputClass} w-full`} data-testid="profile-user">
                  <option value="">Benutzer zuweisen...</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name || u.email} ({u.role})</option>)}
                </select>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={newProfile.kiosk_mode} onChange={(e) => setNewProfile({...newProfile, kiosk_mode: e.target.checked})} className="w-4 h-4 accent-orange-500" />
                    <span className="text-xs">{isLcars ? "KIOSK" : "Kiosk-Modus"}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={newProfile.child_mode} onChange={(e) => setNewProfile({...newProfile, child_mode: e.target.checked})} className="w-4 h-4 accent-purple-500" />
                    <span className="text-xs">{isLcars ? "KIND" : "Kindermodus"}</span>
                  </label>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={async () => {
                  if (!newProfile.name || !newProfile.room_id) return toast.error("Name und Raum eingeben");
                  try {
                    await axios.post(`${API}/smarthome/profiles`, newProfile);
                    toast.success("Profil erstellt");
                    setShowCreateProfile(false);
                    setNewProfile({ name: "", room_id: "", user_id: "", kiosk_mode: false, child_mode: false });
                    fetchAll();
                  } catch { toast.error("Fehler"); }
                }} className={btnClass} data-testid="profile-save"><Check size={14} className="inline mr-1" /> Erstellen</button>
                <button onClick={() => setShowCreateProfile(false)} className="px-4 py-2 text-gray-400 hover:bg-gray-800 rounded text-sm">Abbrechen</button>
              </div>
            </div>
          )}
          <div className="space-y-3">
            {profiles.map(p => {
              const room = rooms.find(r => r.id === p.room_id);
              const assignedUser = users.find(u => u.id === p.user_id);
              return (
                <div key={p.id} className={cardClass} data-testid={`profile-${p.id}`}>
                  <div className="flex items-center gap-3">
                    <House size={20} className={isLcars ? "text-[var(--lcars-orange)]" : "text-purple-400"} />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`font-bold text-sm ${isLcars ? "tracking-wider" : ""}`}>{isLcars ? p.name.toUpperCase() : p.name}</span>
                        {p.kiosk_mode && <span className="text-[10px] px-2 py-0.5 rounded bg-amber-900/30 text-amber-400 font-bold">KIOSK</span>}
                        {p.child_mode && <span className="text-[10px] px-2 py-0.5 rounded bg-purple-900/30 text-purple-400 font-bold">KIND</span>}
                      </div>
                      <div className="text-xs text-gray-500">Raum: {room?.name || "?"} | Benutzer: {assignedUser?.name || assignedUser?.email || "Nicht zugewiesen"}</div>
                    </div>
                    <a href={`/kiosk?profile=${p.id}`} target="_blank" className={`text-xs px-3 py-1 rounded ${isLcars ? "bg-[var(--lcars-blue)]/20 text-[var(--lcars-blue)]" : "bg-purple-900/30 text-purple-400"}`} data-testid={`preview-profile-${p.id}`}>
                      {isLcars ? "VORSCHAU" : "Vorschau"}
                    </a>
                    <button onClick={async () => {
                      try { await axios.delete(`${API}/smarthome/profiles/${p.id}`); toast.success("Gelöscht"); fetchAll(); } catch { toast.error("Fehler"); }
                    }} className="p-2 text-red-400 hover:bg-red-900/30 rounded" data-testid={`delete-profile-${p.id}`}>
                      <Trash size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
            {profiles.length === 0 && <div className="text-center py-8 text-gray-500">Keine Profile erstellt</div>}
          </div>
        </div>
      )}

      {/* ==================== AUDIT TAB ==================== */}
      {activeTab === "audit" && (
        <div>
          <div className="flex items-center gap-3 mb-4">
            <span className={`text-sm ${isLcars ? "text-gray-400 tracking-wider" : "text-purple-300"}`}>{isLcars ? "AKTIVITÄTSPROTOKOLL" : "Aktivitätsprotokoll"}</span>
            <div className="flex-1" />
            <button onClick={fetchAuditLog} className={`${btnClass} py-1 px-3 text-xs`} data-testid="audit-refresh"><ArrowClockwise size={14} /></button>
          </div>
          {auditLogs.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              <button onClick={fetchAuditLog} className={btnClass}>{isLcars ? "LOGS LADEN" : "Logs laden"}</button>
            </div>
          )}
          <div className="space-y-2 max-h-[600px] overflow-y-auto">
            {auditLogs.map((log, i) => (
              <div key={i} className={`flex items-center gap-3 p-3 rounded-lg text-sm ${isLcars ? "bg-[#0a0a14] border border-[var(--lcars-purple)]/20" : "bg-purple-950/30 border border-purple-800/20"}`} data-testid={`audit-entry-${i}`}>
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  log.type === "ha_command" || log.type === "device_control" ? "bg-green-500"
                  : log.type === "ha_denied" ? "bg-red-500"
                  : log.type === "ha_sync" ? "bg-blue-500"
                  : log.type === "permission_changed" ? "bg-yellow-500"
                  : "bg-gray-500"
                }`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`font-bold text-xs ${log.type === "ha_denied" ? "text-red-400" : isLcars ? "text-[var(--lcars-orange)]" : "text-purple-200"}`}>
                      {log.type === "ha_command" ? "Befehl" : log.type === "ha_denied" ? "Verweigert" : log.type === "device_control" ? "Gesteuert" : log.type === "permission_changed" ? "Freigabe" : log.type === "room_created" ? "Raum" : log.type === "ha_sync" ? "Sync" : log.type}
                    </span>
                    {log.user_email && <span className="text-xs text-gray-500">{log.user_email}</span>}
                  </div>
                  <div className="text-xs text-gray-500 truncate">
                    {log.entity_id && <span>{log.entity_id} </span>}
                    {log.command && <span>"{log.command}" </span>}
                    {log.service && <span>({log.service}) </span>}
                    {log.reason && <span className="text-red-400">[{log.reason}] </span>}
                    {log.imported && <span>{log.imported} importiert</span>}
                  </div>
                </div>
                <div className="text-[10px] text-gray-600 whitespace-nowrap">{log.timestamp ? new Date(log.timestamp).toLocaleString('de-DE') : ""}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ==================== SERVICES TAB ==================== */}
      {activeTab === "services" && (
        <div className="space-y-2">
          {services.map(s => (
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
          {services.length === 0 && <div className="text-center py-12 text-gray-500">Keine Dienste konfiguriert</div>}
        </div>
      )}

      {/* ==================== SETTINGS TAB ==================== */}
      {activeTab === "settings" && (
        <div className="space-y-6">
          {/* AI Config */}
          <div className={cardClass} data-testid="settings-api-key">
            <div className="flex items-center gap-3 mb-4">
              <Gear size={20} className={isLcars ? "text-[var(--lcars-orange)]" : "text-purple-400"} />
              <h3 className={`text-sm ${isLcars ? "tracking-widest text-[var(--lcars-orange)]" : "font-bold text-purple-200"}`}>{isLcars ? "KI-KONFIGURATION" : "KI-Konfiguration"}</h3>
            </div>
            <div className="space-y-3">
              <div>
                <label className={`block text-xs mb-1 ${isLcars ? "text-gray-400 tracking-wider" : "text-purple-300"}`}>{isLcars ? "AKTUELLER KEY" : "Aktueller Key"}</label>
                <div className={`p-2 rounded text-sm ${isLcars ? "bg-[#0a0a14] text-gray-400 border border-[var(--lcars-purple)]/30" : "bg-purple-950/50 text-purple-300"}`}>
                  {settings.openai_api_key || "Nicht konfiguriert"}
                </div>
              </div>
              <div className="relative">
                <input type={showApiKey ? "text" : "password"} value={apiKeyInput} onChange={(e) => setApiKeyInput(e.target.value)} placeholder="sk-..." className={`${inputClass} w-full pr-10`} data-testid="api-key-input" />
                <button onClick={() => setShowApiKey(!showApiKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">
                  {showApiKey ? <EyeSlash size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
          </div>

          {/* Weather Config */}
          <div className={cardClass} data-testid="settings-weather">
            <div className="flex items-center gap-3 mb-4">
              <Gear size={20} className={isLcars ? "text-[var(--lcars-blue)]" : "text-blue-400"} />
              <h3 className={`text-sm ${isLcars ? "tracking-widest text-[var(--lcars-blue)]" : "font-bold text-purple-200"}`}>{isLcars ? "WETTER" : "Wetter-Konfiguration"}</h3>
            </div>
            <div className="space-y-3">
              <input type="text" value={weatherCity} onChange={(e) => setWeatherCity(e.target.value)} placeholder={settings.weather_city || "z.B. Holderbank,CH"} className={`${inputClass} w-full`} data-testid="weather-city-input" />
              {settings.weather_city && <span className="text-xs text-gray-500">Aktuell: {settings.weather_city}</span>}
              <input type="password" value={weatherApiKey} onChange={(e) => setWeatherApiKey(e.target.value)} placeholder="Wetter API-Key..." className={`${inputClass} w-full`} data-testid="weather-api-key-input" />
            </div>
          </div>

          {/* HA Config */}
          <div className={cardClass} data-testid="settings-ha">
            <div className="flex items-center gap-3 mb-4">
              <Gear size={20} className={isLcars ? "text-[var(--lcars-salmon)]" : "text-green-400"} />
              <h3 className={`text-sm ${isLcars ? "tracking-widest text-[var(--lcars-salmon)]" : "font-bold text-purple-200"}`}>{isLcars ? "HOME ASSISTANT" : "Home Assistant"}</h3>
              {haStatus && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${haStatus.connected ? "bg-green-900/50 text-green-400" : "bg-red-900/50 text-red-400"}`}>
                  {haStatus.connected ? "VERBUNDEN" : "OFFLINE"}
                </span>
              )}
            </div>
            <div className="space-y-3">
              <input type="text" value={haUrl} onChange={(e) => setHaUrl(e.target.value)} placeholder={settings.ha_url || "http://192.168.1.140:8123"} className={`${inputClass} w-full`} data-testid="ha-url-input" />
              {settings.ha_url && <span className="text-xs text-gray-500">Aktuell: {settings.ha_url}</span>}
              <div className={`p-2 rounded text-sm ${isLcars ? "bg-[#0a0a14] text-gray-400 border border-[var(--lcars-purple)]/30" : "bg-purple-950/50 text-purple-300"}`}>
                {settings.ha_token || "Token nicht konfiguriert"}
              </div>
              <input type="password" value={haToken} onChange={(e) => setHaToken(e.target.value)} placeholder="eyJhb..." className={`${inputClass} w-full`} data-testid="ha-token-input" />
              <button onClick={checkHaStatus} disabled={haTesting} className={`${btnClass} text-xs flex items-center gap-2`} data-testid="ha-test-button">
                {haTesting ? <ArrowClockwise size={14} className="animate-spin" /> : null}
                {haTesting ? (isLcars ? "TESTE..." : "Teste...") : (isLcars ? "VERBINDUNG TESTEN" : "Verbindung testen")}
              </button>
              {haStatus && !haTesting && (
                <div className={`p-3 rounded-lg text-sm font-bold ${haStatus.connected ? "bg-green-900/30 text-green-400 border border-green-800/40" : "bg-red-900/30 text-red-400 border border-red-800/40"}`} data-testid="ha-test-result">
                  {haStatus.connected ? "Verbindung erfolgreich!" : `Nicht erreichbar: ${haStatus.message || "Offline"}`}
                </div>
              )}
            </div>
          </div>

          {/* Save Result Banner */}
          {saveResult && (
            <div className={`p-4 rounded-lg text-sm font-bold text-center ${saveResult.type === "success" ? "bg-green-900/30 text-green-400 border border-green-800/40" : "bg-red-900/30 text-red-400 border border-red-800/40"}`} data-testid="save-result-banner">
              {saveResult.type === "success" ? <Check size={18} weight="bold" className="inline mr-2" /> : <X size={18} weight="bold" className="inline mr-2" />}
              {saveResult.msg}
            </div>
          )}

          <button onClick={handleSaveSettings} disabled={saving} className={`${btnClass} w-full flex items-center justify-center gap-2`} data-testid="save-all-settings-button">
            {saving ? <ArrowClockwise size={16} className="animate-spin" /> : null}
            {saving ? (isLcars ? "SPEICHERE..." : "Speichere...") : (isLcars ? "ALLE EINSTELLUNGEN SPEICHERN" : "Alle Einstellungen speichern")}
          </button>
        </div>
      )}
    </div>
  );
};

export default Admin;

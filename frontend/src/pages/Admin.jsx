import { useState, useEffect, useCallback } from "react";
import { useAuth, useTheme, API, formatApiError } from "@/App";
import axios from "axios";
import { toast } from "sonner";
import {
  Plus, Trash, PencilSimple, Check, X, House, Lightbulb, Power,
  ArrowClockwise, Shield, ShieldCheck, Eye, EyeSlash, Gear,
  User, HardDrives, LockSimple, ArrowsVertical, Thermometer,
  VideoCamera, SpeakerHigh, Fan, Robot, MagicWand, Lightning,
  ClockCounterClockwise
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
  { id: "home", label: "SmartHome" },
  { id: "health", label: "System Health" },
  { id: "chat", label: "Chat" },
  { id: "weather", label: "Wetter" },
  { id: "media", label: "Mediathek" },
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
  const { user, refreshGlobalDefaultTheme } = useAuth();
  const { theme, availableThemes } = useTheme();
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

  // SmartHome Builder
  const [builderUser, setBuilderUser] = useState(null);
  const [builderConfig, setBuilderConfig] = useState({});
  const [builderSaving, setBuilderSaving] = useState(false);

  // Service Registry (GPT Router)
  const [registry, setRegistry] = useState([]);
  const [registryLoading, setRegistryLoading] = useState(false);
  const [regEditing, setRegEditing] = useState(null);
  const [regForm, setRegForm] = useState({ service_id: "", name: "", description: "", capabilities: "", example_queries: "", type: "custom" });
  const [showCreateReg, setShowCreateReg] = useState(false);
  const [routerHistory, setRouterHistory] = useState([]);

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
  // CaseDesk
  const [cdUrl, setCdUrl] = useState("");
  const [cdEmail, setCdEmail] = useState("");
  const [cdPassword, setCdPassword] = useState("");
  const [cdStatus, setCdStatus] = useState(null);
  const [cdTesting, setCdTesting] = useState(false);
  // Voice
  const [defaultVoice, setDefaultVoice] = useState("nova");
  // Telegram
  const [telegramToken, setTelegramToken] = useState("");
  const [telegramStatus, setTelegramStatus] = useState(null);
  const [telegramTestResult, setTelegramTestResult] = useState(null);
  const [telegramTesting, setTelegramTesting] = useState(false);
  // Plex
  const [plexUrl, setPlexUrl] = useState("");
  const [plexToken, setPlexToken] = useState("");
  const [plexStatus, setPlexStatus] = useState(null);
  const [plexTesting, setPlexTesting] = useState(false);

  const VOICE_OPTIONS = [
    { id: "alloy", name: "Alloy", desc: "Neutral, freundlich" },
    { id: "echo", name: "Echo", desc: "Warm, männlich" },
    { id: "fable", name: "Fable", desc: "Erzählerisch, märchenhaft" },
    { id: "nova", name: "Nova", desc: "Klar, weiblich" },
    { id: "onyx", name: "Onyx", desc: "Tief, autoritär" },
    { id: "shimmer", name: "Shimmer", desc: "Sanft, beruhigend" },
  ];

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
      const s = settingsR.data;
      setSettings(s);
      // Pre-fill non-sensitive settings
      if (s.ha_url) setHaUrl(s.ha_url);
      if (s.weather_city) setWeatherCity(s.weather_city);
      if (s.casedesk_url) setCdUrl(s.casedesk_url);
      if (s.casedesk_email) setCdEmail(s.casedesk_email);
      if (s.default_voice) setDefaultVoice(s.default_voice);
      if (s.telegram_bot_token) setTelegramToken(s.telegram_bot_token);
      if (s.plex_url) setPlexUrl(s.plex_url);
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const fetchAuditLog = async () => {
    try {
      const { data } = await axios.get(`${API}/audit-log?limit=50`);
      setAuditLogs(data);
    } catch {}
  };

  const fetchRegistry = async () => {
    setRegistryLoading(true);
    try {
      const { data } = await axios.get(`${API}/admin/service-registry`);
      setRegistry(data.services || []);
    } catch { setRegistry([]); }
    finally { setRegistryLoading(false); }
    // Also fetch router history for inspection
    try {
      const { data } = await axios.get(`${API}/admin/router-history?limit=30`);
      setRouterHistory(data || []);
    } catch { setRouterHistory([]); }
  };

  const clearRouterHistory = async () => {
    if (!window.confirm("Router-Historie wirklich löschen?")) return;
    try {
      await axios.delete(`${API}/admin/router-history`);
      setRouterHistory([]);
      toast.success("Router-Historie gelöscht");
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const saveRegistryOverride = async (service_id, payload) => {
    try {
      await axios.put(`${API}/admin/service-registry/${service_id}`, payload);
      toast.success("Dienst-Beschreibung gespeichert");
      fetchRegistry();
      setRegEditing(null);
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const createRegistryCustom = async () => {
    const payload = {
      service_id: regForm.service_id.trim().toLowerCase(),
      name: regForm.name.trim(),
      description: regForm.description.trim(),
      capabilities: regForm.capabilities.split(",").map(s => s.trim()).filter(Boolean),
      example_queries: regForm.example_queries.split("\n").map(s => s.trim()).filter(Boolean),
      type: regForm.type,
      is_active: true,
    };
    if (!payload.service_id || !payload.name) {
      toast.error("ID und Name sind Pflicht");
      return;
    }
    try {
      await axios.post(`${API}/admin/service-registry`, payload);
      toast.success("Dienst hinzugefügt");
      setShowCreateReg(false);
      setRegForm({ service_id: "", name: "", description: "", capabilities: "", example_queries: "", type: "custom" });
      fetchRegistry();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const deleteRegistryEntry = async (service_id, is_custom) => {
    if (!window.confirm(is_custom ? "Custom-Dienst wirklich löschen?" : "Zurücksetzen auf Standard?")) return;
    try {
      await axios.delete(`${API}/admin/service-registry/${service_id}`);
      toast.success(is_custom ? "Gelöscht" : "Auf Standard zurückgesetzt");
      fetchRegistry();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const refreshTelegramStatus = async () => {
    try {
      const { data } = await axios.get(`${API}/admin/telegram/status`);
      setTelegramStatus(data);
    } catch {}
  };

  const testTelegram = async () => {
    setTelegramTesting(true);
    setTelegramTestResult(null);
    try {
      // If user typed a new token, test against that (without saving). Otherwise test saved token.
      const looksLikeRealToken = telegramToken && !telegramToken.includes("...") && telegramToken.length > 20;
      const body = looksLikeRealToken ? { token: telegramToken } : {};
      const { data } = await axios.post(`${API}/admin/telegram/test`, body);
      setTelegramTestResult(data);
      if (data.ok) toast.success(data.message);
      else toast.error(data.message);
      await refreshTelegramStatus();
    } catch (e) {
      setTelegramTestResult({ ok: false, message: formatApiError(e) });
      toast.error(formatApiError(e));
    } finally { setTelegramTesting(false); }
  };

  const restartTelegram = async () => {
    setTelegramTesting(true);
    try {
      const { data } = await axios.post(`${API}/admin/telegram/restart`);
      toast.success("Bot neu gestartet");
      setTelegramStatus(data.status);
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setTelegramTesting(false); }
  };

  const clearPlexCache = async () => {
    if (!window.confirm("Thumbnail-Cache leeren? Alle Browser müssen die Bilder neu laden.")) return;
    try {
      await axios.post(`${API}/plex/cache-clear`);
      toast.success("Plex Thumbnail-Cache geleert — Seite neu laden um Effekt zu sehen");
    } catch (e) { toast.error(formatApiError(e)); }
  };

  // ========== Default Theme ==========
  const [defaultTheme, setDefaultTheme] = useState("startrek");
  const [defaultThemeLoaded, setDefaultThemeLoaded] = useState(false);

  const loadDefaultTheme = async () => {
    try {
      const { data } = await axios.get(`${API}/settings/default-theme`);
      setDefaultTheme(data?.theme || "startrek");
      setDefaultThemeLoaded(true);
    } catch {}
  };

  const saveDefaultTheme = async (t) => {
    try {
      await axios.put(`${API}/admin/default-theme`, { theme: t });
      setDefaultTheme(t);
      toast.success(`Standard-Theme: ${availableThemes.find(a => a.id === t)?.label || t}`);
      if (refreshGlobalDefaultTheme) refreshGlobalDefaultTheme();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  useEffect(() => { if (activeTab === "settings" && !defaultThemeLoaded) loadDefaultTheme(); }, [activeTab, defaultThemeLoaded]);

  // ========== Settings Backup / Diagnose ==========
  const [settingsDiag, setSettingsDiag] = useState(null);

  const loadSettingsDiag = async () => {
    try {
      const { data } = await axios.get(`${API}/admin/settings-diagnosis`);
      setSettingsDiag(data);
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const exportSettings = async (includeSecrets) => {
    try {
      const { data } = await axios.get(`${API}/admin/settings-export?include_secrets=${includeSecrets}`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `aria-settings-${includeSecrets ? "full" : "redacted"}-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(includeSecrets ? "Export mit Keys heruntergeladen — sicher aufbewahren!" : "Export (ohne Secrets) heruntergeladen");
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const importSettings = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!window.confirm(`Settings aus ${file.name} importieren? Vorhandene Keys werden überschrieben.`)) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const { data } = await axios.post(`${API}/admin/settings-import`, parsed);
      toast.success(`${data.imported} importiert, ${data.skipped} übersprungen (redacted)`);
      fetchSettings();
      loadSettingsDiag();
    } catch (e) { toast.error(formatApiError(e) || "Import fehlgeschlagen"); }
    event.target.value = "";
  };

  const checkHaStatus = async (silent = false) => {
    if (!silent) setHaTesting(true);
    try {
      const { data } = await axios.get(`${API}/ha/status`);
      setHaStatus(data);
      if (!silent) {
        if (data.connected) {
          toast.success("Home Assistant verbunden!");
        } else {
          toast.error(data.message || "Home Assistant nicht erreichbar");
        }
      }
    } catch (e) {
      setHaStatus(null);
      if (!silent) toast.error("Verbindungstest fehlgeschlagen");
    } finally {
      if (!silent) setHaTesting(false);
    }
  };

  // Silent auto-check on page load
  useEffect(() => { checkHaStatus(true); checkCdStatus(true); checkPlexStatus(true); refreshTelegramStatus(); }, [settings]);

  const checkPlexStatus = async (silent = false) => {
    if (!silent) setPlexTesting(true);
    try {
      const { data } = await axios.get(`${API}/plex/status`);
      setPlexStatus(data);
      if (!silent) {
        if (data.connected) toast.success(`Plex verbunden: ${data.name}`);
        else toast.error("Plex nicht erreichbar");
      }
    } catch { setPlexStatus(null); if (!silent) toast.error("Plex-Test fehlgeschlagen"); }
    finally { if (!silent) setPlexTesting(false); }
  };

  const checkCdStatus = async (silent = false) => {
    if (!silent) setCdTesting(true);
    try {
      const { data } = await axios.get(`${API}/casedesk/status`);
      setCdStatus(data);
      if (!silent) {
        if (data.connected) toast.success("CaseDesk verbunden!");
        else toast.error(data.message || "CaseDesk nicht erreichbar");
      }
    } catch { setCdStatus(null); if (!silent) toast.error("CaseDesk-Test fehlgeschlagen"); }
    finally { if (!silent) setCdTesting(false); }
  };

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
    if (cdUrl) payload.casedesk_url = cdUrl;
    if (cdEmail) payload.casedesk_email = cdEmail;
    if (cdPassword) payload.casedesk_password = cdPassword;
    if (defaultVoice) payload.default_voice = defaultVoice;
    if (telegramToken) payload.telegram_bot_token = telegramToken;
    if (plexUrl) payload.plex_url = plexUrl;
    if (plexToken) payload.plex_token = plexToken;
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
      if (payload.casedesk_url) saved.push("CaseDesk URL");
      if (payload.casedesk_email) saved.push("CaseDesk E-Mail");
      if (payload.casedesk_password) saved.push("CaseDesk Passwort");
      if (payload.default_voice) saved.push("Standard-Stimme");
      if (payload.telegram_bot_token) saved.push("Telegram Bot");
      if (payload.plex_url) saved.push("Plex URL");
      if (payload.plex_token) saved.push("Plex Token");
      const msg = `Gespeichert: ${saved.join(", ")}`;
      toast.success(msg);
      setSaveResult({ type: "success", msg });
      setApiKeyInput(""); setWeatherApiKey(""); setHaToken(""); setCdPassword("");
      fetchAll();
      if (payload.ha_url || payload.ha_token) {
        setTimeout(() => checkHaStatus(false), 500);
      }
      if (payload.casedesk_url || payload.casedesk_email || payload.casedesk_password) {
        setTimeout(() => checkCdStatus(false), 500);
      }
      if (payload.plex_url || payload.plex_token) {
        setTimeout(() => checkPlexStatus(false), 500);
      }
    } catch (e) {
      const detail = e.response?.data?.detail || e.message || "Unbekannter Fehler";
      const msg = `Fehler beim Speichern: ${detail}`;
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

  // SmartHome Builder handlers
  const loadBuilderConfig = async (userId) => {
    setBuilderUser(userId);
    try {
      const { data } = await axios.get(`${API}/smarthome/builder/${userId}`);
      setBuilderConfig(data.config || {});
    } catch { setBuilderConfig({}); }
  };

  const toggleBuilderEntity = (roomId, entityId) => {
    const roomKey = roomId || "__unassigned";
    const current = builderConfig[roomKey] || [];
    const updated = current.includes(entityId)
      ? current.filter(e => e !== entityId)
      : [...current, entityId];
    setBuilderConfig({ ...builderConfig, [roomKey]: updated });
  };

  const selectAllInRoom = (roomId) => {
    const roomKey = roomId || "__unassigned";
    const roomDevs = devices.filter(d => (d.room_id || "__unassigned") === roomKey);
    setBuilderConfig({ ...builderConfig, [roomKey]: roomDevs.map(d => d.entity_id) });
  };

  const deselectAllInRoom = (roomId) => {
    const roomKey = roomId || "__unassigned";
    setBuilderConfig({ ...builderConfig, [roomKey]: [] });
  };

  const saveBuilderConfig = async () => {
    if (!builderUser) return;
    setBuilderSaving(true);
    try {
      await axios.put(`${API}/smarthome/builder/${builderUser}`, { config: builderConfig });
      toast.success("SmartHome-Konfiguration gespeichert");
    } catch (e) { toast.error("Fehler beim Speichern"); }
    finally { setBuilderSaving(false); }
  };

  const isEntitySelected = (roomId, entityId) => {
    const roomKey = roomId || "__unassigned";
    return (builderConfig[roomKey] || []).includes(entityId);
  };

  const getBuilderUserObj = users.find(u => u.id === builderUser);
  const builderSelectedCount = Object.values(builderConfig).flat().length;

  const tabs = [
    { id: "users", label: isLcars ? "BENUTZER" : "Benutzer" },
    { id: "rooms", label: isLcars ? "RÄUME" : "Räume" },
    { id: "devices", label: isLcars ? "GERÄTE" : "Geräte" },
    { id: "builder", label: isLcars ? "SH-BUILDER" : "SmartHome Builder" },
    { id: "permissions", label: isLcars ? "FREIGABEN" : "Freigaben" },
    { id: "profiles", label: isLcars ? "PROFILE" : "Profile" },
    { id: "audit", label: isLcars ? "AUDIT-LOG" : "Audit-Log" },
    { id: "services", label: isLcars ? "DIENSTE" : "Dienste" },
    { id: "router", label: isLcars ? "KI-ROUTER" : "KI-Router" },
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
          <button key={tab.id} onClick={() => { setActiveTab(tab.id); if (tab.id === "audit") fetchAuditLog(); if (tab.id === "router") fetchRegistry(); if (tab.id === "settings") loadSettingsDiag(); }}
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


      {/* ==================== SMARTHOME BUILDER TAB ==================== */}
      {activeTab === "builder" && (
        <div>
          <div className={`mb-4 p-3 rounded-lg text-xs ${isLcars ? "bg-[#0a0a14] border border-[var(--lcars-orange)]/20 text-gray-400" : "bg-purple-950/30 border border-purple-800/30 text-purple-300"}`}>
            {isLcars ? "SMARTHOME SEITEN-BUILDER — LEGE PRO BENUTZER FEST WELCHE GERÄTE/WIDGETS AUF DER SMARTHOME-SEITE ANGEZEIGT WERDEN." : "SmartHome Seiten-Builder — Lege pro Benutzer fest welche Geräte/Widgets auf der SmartHome-Seite angezeigt werden."}
          </div>

          {/* User Selection */}
          <div className="flex gap-3 mb-6 flex-wrap">
            {users.map(u => (
              <button key={u.id} onClick={() => loadBuilderConfig(u.id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all ${
                  builderUser === u.id
                    ? isLcars ? "bg-[var(--lcars-orange)]/15 border border-[var(--lcars-orange)]/40 text-[var(--lcars-orange)]" : "bg-purple-600/20 border border-purple-500/40 text-purple-200"
                    : isLcars ? "bg-[#0a0a14] border border-[var(--lcars-purple)]/20 text-gray-400" : "bg-purple-950/30 border border-purple-800/20 text-purple-400"
                }`}
                data-testid={`builder-user-${u.id}`}
              >
                <User size={16} />
                <div>
                  <div className="font-bold text-xs">{u.name || u.email}</div>
                  <div className="text-[10px] opacity-60">{u.role}</div>
                </div>
              </button>
            ))}
          </div>

          {/* Builder Content */}
          {builderUser && getBuilderUserObj && (
            <div>
              <div className="flex items-center gap-3 mb-4">
                <span className={`text-sm font-bold ${isLcars ? "text-[var(--lcars-orange)] tracking-wider" : "text-purple-200"}`}>
                  {isLcars ? `SMARTHOME FÜR ${(getBuilderUserObj.name || getBuilderUserObj.email).toUpperCase()}` : `SmartHome für ${getBuilderUserObj.name || getBuilderUserObj.email}`}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded ${isLcars ? "bg-[var(--lcars-blue)]/20 text-[var(--lcars-blue)]" : "bg-purple-800/30 text-purple-300"}`}>
                  {builderSelectedCount} {isLcars ? "GERÄTE AUSGEWÄHLT" : "Geräte ausgewählt"}
                </span>
                <div className="flex-1" />
                <button onClick={saveBuilderConfig} disabled={builderSaving}
                  className={`${btnClass} py-1 px-4 text-xs flex items-center gap-1`} data-testid="builder-save">
                  {builderSaving ? <ArrowClockwise size={14} className="animate-spin" /> : <Check size={14} />}
                  {isLcars ? "SPEICHERN" : "Speichern"}
                </button>
              </div>

              {/* Rooms with entity checkboxes */}
              {rooms.map(room => {
                const roomDevs = devices.filter(d => d.room_id === room.id);
                if (roomDevs.length === 0) return null;
                const selectedInRoom = (builderConfig[room.id] || []).length;
                const Icon = DOMAIN_ICONS[roomDevs[0]?.domain] || Power;
                return (
                  <div key={room.id} className={`${cardClass} mb-4`} data-testid={`builder-room-${room.id}`}>
                    <div className="flex items-center gap-3 mb-3">
                      <House size={18} className={isLcars ? "text-[var(--lcars-orange)]" : "text-purple-400"} />
                      <span className={`font-bold text-sm ${isLcars ? "tracking-wider" : ""}`}>{isLcars ? room.name.toUpperCase() : room.name}</span>
                      <span className="text-xs text-gray-500">{selectedInRoom}/{roomDevs.length}</span>
                      <div className="flex-1" />
                      <button onClick={() => selectAllInRoom(room.id)}
                        className={`text-[10px] px-2 py-1 rounded ${isLcars ? "bg-green-900/30 text-green-400" : "bg-green-900/20 text-green-400"}`}>Alle</button>
                      <button onClick={() => deselectAllInRoom(room.id)}
                        className={`text-[10px] px-2 py-1 rounded ${isLcars ? "bg-red-900/30 text-red-400" : "bg-red-900/20 text-red-400"}`}>Keine</button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                      {roomDevs.map(dev => {
                        const DevIcon = DOMAIN_ICONS[dev.domain] || Power;
                        const selected = isEntitySelected(room.id, dev.entity_id);
                        return (
                          <button key={dev.entity_id} onClick={() => toggleBuilderEntity(room.id, dev.entity_id)}
                            className={`flex items-center gap-2 p-2 rounded-lg text-left text-xs transition-all ${
                              selected
                                ? isLcars ? "bg-[var(--lcars-orange)]/10 border border-[var(--lcars-orange)]/30 text-[var(--lcars-orange)]" : "bg-purple-600/15 border border-purple-500/30 text-purple-200"
                                : isLcars ? "bg-[#0a0a14] border border-gray-800 text-gray-500" : "bg-gray-900/30 border border-gray-700 text-gray-500"
                            }`}
                            data-testid={`builder-entity-${dev.entity_id}`}
                          >
                            <div className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 ${selected ? (isLcars ? "bg-[var(--lcars-orange)]/20" : "bg-purple-600/30") : "bg-gray-800"}`}>
                              {selected ? <Check size={12} weight="bold" /> : <DevIcon size={12} />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium truncate">{dev.display_name}</div>
                              <div className="text-[9px] text-gray-600 truncate">{dev.entity_id}</div>
                            </div>
                            {dev.critical && <Shield size={10} className="text-red-400 flex-shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* Info */}
              <div className={`p-3 rounded-lg text-xs mt-4 ${isLcars ? "bg-[#0a0a14] border border-[var(--lcars-purple)]/20 text-gray-500" : "bg-purple-950/30 border border-purple-800/20 text-purple-400"}`}>
                {isLcars ? "NUR AUSGEWÄHLTE GERÄTE WERDEN FÜR DIESEN BENUTZER AUF DER SMARTHOME-SEITE ANGEZEIGT. NICHT AUSGEWÄHLTE GERÄTE SIND FÜR DEN BENUTZER UNSICHTBAR." : "Nur ausgewählte Geräte werden für diesen Benutzer auf der SmartHome-Seite angezeigt. Nicht ausgewählte Geräte sind für den Benutzer unsichtbar."}
              </div>
            </div>
          )}
          {!builderUser && <div className="text-center py-12 text-gray-500">{isLcars ? "BENUTZER AUSWÄHLEN" : "Wähle einen Benutzer"}</div>}
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

      {/* ==================== KI-ROUTER TAB (Service Registry) ==================== */}
      {activeTab === "router" && (
        <div className="space-y-4" data-testid="router-tab">
          <div className={cardClass}>
            <div className="flex items-center gap-3 mb-2">
              <MagicWand size={20} className={isLcars ? "text-[var(--lcars-orange)]" : "text-purple-400"} />
              <h3 className={`text-sm ${isLcars ? "tracking-widest text-[var(--lcars-orange)]" : "font-bold text-purple-200"}`}>
                {isLcars ? "KI-ROUTER — DIENST-REGISTRY" : "KI-Router — Dienst-Registry"}
              </h3>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed">
              Hier konfigurierst du was jeder Dienst <b>kann</b>. Der GPT-Router entscheidet anhand dieser Beschreibungen welcher Dienst für eine Nutzer-Anfrage zuständig ist.
              Passe Beschreibung, Fähigkeiten und Beispiel-Anfragen an, um das Routing für deine Daten zu optimieren.
              Überschreibungen werden separat gespeichert — Standard-Dienste lassen sich jederzeit auf die Voreinstellung zurücksetzen.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex-1" />
            <button onClick={() => setShowCreateReg(true)} className={`${btnClass} py-1 px-3 text-xs flex items-center gap-1`} data-testid="registry-add-btn">
              <Plus size={14} /> {isLcars ? "NEUEN DIENST" : "Neuen Dienst hinzufügen"}
            </button>
          </div>

          {showCreateReg && (
            <div className={cardClass} data-testid="registry-create-form">
              <h4 className={`text-sm font-bold mb-3 ${isLcars ? "text-[var(--lcars-orange)] tracking-wider" : "text-purple-200"}`}>
                {isLcars ? "NEUER DIENST" : "Neuer Dienst"}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input placeholder="service_id (z.B. nextcloud)" value={regForm.service_id}
                  onChange={e => setRegForm({ ...regForm, service_id: e.target.value })}
                  className={isLcars ? "lcars-input" : "disney-input"} style={{ textTransform: "none" }}
                  data-testid="registry-new-id" />
                <input placeholder="Anzeigename" value={regForm.name}
                  onChange={e => setRegForm({ ...regForm, name: e.target.value })}
                  className={isLcars ? "lcars-input" : "disney-input"} style={{ textTransform: "none" }}
                  data-testid="registry-new-name" />
              </div>
              <textarea placeholder="Beschreibung — was kann dieser Dienst? (GPT liest das für Routing-Entscheidung)"
                value={regForm.description}
                onChange={e => setRegForm({ ...regForm, description: e.target.value })}
                rows={3}
                className={`${isLcars ? "lcars-input" : "disney-input"} w-full mt-3`}
                style={{ textTransform: "none" }}
                data-testid="registry-new-desc" />
              <input placeholder="Fähigkeiten (komma-getrennt)" value={regForm.capabilities}
                onChange={e => setRegForm({ ...regForm, capabilities: e.target.value })}
                className={`${isLcars ? "lcars-input" : "disney-input"} w-full mt-3`}
                style={{ textTransform: "none" }}
                data-testid="registry-new-caps" />
              <textarea placeholder="Beispiel-Anfragen (eine pro Zeile)"
                value={regForm.example_queries}
                onChange={e => setRegForm({ ...regForm, example_queries: e.target.value })}
                rows={3}
                className={`${isLcars ? "lcars-input" : "disney-input"} w-full mt-3`}
                style={{ textTransform: "none" }}
                data-testid="registry-new-examples" />
              <div className="flex gap-2 mt-3">
                <button onClick={createRegistryCustom} className={btnClass} data-testid="registry-save-new">
                  {isLcars ? "SPEICHERN" : "Speichern"}
                </button>
                <button onClick={() => setShowCreateReg(false)} className={`${btnClass} opacity-70`} data-testid="registry-cancel-new">
                  {isLcars ? "ABBRECHEN" : "Abbrechen"}
                </button>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {registry.map(s => (
              <div key={s.service_id} className={cardClass} data-testid={`registry-${s.service_id}`}>
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                    s.available
                      ? (isLcars ? "bg-green-500/20 text-green-400" : "bg-green-700/30 text-green-300")
                      : (isLcars ? "bg-gray-700/30 text-gray-500" : "bg-gray-800/40 text-gray-500")
                  }`}>
                    <Robot size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="font-bold text-sm">{s.name}</div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">{s.service_id}</span>
                      {s.is_custom && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-700/40 text-blue-300">CUSTOM</span>}
                      {s.overridden && !s.is_custom && <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-700/40 text-yellow-200">ÜBERSCHRIEBEN</span>}
                      <span className={`text-[10px] font-bold ${s.available ? "text-green-400" : "text-gray-500"}`}>
                        {s.available ? "VERFÜGBAR" : "OFFLINE"}
                      </span>
                    </div>
                    {regEditing === s.service_id ? (
                      <RegistryEditor service={s} isLcars={isLcars}
                        onSave={(payload) => saveRegistryOverride(s.service_id, payload)}
                        onCancel={() => setRegEditing(null)} />
                    ) : (
                      <>
                        <div className="text-xs text-gray-400 mt-1 leading-relaxed" style={{ textTransform: "none" }}>
                          {s.description || <span className="italic text-gray-600">Keine Beschreibung</span>}
                        </div>
                        {s.capabilities?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {s.capabilities.map((c, i) => (
                              <span key={i} className={`text-[10px] px-2 py-0.5 rounded ${isLcars ? "bg-[var(--lcars-purple)]/20 text-[var(--lcars-purple)]" : "bg-purple-800/30 text-purple-300"}`}>{c}</span>
                            ))}
                          </div>
                        )}
                        {s.example_queries?.length > 0 && (
                          <div className="text-[10px] text-gray-500 mt-2">
                            <b>Beispiele:</b> {s.example_queries.slice(0, 3).map((q, i) => <span key={i} className="italic">"{q}"{i < Math.min(s.example_queries.length, 3) - 1 ? "; " : ""}</span>)}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  {regEditing !== s.service_id && (
                    <div className="flex flex-col gap-1">
                      <button onClick={() => setRegEditing(s.service_id)}
                        className={`${btnClass} py-1 px-2 text-[10px]`}
                        data-testid={`registry-edit-${s.service_id}`}>
                        <PencilSimple size={12} />
                      </button>
                      {(s.overridden || s.is_custom) && (
                        <button onClick={() => deleteRegistryEntry(s.service_id, s.is_custom)}
                          className="py-1 px-2 text-[10px] rounded bg-red-900/40 text-red-300 hover:bg-red-800/50"
                          data-testid={`registry-delete-${s.service_id}`}>
                          <Trash size={12} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {registry.length === 0 && (
              <div className="text-center py-12 text-gray-500 text-sm">Noch keine Dienste geladen — Tab erneut öffnen.</div>
            )}
          </div>

          {/* Router History */}
          <div className={cardClass} data-testid="router-history-block">
            <div className="flex items-center gap-3 mb-3">
              <ClockCounterClockwise size={18} className={isLcars ? "text-[var(--lcars-blue)]" : "text-blue-400"} />
              <h3 className={`text-sm ${isLcars ? "tracking-widest text-[var(--lcars-blue)]" : "font-bold text-purple-200"}`}>
                {isLcars ? "ROUTER-HISTORIE" : "Router-Historie"}
              </h3>
              <div className="flex-1" />
              <button onClick={fetchRegistry} className={`${btnClass} py-1 px-2 text-[10px]`} data-testid="router-history-refresh">
                <ArrowClockwise size={12} />
              </button>
              {routerHistory.length > 0 && (
                <button onClick={clearRouterHistory} className="py-1 px-2 text-[10px] rounded bg-red-900/40 text-red-300 hover:bg-red-800/50" data-testid="router-history-clear">
                  <Trash size={12} />
                </button>
              )}
            </div>
            <p className="text-[11px] text-gray-500 mb-3 leading-relaxed" style={{ textTransform: "none" }}>
              Die letzten Chat-Anfragen und an welchen Dienst sie geroutet wurden. Entdeckst du eine Fehlentscheidung — passe oben die Dienst-Beschreibung an.
            </p>
            {routerHistory.length === 0 ? (
              <div className="text-center py-6 text-gray-500 text-xs">Noch keine Einträge — sobald ein User chattet erscheint hier die Routing-Entscheidung.</div>
            ) : (
              <div className="space-y-1.5 max-h-96 overflow-y-auto">
                {routerHistory.map((h, i) => (
                  <div key={i} className={`${isLcars ? "bg-[#0a0a14]" : "bg-purple-950/30"} rounded px-3 py-2 text-xs flex items-start gap-3`} data-testid={`router-history-${i}`} style={{ textTransform: "none" }}>
                    <div className="flex-1 min-w-0">
                      <div className="text-gray-300 truncate" title={h.message}>{h.message}</div>
                      <div className="text-[10px] text-gray-500 mt-0.5">
                        {h.user_name && <span className="mr-2">@{h.user_name}</span>}
                        <span>{h.timestamp ? new Date(h.timestamp).toLocaleString("de-DE") : ""}</span>
                      </div>
                    </div>
                    <div className="flex gap-1 flex-shrink-0 flex-wrap justify-end max-w-[40%]">
                      {h.is_simple ? (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">SIMPLE</span>
                      ) : h.services && h.services.length > 0 ? (
                        h.services.map((s, j) => (
                          <span key={j} className={`text-[9px] px-1.5 py-0.5 rounded ${isLcars ? "bg-[var(--lcars-orange)]/20 text-[var(--lcars-orange)]" : "bg-purple-800/40 text-purple-200"}`}>{s}</span>
                        ))
                      ) : (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500">—</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== SETTINGS TAB ==================== */}
      {activeTab === "settings" && (
        <div className="space-y-6">
          {/* Default Theme (Admin-wide) */}
          <div className={cardClass} data-testid="default-theme-block">
            <div className="flex items-center gap-2 mb-3">
              <MagicWand size={18} className={isLcars ? "text-[var(--lcars-orange)]" : "text-purple-400"} />
              <h3 className={`text-sm ${isLcars ? "tracking-widest text-[var(--lcars-orange)]" : "font-bold text-purple-200"}`}>
                {isLcars ? "STANDARD-THEME" : "Standard-Theme für neue User"}
              </h3>
            </div>
            <p className="text-xs text-gray-500 mb-3" style={{ textTransform: "none" }}>
              Dieses Theme wird allen User-Accounts zugewiesen, die noch keine eigene Auswahl gemacht haben.
              User können ihre persönliche Einstellung in <b>Konto → Theme wählen</b> treffen — dann überschreibt das diesen Default.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {availableThemes.map(t => (
                <button key={t.id}
                  onClick={() => saveDefaultTheme(t.id)}
                  className={`p-3 rounded-lg border-2 text-xs transition-all text-left ${defaultTheme === t.id ? "" : "border-gray-700 opacity-75 hover:opacity-100"}`}
                  style={defaultTheme === t.id ? { borderColor: t.accent, background: `${t.accent}22` } : {}}
                  data-testid={`default-theme-${t.id}`}>
                  <span className="inline-block w-3 h-3 rounded-full mr-2" style={{ background: t.accent }} />
                  <span className="font-bold" style={{ textTransform: "none" }}>{t.label}</span>
                  {defaultTheme === t.id && <span className="block mt-1 text-[10px] font-bold" style={{ color: t.accent }}>✓ AKTIV</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Settings Backup / Diagnose */}
          <div className={cardClass} data-testid="settings-backup-block">
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <HardDrives size={20} className={isLcars ? "text-[var(--lcars-orange)]" : "text-purple-400"} />
              <h3 className={`text-sm ${isLcars ? "tracking-widest text-[var(--lcars-orange)]" : "font-bold text-purple-200"}`}>
                {isLcars ? "SETTINGS BACKUP & DIAGNOSE" : "Settings Backup & Diagnose"}
              </h3>
              <div className="flex-1" />
              {settingsDiag && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                  settingsDiag.empty === 0
                    ? "bg-green-700/40 text-green-300"
                    : "bg-yellow-700/40 text-yellow-200"
                }`} data-testid="settings-diag-badge">
                  {settingsDiag.filled}/{settingsDiag.total} GESETZT
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mb-3 leading-relaxed" style={{ textTransform: "none" }}>
              Mach nach jedem erfolgreichen Key-Eintrag einen Export mit Secrets und speichere die Datei sicher.
              Falls bei einem Update/Redeploy das Mongo-Volume neu erstellt wird, kannst du die Keys per Import in 1 Klick wiederherstellen.
            </p>
            <div className="flex flex-wrap gap-2 mb-3">
              <button onClick={loadSettingsDiag} className={`${btnClass} py-1 px-3 text-xs flex items-center gap-1`} data-testid="settings-diag-refresh">
                <ArrowClockwise size={12} /> {isLcars ? "DIAGNOSE" : "Diagnose"}
              </button>
              <button onClick={() => exportSettings(false)} className={`${btnClass} py-1 px-3 text-xs flex items-center gap-1 opacity-90`} data-testid="settings-export-redacted">
                <Eye size={12} /> {isLcars ? "EXPORT (REDACTED)" : "Export (ohne Secrets)"}
              </button>
              <button onClick={() => {
                if (window.confirm("Export MIT Secrets erzeugen? Die Datei enthält dann deine API-Keys im Klartext — behandle sie wie ein Passwort.")) exportSettings(true);
              }} className={`${btnClass} py-1 px-3 text-xs flex items-center gap-1 bg-orange-900/40`} data-testid="settings-export-full">
                <Shield size={12} /> {isLcars ? "EXPORT MIT SECRETS" : "Export mit Secrets"}
              </button>
              <label className={`${btnClass} py-1 px-3 text-xs flex items-center gap-1 cursor-pointer`} data-testid="settings-import-btn">
                <ArrowsVertical size={12} /> {isLcars ? "IMPORT" : "Backup importieren"}
                <input type="file" accept="application/json" className="hidden" onChange={importSettings} />
              </label>
            </div>
            {settingsDiag && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-1 text-[11px]" data-testid="settings-diag-list">
                {settingsDiag.settings.map((s, i) => (
                  <div key={i} className={`flex items-center justify-between px-2 py-1 rounded ${s.has_value ? "bg-green-950/30" : "bg-red-950/30"}`}>
                    <span className="font-mono text-gray-300 truncate" style={{ textTransform: "none" }}>{s.key}</span>
                    <span className={`flex items-center gap-2 flex-shrink-0 ${s.has_value ? "text-green-400" : "text-red-400"}`}>
                      {s.preview && <span className="text-gray-500 font-mono">{s.preview}</span>}
                      {s.has_value ? "✓" : "✗"}
                    </span>
                  </div>
                ))}
                {settingsDiag.settings.length === 0 && (
                  <div className="col-span-2 text-center py-4 text-red-400 font-bold">
                    ⚠ Settings-Collection ist LEER! Importiere ein Backup oder trage die Keys unten neu ein.
                  </div>
                )}
              </div>
            )}
          </div>

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
              <div>
                <label className={`block text-xs mb-1 ${isLcars ? "text-gray-400 tracking-wider" : "text-purple-300"}`}>
                  {isLcars ? "STANDORT (STADT ODER PLZ)" : "Standort (Stadt oder PLZ)"}
                </label>
                <input type="text" value={weatherCity} onChange={(e) => setWeatherCity(e.target.value)} placeholder="z.B. 4718 Holderbank, CH" className={`${inputClass} w-full`} data-testid="weather-city-input" />
              </div>
              <div>
                <label className={`block text-xs mb-1 ${isLcars ? "text-gray-400 tracking-wider" : "text-purple-300"}`}>
                  {isLcars ? "GESPEICHERTER WETTER-KEY" : "Gespeicherter Wetter-API-Key"}
                </label>
                <div className={`p-2 rounded text-sm ${isLcars ? "bg-[#0a0a14] text-gray-400 border border-[var(--lcars-purple)]/30" : "bg-purple-950/50 text-purple-300"}`}>
                  {settings.weather_api_key || "Nicht konfiguriert"}
                </div>
              </div>
              <div>
                <label className={`block text-xs mb-1 ${isLcars ? "text-gray-400 tracking-wider" : "text-purple-300"}`}>
                  {isLcars ? "NEUER WETTER-KEY" : "Neuer Wetter-API-Key (leer = unverändert)"}
                </label>
                <input type="password" value={weatherApiKey} onChange={(e) => setWeatherApiKey(e.target.value)} placeholder="API Key..." className={`${inputClass} w-full`} data-testid="weather-api-key-input" />
              </div>
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
              <div>
                <label className={`block text-xs mb-1 ${isLcars ? "text-gray-400 tracking-wider" : "text-purple-300"}`}>
                  {isLcars ? "HOME ASSISTANT URL" : "Home Assistant URL"}
                </label>
                <input type="text" value={haUrl} onChange={(e) => setHaUrl(e.target.value)} placeholder="http://192.168.x.x:8123" className={`${inputClass} w-full`} data-testid="ha-url-input" />
              </div>
              <div>
                <label className={`block text-xs mb-1 ${isLcars ? "text-gray-400 tracking-wider" : "text-purple-300"}`}>
                  {isLcars ? "GESPEICHERTER TOKEN" : "Gespeicherter Token"}
                </label>
                <div className={`p-2 rounded text-sm ${isLcars ? "bg-[#0a0a14] text-gray-400 border border-[var(--lcars-purple)]/30" : "bg-purple-950/50 text-purple-300"}`}>
                  {settings.ha_token || (isLcars ? "KEIN TOKEN GESPEICHERT" : "Kein Token gespeichert")}
                </div>
              </div>
              <div>
                <label className={`block text-xs mb-1 ${isLcars ? "text-gray-400 tracking-wider" : "text-purple-300"}`}>
                  {isLcars ? "NEUER TOKEN" : "Neuer Token (leer = unverändert)"}
                </label>
                <input type="password" value={haToken} onChange={(e) => setHaToken(e.target.value)} placeholder="eyJhb..." className={`${inputClass} w-full`} data-testid="ha-token-input" />
              </div>
              <button onClick={() => checkHaStatus(false)} disabled={haTesting} className={`${btnClass} text-xs flex items-center gap-2`} data-testid="ha-test-button">
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

          {/* CaseDesk Config */}
          <div className={cardClass} data-testid="settings-casedesk">
            <div className="flex items-center gap-3 mb-4">
              <Gear size={20} className={isLcars ? "text-[var(--lcars-gold)]" : "text-amber-400"} />
              <h3 className={`text-sm ${isLcars ? "tracking-widest text-[var(--lcars-gold)]" : "font-bold text-purple-200"}`}>{isLcars ? "CASEDESK AI" : "CaseDesk AI"}</h3>
              {cdStatus && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${cdStatus.connected ? "bg-green-900/50 text-green-400" : "bg-red-900/50 text-red-400"}`}>
                  {cdStatus.connected ? "VERBUNDEN" : "OFFLINE"}
                </span>
              )}
            </div>
            <p className={`text-xs mb-4 ${isLcars ? "text-gray-400" : "text-purple-300"}`}>
              {isLcars ? "VERBINDE ARIA MIT CASEDESK FÜR E-MAILS, DOKUMENTE, FÄLLE UND KALENDER." : "Verbinde Aria mit CaseDesk für E-Mails, Dokumente, Fälle und Kalender."}
            </p>
            <div className="space-y-3">
              <div>
                <label className={`block text-xs mb-1 ${isLcars ? "text-gray-400 tracking-wider" : "text-purple-300"}`}>
                  {isLcars ? "CASEDESK URL" : "CaseDesk URL"}
                </label>
                <input type="text" value={cdUrl} onChange={(e) => setCdUrl(e.target.value)} placeholder="http://192.168.x.x:9090" className={`${inputClass} w-full`} data-testid="cd-url-input" />
              </div>
              <div>
                <label className={`block text-xs mb-1 ${isLcars ? "text-gray-400 tracking-wider" : "text-purple-300"}`}>
                  {isLcars ? "CASEDESK E-MAIL" : "CaseDesk Login E-Mail"}
                </label>
                <input type="text" value={cdEmail} onChange={(e) => setCdEmail(e.target.value)} placeholder="admin@example.com" className={`${inputClass} w-full`} data-testid="cd-email-input" />
              </div>
              <div>
                <label className={`block text-xs mb-1 ${isLcars ? "text-gray-400 tracking-wider" : "text-purple-300"}`}>
                  {isLcars ? "GESPEICHERTES PASSWORT" : "Gespeichertes Passwort"}
                </label>
                <div className={`p-2 rounded text-sm ${isLcars ? "bg-[#0a0a14] text-gray-400 border border-[var(--lcars-purple)]/30" : "bg-purple-950/50 text-purple-300"}`}>
                  {settings.casedesk_password || (isLcars ? "NICHT GESPEICHERT" : "Nicht gespeichert")}
                </div>
              </div>
              <div>
                <label className={`block text-xs mb-1 ${isLcars ? "text-gray-400 tracking-wider" : "text-purple-300"}`}>
                  {isLcars ? "NEUES PASSWORT" : "Neues Passwort (leer = unverändert)"}
                </label>
                <input type="password" value={cdPassword} onChange={(e) => setCdPassword(e.target.value)} placeholder="Passwort..." className={`${inputClass} w-full`} data-testid="cd-password-input" />
              </div>
              <button onClick={() => checkCdStatus(false)} disabled={cdTesting} className={`${btnClass} text-xs flex items-center gap-2`} data-testid="cd-test-button">
                {cdTesting ? <ArrowClockwise size={14} className="animate-spin" /> : null}
                {cdTesting ? (isLcars ? "TESTE..." : "Teste...") : (isLcars ? "VERBINDUNG TESTEN" : "Verbindung testen")}
              </button>
              {cdStatus && !cdTesting && (
                <div className={`p-3 rounded-lg text-sm font-bold ${cdStatus.connected ? "bg-green-900/30 text-green-400 border border-green-800/40" : "bg-red-900/30 text-red-400 border border-red-800/40"}`} data-testid="cd-test-result">
                  {cdStatus.connected ? "CaseDesk verbunden!" : `Nicht erreichbar: ${cdStatus.message || "Offline"}`}
                </div>
              )}
            </div>
          </div>

          {/* Telegram Bot */}
          <div className={cardClass} data-testid="settings-telegram">

          {/* Plex */}
          </div>
          <div className={cardClass} data-testid="settings-plex">
            <div className="flex items-center gap-3 mb-4">
              <Gear size={20} className={isLcars ? "text-[var(--lcars-gold)]" : "text-yellow-400"} />
              <h3 className={`text-sm ${isLcars ? "tracking-widest text-[var(--lcars-gold)]" : "font-bold text-purple-200"}`}>{isLcars ? "PLEX MEDIA SERVER" : "Plex Media Server"}</h3>
              {plexStatus && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${plexStatus.connected ? "bg-green-900/50 text-green-400" : "bg-red-900/50 text-red-400"}`}>
                  {plexStatus.connected ? `VERBUNDEN (${plexStatus.name})` : "OFFLINE"}
                </span>
              )}
            </div>
            <div className="space-y-3">
              <div>
                <label className={`block text-xs mb-1 ${isLcars ? "text-gray-400 tracking-wider" : "text-purple-300"}`}>
                  {isLcars ? "PLEX URL" : "Plex Server URL"}
                </label>
                <input type="text" value={plexUrl} onChange={(e) => setPlexUrl(e.target.value)} placeholder="http://192.168.x.x:32400" className={`${inputClass} w-full`} data-testid="plex-url-input" />
              </div>
              <div>
                <label className={`block text-xs mb-1 ${isLcars ? "text-gray-400 tracking-wider" : "text-purple-300"}`}>
                  {isLcars ? "GESPEICHERTER TOKEN" : "Gespeicherter Plex Token"}
                </label>
                <div className={`p-2 rounded text-sm ${isLcars ? "bg-[#0a0a14] text-gray-400 border border-[var(--lcars-purple)]/30" : "bg-purple-950/50 text-purple-300"}`}>
                  {settings.plex_token || (isLcars ? "NICHT GESPEICHERT" : "Nicht gespeichert")}
                </div>
              </div>
              <div>
                <label className={`block text-xs mb-1 ${isLcars ? "text-gray-400 tracking-wider" : "text-purple-300"}`}>
                  {isLcars ? "NEUER TOKEN" : "Neuer Plex Token (leer = unverändert)"}
                </label>
                <input type="password" value={plexToken} onChange={(e) => setPlexToken(e.target.value)} placeholder="X-Plex-Token..." className={`${inputClass} w-full`} data-testid="plex-token-input" />
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => checkPlexStatus(false)} disabled={plexTesting} className={`${btnClass} text-xs flex items-center gap-2`} data-testid="plex-test-button">
                  {plexTesting ? <ArrowClockwise size={14} className="animate-spin" /> : null}
                  {plexTesting ? (isLcars ? "TESTE..." : "Teste...") : (isLcars ? "VERBINDUNG TESTEN" : "Verbindung testen")}
                </button>
                <button onClick={clearPlexCache} className={`${btnClass} text-xs flex items-center gap-2 opacity-80`} data-testid="plex-clear-cache-button" title="Zwingt alle Browser die Plex-Thumbnails neu zu laden">
                  <Trash size={14} />
                  {isLcars ? "THUMBNAIL-CACHE LEEREN" : "Thumbnail-Cache leeren"}
                </button>
              </div>
              {plexStatus && !plexTesting && (
                <div className={`p-3 rounded-lg text-sm font-bold ${plexStatus.connected ? "bg-green-900/30 text-green-400 border border-green-800/40" : "bg-red-900/30 text-red-400 border border-red-800/40"}`}>
                  {plexStatus.connected ? `Plex verbunden: ${plexStatus.name} (v${plexStatus.version})` : "Nicht erreichbar"}
                </div>
              )}
            </div>
          </div>

          {/* Telegram Bot */}
          <div className={cardClass} data-testid="settings-telegram-block">
            <div className="flex items-center gap-3 mb-4">
              <Gear size={20} className={isLcars ? "text-[var(--lcars-blue)]" : "text-blue-400"} />
              <h3 className={`text-sm ${isLcars ? "tracking-widest text-[var(--lcars-blue)]" : "font-bold text-purple-200"}`}>{isLcars ? "TELEGRAM BOT" : "Telegram Bot"}</h3>
              {telegramStatus && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                  telegramStatus.running
                    ? "bg-green-700/40 text-green-300"
                    : telegramStatus.token_configured
                      ? "bg-yellow-700/40 text-yellow-200"
                      : "bg-gray-700/40 text-gray-400"
                }`} data-testid="telegram-runtime-badge">
                  {telegramStatus.running
                    ? (isLcars ? "LÄUFT" : "Läuft")
                    : telegramStatus.token_configured
                      ? (isLcars ? "FEHLER" : "Fehler")
                      : (isLcars ? "INAKTIV" : "Inaktiv")}
                </span>
              )}
            </div>
            <p className={`text-xs mb-4 ${isLcars ? "text-gray-400" : "text-purple-300"}`}>
              {isLcars ? "VERBINDE ARIA MIT TELEGRAM. BENUTZER KÖNNEN PER SPRACH-PIN CHATTEN." : "Verbinde Aria mit Telegram. Benutzer können per Sprach-PIN chatten."}
            </p>
            <div className="space-y-3">
              <div>
                <label className={`block text-xs mb-1 ${isLcars ? "text-gray-400 tracking-wider" : "text-purple-300"}`}>
                  {isLcars ? "BOT TOKEN (@BOTFATHER)" : "Bot Token (von @BotFather)"}
                </label>
                <input type="password" value={telegramToken} onChange={(e) => setTelegramToken(e.target.value)} placeholder="123456789:AAH..." className={`${inputClass} w-full`} data-testid="telegram-token-input" />
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={testTelegram} disabled={telegramTesting}
                  className={`${btnClass} py-1 px-3 text-xs flex items-center gap-1 ${telegramTesting ? "opacity-60" : ""}`}
                  data-testid="telegram-test-button">
                  {telegramTesting ? <ArrowClockwise size={12} className="animate-spin" /> : <Check size={12} />}
                  {isLcars ? "VERBINDUNG TESTEN" : "Verbindung testen"}
                </button>
                <button onClick={restartTelegram} disabled={telegramTesting}
                  className={`${btnClass} py-1 px-3 text-xs flex items-center gap-1`}
                  data-testid="telegram-restart-button">
                  <ArrowClockwise size={12} />
                  {isLcars ? "BOT NEUSTART" : "Bot neustarten"}
                </button>
                <button onClick={refreshTelegramStatus}
                  className={`${btnClass} py-1 px-3 text-xs flex items-center gap-1 opacity-80`}
                  data-testid="telegram-refresh-status">
                  <ArrowClockwise size={12} /> {isLcars ? "STATUS" : "Status"}
                </button>
              </div>
              {telegramTestResult && (
                <div className={`p-3 rounded-lg text-xs ${
                  telegramTestResult.ok
                    ? (isLcars ? "bg-green-900/20 border border-green-600/30 text-green-300" : "bg-green-900/20 border border-green-700/30 text-green-200")
                    : (isLcars ? "bg-red-900/20 border border-red-600/30 text-red-300" : "bg-red-900/20 border border-red-700/30 text-red-200")
                }`} style={{ textTransform: "none" }} data-testid="telegram-test-result">
                  <div className="font-bold mb-1">{telegramTestResult.ok ? "✅ " : "❌ "}{telegramTestResult.message}</div>
                  {telegramTestResult.bot && (
                    <div className="space-y-0.5 text-[11px] opacity-90">
                      <div>Bot: <b>@{telegramTestResult.bot.username}</b> ({telegramTestResult.bot.first_name})</div>
                      <div>ID: {telegramTestResult.bot.id}</div>
                      {telegramTestResult.webhook_url_was && <div>Webhook entfernt: {telegramTestResult.webhook_url_was}</div>}
                    </div>
                  )}
                </div>
              )}
              {telegramStatus && telegramStatus.token_configured && (
                <div className={`p-3 rounded-lg text-[11px] ${isLcars ? "bg-[#0a0a14] border border-[var(--lcars-purple)]/20 text-gray-400" : "bg-purple-950/30 border border-purple-800/30 text-purple-300"}`} style={{ textTransform: "none" }} data-testid="telegram-status-panel">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <div>Bot: <b>@{telegramStatus.bot_username || "—"}</b></div>
                    <div>Polls: <b>{telegramStatus.polls_count}</b></div>
                    <div>Updates empfangen: <b>{telegramStatus.updates_received}</b></div>
                    <div>Nachrichten verarbeitet: <b>{telegramStatus.messages_processed}</b></div>
                    <div className="col-span-2">Letzter Poll: {telegramStatus.last_poll_at || "—"}</div>
                    {telegramStatus.last_update_at && <div className="col-span-2">Letzte Nachricht: {telegramStatus.last_update_at}</div>}
                  </div>
                  {telegramStatus.last_error && (
                    <div className="mt-2 pt-2 border-t border-red-800/40 text-red-300 font-semibold">
                      Fehler: {telegramStatus.last_error}
                    </div>
                  )}
                </div>
              )}
              <div className={`p-3 rounded-lg text-xs ${isLcars ? "bg-[#0a0a14] border border-[var(--lcars-purple)]/20 text-gray-500" : "bg-purple-950/30 border border-purple-800/30 text-purple-400"}`} style={{ textTransform: "none" }}>
                Nach dem Speichern des Tokens startet der Bot automatisch. Benutzer senden <b>/start</b> an den Bot und melden sich mit <b>/pin XXXXX</b> an.
                Wenn der Bot nicht reagiert: <b>Verbindung testen</b> prüft Token, entfernt hängende Webhooks und zeigt Diagnose-Infos.
              </div>
            </div>
          </div>

          {/* Voice Default Settings */}
          <div className={cardClass} data-testid="settings-voice">
            <div className="flex items-center gap-3 mb-4">
              <SpeakerHigh size={20} className={isLcars ? "text-[var(--lcars-mauve)]" : "text-pink-400"} />
              <h3 className={`text-sm ${isLcars ? "tracking-widest text-[var(--lcars-mauve)]" : "font-bold text-purple-200"}`}>{isLcars ? "ARIA STANDARD-STIMME" : "Aria Standard-Stimme"}</h3>
            </div>
            <p className={`text-xs mb-4 ${isLcars ? "text-gray-400" : "text-purple-300"}`}>
              {isLcars ? "GLOBALE STANDARD-STIMME FÜR ALLE BENUTZER (KANN PRO BENUTZER UNTER KONTO ÜBERSCHRIEBEN WERDEN)." : "Globale Standard-Stimme für alle Benutzer (kann pro Benutzer unter Konto überschrieben werden)."}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {VOICE_OPTIONS.map(v => (
                <button key={v.id} onClick={() => setDefaultVoice(v.id)}
                  className={`p-3 rounded-lg text-left transition-all ${
                    defaultVoice === v.id
                      ? isLcars ? "bg-[var(--lcars-mauve)]/15 border-2 border-[var(--lcars-mauve)]/50" : "bg-pink-600/20 border-2 border-pink-500/50"
                      : isLcars ? "bg-[#0a0a14] border border-gray-800 hover:border-gray-600" : "bg-gray-900/30 border border-gray-700 hover:border-gray-500"
                  }`}
                  data-testid={`default-voice-${v.id}`}
                >
                  <span className={`text-sm font-bold ${defaultVoice === v.id ? (isLcars ? "text-[var(--lcars-mauve)]" : "text-pink-200") : "text-gray-400"}`}>{v.name}</span>
                  <div className="text-[10px] text-gray-500">{v.desc}</div>
                </button>
              ))}
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

// ===== Registry Editor Component =====
const RegistryEditor = ({ service, isLcars, onSave, onCancel }) => {
  const [desc, setDesc] = useState(service.description || "");
  const [caps, setCaps] = useState((service.capabilities || []).join(", "));
  const [examples, setExamples] = useState((service.example_queries || []).join("\n"));
  const inputCls = isLcars ? "lcars-input" : "disney-input";
  const btnCls = isLcars ? "lcars-button" : "disney-button";

  const handleSave = () => {
    onSave({
      description: desc,
      capabilities: caps.split(",").map(s => s.trim()).filter(Boolean),
      example_queries: examples.split("\n").map(s => s.trim()).filter(Boolean),
    });
  };

  return (
    <div className="mt-2 space-y-2" data-testid={`registry-editor-${service.service_id}`}>
      <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3}
        placeholder="Beschreibung — was kann dieser Dienst?"
        className={`${inputCls} w-full`} style={{ textTransform: "none" }}
        data-testid={`registry-desc-${service.service_id}`} />
      <input value={caps} onChange={e => setCaps(e.target.value)}
        placeholder="Fähigkeiten (komma-getrennt)"
        className={`${inputCls} w-full`} style={{ textTransform: "none" }}
        data-testid={`registry-caps-${service.service_id}`} />
      <textarea value={examples} onChange={e => setExamples(e.target.value)} rows={3}
        placeholder="Beispiel-Anfragen (eine pro Zeile)"
        className={`${inputCls} w-full`} style={{ textTransform: "none" }}
        data-testid={`registry-examples-${service.service_id}`} />
      <div className="flex gap-2">
        <button onClick={handleSave} className={`${btnCls} py-1 px-3 text-xs`}
          data-testid={`registry-save-${service.service_id}`}>
          {isLcars ? "SPEICHERN" : "Speichern"}
        </button>
        <button onClick={onCancel} className={`${btnCls} py-1 px-3 text-xs opacity-70`}
          data-testid={`registry-cancel-${service.service_id}`}>
          {isLcars ? "ABBRECHEN" : "Abbrechen"}
        </button>
      </div>
    </div>
  );
};

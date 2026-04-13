import { useState, useEffect } from "react";
import { useAuth, useTheme, API } from "@/App";
import axios from "axios";
import { toast } from "sonner";
import {
  Plus, Trash, PencilSimple, Check, X, House, Lightbulb, Power,
  ArrowClockwise, Shield, ShieldCheck, Eye, EyeSlash, Gear,
  CaretRight, Lightning, LockSimple, ArrowsVertical, Thermometer,
  VideoCamera, SpeakerHigh, Fan, Robot, MagicWand, User
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

const SmartHomeAdmin = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [activeTab, setActiveTab] = useState("rooms");
  const [rooms, setRooms] = useState([]);
  const [devices, setDevices] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [showCreateRoom, setShowCreateRoom] = useState(false);
  const [newRoom, setNewRoom] = useState({ name: "", icon: "house", order: 0 });
  const [editingDevice, setEditingDevice] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const [auditLogs, setAuditLogs] = useState([]);

  const isLcars = theme === "startrek";
  const cardClass = isLcars ? "lcars-card" : "disney-card";
  const btnClass = isLcars ? "lcars-button" : "disney-button";
  const inputClass = isLcars ? "lcars-input" : "disney-input";

  const fetchData = async () => {
    try {
      const [roomsRes, devicesRes, usersRes] = await Promise.all([
        axios.get(`${API}/smarthome/rooms`),
        axios.get(`${API}/smarthome/devices`),
        axios.get(`${API}/admin/users`),
      ]);
      setRooms(roomsRes.data);
      setDevices(devicesRes.data);
      setUsers(usersRes.data);
    } catch (e) { console.error(e); }
  };

  const fetchAuditLog = async () => {
    try {
      const { data } = await axios.get(`${API}/audit-log?limit=50`);
      setAuditLogs(data);
    } catch {}
  };

  useEffect(() => { fetchData(); }, []);

  const handleCreateRoom = async () => {
    if (!newRoom.name.trim()) return toast.error("Name eingeben");
    try {
      await axios.post(`${API}/smarthome/rooms`, newRoom);
      toast.success("Raum erstellt");
      setShowCreateRoom(false);
      setNewRoom({ name: "", icon: "house", order: rooms.length });
      fetchData();
    } catch (e) { toast.error("Fehler"); }
  };

  const handleDeleteRoom = async (roomId) => {
    try {
      await axios.delete(`${API}/smarthome/rooms/${roomId}`);
      toast.success("Raum gelöscht");
      if (selectedRoom === roomId) setSelectedRoom(null);
      fetchData();
    } catch (e) { toast.error("Fehler"); }
  };

  const handleAssignDevice = async (entityId, roomId) => {
    try {
      await axios.put(`${API}/smarthome/devices/${encodeURIComponent(entityId)}`, { room_id: roomId });
      toast.success("Gerät zugewiesen");
      fetchData();
    } catch (e) { toast.error("Fehler"); }
  };

  const handleToggleCritical = async (entityId, critical) => {
    try {
      await axios.put(`${API}/smarthome/devices/${encodeURIComponent(entityId)}`, { critical: !critical });
      toast.success(critical ? "Nicht mehr kritisch" : "Als kritisch markiert");
      fetchData();
    } catch (e) { toast.error("Fehler"); }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data } = await axios.post(`${API}/smarthome/sync`);
      toast.success(`${data.imported} Geräte importiert`);
      fetchData();
    } catch (e) { toast.error(e.response?.data?.detail || "Sync fehlgeschlagen"); }
    finally { setSyncing(false); }
  };

  const loadPermissions = async (userId) => {
    setSelectedUser(userId);
    try {
      const { data } = await axios.get(`${API}/smarthome/permissions/${userId}`);
      setPermissions(data);
    } catch (e) { setPermissions([]); }
  };

  const handleSetPermission = async (entityId, field, value) => {
    const existing = permissions.find(p => p.entity_id === entityId) || {};
    const body = {
      user_id: selectedUser,
      entity_id: entityId,
      visible: existing.visible || false,
      controllable: existing.controllable || false,
      automation_allowed: existing.automation_allowed || false,
      voice_allowed: existing.voice_allowed || false,
      [field]: value,
    };
    // If turning off visible, turn off everything
    if (field === "visible" && !value) {
      body.controllable = false;
      body.automation_allowed = false;
      body.voice_allowed = false;
    }
    try {
      await axios.put(`${API}/smarthome/permissions`, body);
      loadPermissions(selectedUser);
    } catch (e) { toast.error("Fehler"); }
  };

  const handleBulkPermission = async (roomId, perms) => {
    try {
      await axios.put(`${API}/smarthome/permissions/bulk`, {
        user_id: selectedUser,
        room_id: roomId,
        ...perms,
      });
      toast.success("Raum-Freigaben aktualisiert");
      loadPermissions(selectedUser);
    } catch (e) { toast.error("Fehler"); }
  };

  const tabs = [
    { id: "rooms", label: isLcars ? "RÄUME" : "Räume" },
    { id: "devices", label: isLcars ? "GERÄTE" : "Geräte" },
    { id: "permissions", label: isLcars ? "FREIGABEN" : "Freigaben" },
    { id: "audit", label: isLcars ? "AUDIT-LOG" : "Audit-Log" },
  ];

  const roomDevices = selectedRoom ? devices.filter(d => d.room_id === selectedRoom) : [];
  const unassignedDevices = devices.filter(d => !d.room_id);
  const selectedUserObj = users.find(u => u.id === selectedUser);
  const permMap = Object.fromEntries(permissions.map(p => [p.entity_id, p]));

  return (
    <div className="p-6" data-testid="smarthome-admin-page">
      {/* Header */}
      <div className="flex items-center gap-4 mb-4">
        <h2 className={`${isLcars ? "text-lg tracking-widest text-[var(--lcars-orange)]" : "disney-title text-2xl font-bold"}`}>
          {isLcars ? "SMART HOME VERWALTUNG" : "Smart Home Verwaltung"}
        </h2>
        <div className="flex-1" />
        <button onClick={handleSync} disabled={syncing} className={`${btnClass} py-1 px-3 text-xs flex items-center gap-1`} data-testid="admin-sync-ha">
          <ArrowClockwise size={14} className={syncing ? "animate-spin" : ""} />
          {isLcars ? "HA SYNC" : "HA Sync"}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-full text-sm font-bold transition-all ${
              activeTab === tab.id
                ? isLcars ? "bg-[var(--lcars-orange)] text-black" : "bg-purple-600 text-white"
                : isLcars ? "bg-[var(--lcars-purple)]/20 text-[var(--lcars-purple)]" : "bg-purple-900/30 text-purple-400"
            }`}
            data-testid={`sh-tab-${tab.id}`}
          >{tab.label}</button>
        ))}
      </div>

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

          {/* Create Room Form */}
          {showCreateRoom && (
            <div className={`${cardClass} mb-4`} data-testid="create-room-form">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                <input placeholder="Raumname..." value={newRoom.name} onChange={(e) => setNewRoom({...newRoom, name: e.target.value})}
                  className={`${inputClass} w-full`} data-testid="room-name-input" />
                <select value={newRoom.icon} onChange={(e) => setNewRoom({...newRoom, icon: e.target.value})}
                  className={`${inputClass} w-full`} data-testid="room-icon-select">
                  {ROOM_ICONS.map(i => <option key={i.id} value={i.id}>{i.label}</option>)}
                </select>
                <div className="flex gap-2">
                  <button onClick={handleCreateRoom} className={`${btnClass} flex-1`} data-testid="room-save-btn"><Check size={16} /></button>
                  <button onClick={() => setShowCreateRoom(false)} className="p-2 text-red-400 hover:bg-red-900/30 rounded"><X size={16} /></button>
                </div>
              </div>
            </div>
          )}

          {/* Room List */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {rooms.map(room => (
              <div key={room.id}
                className={`${cardClass} cursor-pointer transition-all ${selectedRoom === room.id ? (isLcars ? "border-[var(--lcars-orange)]/50" : "border-purple-500/50") : ""}`}
                onClick={() => setSelectedRoom(selectedRoom === room.id ? null : room.id)}
                data-testid={`room-card-${room.id}`}
              >
                <div className="flex items-center gap-3">
                  <House size={24} className={isLcars ? "text-[var(--lcars-orange)]" : "text-purple-400"} />
                  <div className="flex-1">
                    <div className={`font-bold ${isLcars ? "tracking-wider text-sm" : ""}`}>{isLcars ? room.name.toUpperCase() : room.name}</div>
                    <div className="text-xs text-gray-500">{room.device_count || 0} Geräte</div>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); handleDeleteRoom(room.id); }}
                    className="p-2 text-red-400 hover:bg-red-900/30 rounded" data-testid={`delete-room-${room.id}`}>
                    <Trash size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Selected Room Devices */}
          {selectedRoom && (
            <div className="mt-6">
              <h3 className={`mb-3 ${isLcars ? "text-sm tracking-widest text-[var(--lcars-mauve)]" : "font-bold text-purple-300"}`}>
                {isLcars ? "GERÄTE IM RAUM" : "Geräte im Raum"} ({roomDevices.length})
              </h3>
              <div className="space-y-2">
                {roomDevices.map(dev => {
                  const Icon = DOMAIN_ICONS[dev.domain] || Power;
                  return (
                    <div key={dev.entity_id} className={`flex items-center gap-3 p-3 rounded-lg ${isLcars ? "bg-[#0a0a14] border border-[var(--lcars-purple)]/20" : "bg-purple-950/30 border border-purple-800/20"}`}>
                      <Icon size={18} className={isLcars ? "text-[var(--lcars-gold)]" : "text-purple-400"} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{dev.display_name}</div>
                        <div className="text-[10px] text-gray-500">{dev.entity_id}</div>
                      </div>
                      {dev.critical && <Shield size={16} className="text-red-400" title="Kritisch" />}
                      <button onClick={() => handleAssignDevice(dev.entity_id, null)} className="text-xs text-gray-500 hover:text-red-400" data-testid={`unassign-${dev.entity_id}`}>
                        Entfernen
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Unassigned devices to drag into room */}
              {unassignedDevices.length > 0 && (
                <div className="mt-4">
                  <h4 className={`mb-2 text-xs ${isLcars ? "text-gray-500 tracking-wider" : "text-purple-400"}`}>
                    {isLcars ? "VERFÜGBARE GERÄTE" : "Verfügbare Geräte"} ({unassignedDevices.length})
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-60 overflow-y-auto">
                    {unassignedDevices.map(dev => {
                      const Icon = DOMAIN_ICONS[dev.domain] || Power;
                      return (
                        <button key={dev.entity_id}
                          onClick={() => handleAssignDevice(dev.entity_id, selectedRoom)}
                          className={`flex items-center gap-2 p-2 rounded text-left text-xs transition-all ${isLcars ? "bg-[#050510] border border-gray-800 hover:border-[var(--lcars-orange)]/30" : "bg-gray-900/30 border border-gray-800 hover:border-purple-500/30"}`}
                          data-testid={`assign-${dev.entity_id}`}
                        >
                          <Icon size={14} className="text-gray-500" />
                          <span className="truncate flex-1">{dev.display_name}</span>
                          <Plus size={12} className="text-green-500" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ==================== DEVICES TAB ==================== */}
      {activeTab === "devices" && (
        <div>
          <div className={`text-sm mb-4 ${isLcars ? "text-gray-400 tracking-wider" : "text-purple-300"}`}>
            {devices.length} {isLcars ? "GERÄTE REGISTRIERT" : "Geräte registriert"}
          </div>
          <div className="space-y-2">
            {devices.map(dev => {
              const Icon = DOMAIN_ICONS[dev.domain] || Power;
              const room = rooms.find(r => r.id === dev.room_id);
              return (
                <div key={dev.entity_id} className={`flex items-center gap-3 p-3 rounded-lg ${isLcars ? "bg-[#0a0a14] border border-[var(--lcars-purple)]/20" : "bg-purple-950/30 border border-purple-800/20"}`} data-testid={`device-row-${dev.entity_id}`}>
                  <Icon size={20} className={dev.ha_state === "on" ? (isLcars ? "text-[var(--lcars-gold)]" : "text-yellow-400") : "text-gray-500"} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{dev.display_name}</div>
                    <div className="text-[10px] text-gray-500">{dev.entity_id} | {dev.domain} | {dev.ha_state || "?"}</div>
                  </div>
                  {room && <span className={`text-xs px-2 py-0.5 rounded ${isLcars ? "bg-[var(--lcars-purple)]/20 text-[var(--lcars-purple)]" : "bg-purple-900/30 text-purple-400"}`}>{room.name}</span>}
                  <button onClick={() => handleToggleCritical(dev.entity_id, dev.critical)}
                    className={`p-1.5 rounded transition-all ${dev.critical ? "bg-red-900/30 text-red-400" : "text-gray-600 hover:text-red-400"}`}
                    title={dev.critical ? "Kritisch (klicken zum Entfernen)" : "Als kritisch markieren"}
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
          {/* User selector */}
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
                <span className={`ml-2 text-xs ${isLcars ? "text-gray-500" : "text-purple-400"}`}>({selectedUserObj.role})</span>
              </div>

              {/* Bulk permissions per room */}
              {rooms.map(room => {
                const roomDevs = devices.filter(d => d.room_id === room.id);
                if (roomDevs.length === 0) return null;
                const allVisible = roomDevs.every(d => permMap[d.entity_id]?.visible);
                
                return (
                  <div key={room.id} className={`${cardClass} mb-4`}>
                    <div className="flex items-center gap-3 mb-3">
                      <House size={18} className={isLcars ? "text-[var(--lcars-orange)]" : "text-purple-400"} />
                      <span className={`font-bold text-sm ${isLcars ? "tracking-wider" : ""}`}>{isLcars ? room.name.toUpperCase() : room.name}</span>
                      <span className="text-xs text-gray-500">{roomDevs.length} Geräte</span>
                      <div className="flex-1" />
                      {/* Bulk buttons */}
                      <button onClick={() => handleBulkPermission(room.id, { visible: true, controllable: true, automation_allowed: false, voice_allowed: true })}
                        className={`text-[10px] px-2 py-1 rounded ${isLcars ? "bg-green-900/30 text-green-400" : "bg-green-900/20 text-green-400"}`}>
                        Alle freigeben
                      </button>
                      <button onClick={() => handleBulkPermission(room.id, { visible: false, controllable: false, automation_allowed: false, voice_allowed: false })}
                        className={`text-[10px] px-2 py-1 rounded ${isLcars ? "bg-red-900/30 text-red-400" : "bg-red-900/20 text-red-400"}`}>
                        Alle sperren
                      </button>
                    </div>

                    {/* Permission header */}
                    <div className="grid grid-cols-[1fr,60px,60px,60px,60px] gap-2 mb-2 text-[10px] text-gray-500 px-2">
                      <div>{isLcars ? "GERÄT" : "Gerät"}</div>
                      <div className="text-center">{isLcars ? "SICHT" : "Sicht"}</div>
                      <div className="text-center">{isLcars ? "STEUER" : "Steuer"}</div>
                      <div className="text-center">{isLcars ? "AUTO" : "Auto"}</div>
                      <div className="text-center">{isLcars ? "VOICE" : "Voice"}</div>
                    </div>

                    {/* Device permission rows */}
                    {roomDevs.map(dev => {
                      const perm = permMap[dev.entity_id] || {};
                      const Icon = DOMAIN_ICONS[dev.domain] || Power;
                      return (
                        <div key={dev.entity_id}
                          className={`grid grid-cols-[1fr,60px,60px,60px,60px] gap-2 items-center px-2 py-1.5 rounded ${isLcars ? "hover:bg-[#0a0a14]" : "hover:bg-purple-950/30"}`}
                          data-testid={`perm-row-${dev.entity_id}`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Icon size={14} className="text-gray-500 flex-shrink-0" />
                            <span className="text-xs truncate">{dev.display_name}</span>
                            {dev.critical && <Shield size={10} className="text-red-400 flex-shrink-0" />}
                          </div>
                          {["visible", "controllable", "automation_allowed", "voice_allowed"].map(field => (
                            <div key={field} className="flex justify-center">
                              <button
                                onClick={() => handleSetPermission(dev.entity_id, field, !perm[field])}
                                className={`w-8 h-8 rounded flex items-center justify-center transition-all ${
                                  perm[field]
                                    ? isLcars ? "bg-green-900/30 text-green-400" : "bg-green-900/20 text-green-400"
                                    : "text-gray-600 hover:text-gray-400"
                                }`}
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

              {rooms.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  Erstelle zuerst Räume und weise Geräte zu.
                </div>
              )}
            </div>
          )}

          {!selectedUser && (
            <div className="text-center py-12 text-gray-500">
              {isLcars ? "BENUTZER AUSWÄHLEN" : "Wähle einen Benutzer aus"}
            </div>
          )}
        </div>
      )}
      {/* ==================== AUDIT TAB ==================== */}
      {activeTab === "audit" && (
        <div>
          <div className="flex items-center gap-3 mb-4">
            <span className={`text-sm ${isLcars ? "text-gray-400 tracking-wider" : "text-purple-300"}`}>
              {isLcars ? "SMART HOME AKTIVITÄTSPROTOKOLL" : "Smart Home Aktivitätsprotokoll"}
            </span>
            <div className="flex-1" />
            <button onClick={fetchAuditLog} className={`${btnClass} py-1 px-3 text-xs`} data-testid="audit-refresh">
              <ArrowClockwise size={14} />
            </button>
          </div>
          {auditLogs.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              <button onClick={fetchAuditLog} className={btnClass}>
                {isLcars ? "LOGS LADEN" : "Logs laden"}
              </button>
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
                    <span className={`font-bold text-xs ${
                      log.type === "ha_denied" ? "text-red-400" : isLcars ? "text-[var(--lcars-orange)]" : "text-purple-200"
                    }`}>
                      {log.type === "ha_command" ? "Befehl ausgeführt"
                        : log.type === "ha_denied" ? "Zugriff verweigert"
                        : log.type === "device_control" ? "Gerät gesteuert"
                        : log.type === "permission_changed" ? "Freigabe geändert"
                        : log.type === "room_created" ? "Raum erstellt"
                        : log.type === "ha_sync" ? "HA Sync"
                        : log.type}
                    </span>
                    {log.user_email && <span className="text-xs text-gray-500">{log.user_email}</span>}
                  </div>
                  <div className="text-xs text-gray-500 truncate">
                    {log.entity_id && <span>{log.entity_id} </span>}
                    {log.command && <span>"{log.command}" </span>}
                    {log.service && <span>({log.service}) </span>}
                    {log.reason && <span className="text-red-400">[{log.reason}] </span>}
                    {log.imported && <span>{log.imported} Geräte importiert</span>}
                  </div>
                </div>
                <div className="text-[10px] text-gray-600 whitespace-nowrap">
                  {log.timestamp ? new Date(log.timestamp).toLocaleString('de-DE') : ""}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default SmartHomeAdmin;

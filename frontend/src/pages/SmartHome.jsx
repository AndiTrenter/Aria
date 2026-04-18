import { useState, useEffect, useCallback } from "react";
import { useAuth, useTheme, API } from "@/App";
import axios from "axios";
import { toast } from "sonner";
import {
  Lightbulb, Power, Thermometer, ArrowsVertical, Eye, VideoCamera,
  LockSimple, SpeakerHigh, Fan, Robot, MagicWand, Gear, ArrowClockwise,
  Plus, CaretDown, CaretUp, Lightning, WifiHigh, WifiSlash
} from "@phosphor-icons/react";
import Automations from "@/pages/Automations";

const DOMAIN_ICONS = {
  light: Lightbulb, switch: Power, climate: Thermometer, cover: ArrowsVertical,
  sensor: Eye, binary_sensor: Eye, camera: VideoCamera, lock: LockSimple,
  media_player: SpeakerHigh, fan: Fan, vacuum: Robot, scene: MagicWand,
  script: Gear, automation: Gear,
};

const DOMAIN_COLORS_LCARS = {
  light: "var(--lcars-gold)", switch: "var(--lcars-orange)", climate: "var(--lcars-salmon)",
  cover: "var(--lcars-blue)", sensor: "var(--lcars-lavender)", lock: "var(--lcars-salmon)",
  camera: "var(--lcars-mauve)", media_player: "var(--lcars-purple)",
};

const DeviceWidget = ({ device, isLcars, onControl }) => {
  const Icon = DOMAIN_ICONS[device.domain] || Power;
  const isOn = device.ha_state === "on" || device.ha_state === "playing" || device.ha_state === "open" || device.ha_state === "unlocked";
  const isControllable = device._perm?.controllable !== false;
  const color = isLcars ? (DOMAIN_COLORS_LCARS[device.domain] || "var(--lcars-orange)") : undefined;
  const isSensor = device.domain === "sensor" || device.domain === "binary_sensor";

  const handleToggle = () => {
    if (!isControllable || isSensor) return;
    const service = isOn ? "turn_off" : "turn_on";
    onControl(device.entity_id, service, {});
  };

  const handleCoverAction = (action) => {
    if (!isControllable) return;
    onControl(device.entity_id, action, {});
  };

  return (
    <div
      className={`relative rounded-xl p-4 transition-all duration-200 cursor-pointer group ${
        isLcars
          ? `bg-[#0a0a14] border ${isOn ? "border-[var(--lcars-orange)]/60 shadow-[0_0_12px_rgba(255,153,0,0.15)]" : "border-[var(--lcars-purple)]/20"} hover:border-[var(--lcars-orange)]/40`
          : `${isOn ? "bg-purple-800/30 border border-purple-500/40 shadow-[0_0_12px_rgba(168,85,247,0.15)]" : "bg-purple-950/30 border border-purple-800/20"} hover:border-purple-500/30`
      }`}
      onClick={handleToggle}
      data-testid={`device-widget-${device.entity_id}`}
    >
      {/* Critical badge */}
      {device.critical && (
        <div className="absolute top-2 right-2">
          <div className={`w-2 h-2 rounded-full ${isLcars ? "bg-red-500" : "bg-red-400"} animate-pulse`} title="Kritisches Gerät" />
        </div>
      )}

      {/* Icon + State */}
      <div className="flex items-center gap-3 mb-2">
        <div className={`p-2 rounded-lg ${isOn
          ? isLcars ? "bg-[var(--lcars-orange)]/15" : "bg-purple-600/30"
          : "bg-gray-800/50"
        }`}>
          <Icon
            size={24}
            weight={isOn ? "fill" : "regular"}
            style={isOn ? { color: color || "#a855f7" } : { color: "#6b7280" }}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-medium truncate ${isLcars ? "tracking-wide" : ""}`} style={isLcars ? { textTransform: "uppercase", fontSize: "11px" } : {}}>
            {device.display_name}
          </div>
          <div className={`text-xs ${isOn ? (isLcars ? "text-[var(--lcars-gold)]" : "text-purple-300") : "text-gray-500"}`}>
            {isSensor
              ? `${device.ha_state || "?"} ${device.ha_attributes?.unit_of_measurement || ""}`
              : isOn ? "Aktiv" : "Aus"
            }
          </div>
        </div>
      </div>

      {/* Cover controls */}
      {device.domain === "cover" && isControllable && (
        <div className="flex gap-1 mt-2" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => handleCoverAction("open_cover")} className={`flex-1 py-1 rounded text-xs ${isLcars ? "lcars-button" : "disney-button"}`} data-testid={`cover-open-${device.entity_id}`}>
            <CaretUp size={14} className="mx-auto" />
          </button>
          <button onClick={() => handleCoverAction("stop_cover")} className={`flex-1 py-1 rounded text-xs ${isLcars ? "lcars-button" : "disney-button"}`}>Stop</button>
          <button onClick={() => handleCoverAction("close_cover")} className={`flex-1 py-1 rounded text-xs ${isLcars ? "lcars-button" : "disney-button"}`} data-testid={`cover-close-${device.entity_id}`}>
            <CaretDown size={14} className="mx-auto" />
          </button>
        </div>
      )}

      {/* Climate controls */}
      {device.domain === "climate" && isControllable && (
        <div className="flex items-center gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => onControl(device.entity_id, "set_temperature", { temperature: (device.ha_attributes?.temperature || 20) - 0.5 })} className={`p-1 rounded ${isLcars ? "lcars-button" : "disney-button"} text-xs`}>-</button>
          <span className={`flex-1 text-center text-sm font-bold ${isLcars ? "text-[var(--lcars-salmon)]" : "text-purple-200"}`}>
            {device.ha_attributes?.temperature || device.ha_attributes?.current_temperature || "?"}°C
          </span>
          <button onClick={() => onControl(device.entity_id, "set_temperature", { temperature: (device.ha_attributes?.temperature || 20) + 0.5 })} className={`p-1 rounded ${isLcars ? "lcars-button" : "disney-button"} text-xs`}>+</button>
        </div>
      )}

      {/* Brightness for lights */}
      {device.domain === "light" && isOn && device.ha_attributes?.brightness && isControllable && (
        <div className="mt-2" onClick={(e) => e.stopPropagation()}>
          <input
            type="range"
            min="0"
            max="255"
            value={device.ha_attributes.brightness}
            onChange={(e) => onControl(device.entity_id, "turn_on", { brightness: parseInt(e.target.value) })}
            className="w-full h-1 rounded-lg appearance-none cursor-pointer accent-orange-500"
            data-testid={`brightness-${device.entity_id}`}
          />
        </div>
      )}

      {/* Not controllable hint */}
      {!isControllable && !isSensor && (
        <div className="text-[10px] text-gray-600 mt-1">Nur Anzeige</div>
      )}
    </div>
  );
};

const SmartHome = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [activeRoom, setActiveRoom] = useState(null);
  const [showAutomations, setShowAutomations] = useState(false);
  const isLcars = theme === "startrek";

  const fetchDashboard = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/smarthome/dashboard`);
      setDashboard(data);
      if (!activeRoom && data.rooms.length > 0) {
        setActiveRoom(data.rooms[0].id);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [activeRoom]);

  useEffect(() => { fetchDashboard(); }, []);

  // Auto-refresh states every 10s
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        await axios.post(`${API}/smarthome/sync/states`);
        fetchDashboard();
      } catch {}
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchDashboard]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data } = await axios.post(`${API}/smarthome/sync`);
      toast.success(`${data.imported} Geräte aus Home Assistant importiert`);
      fetchDashboard();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Sync fehlgeschlagen");
    } finally {
      setSyncing(false);
    }
  };

  const [pinDialog, setPinDialog] = useState(null); // {entityId, service, data}
  const [pinInput, setPinInput] = useState("");

  const handleControl = async (entityId, service, data, pin) => {
    try {
      const { data: result } = await axios.post(`${API}/smarthome/control`, {
        entity_id: entityId, service, data, pin
      });
      if (result.success) {
        toast.success(result.message);
        setTimeout(async () => {
          await axios.post(`${API}/smarthome/sync/states`);
          fetchDashboard();
        }, 500);
      } else {
        toast.error(result.message);
      }
    } catch (e) {
      const detail = e.response?.data?.detail || "Steuerung fehlgeschlagen";
      if (detail.includes("Kritisches Gerät") || detail.includes("kritisch")) {
        // Show PIN dialog
        setPinDialog({ entityId, service, data });
        setPinInput("");
      } else {
        toast.error(detail);
      }
    }
  };

  const handlePinSubmit = async () => {
    if (!pinDialog) return;
    await handleControl(pinDialog.entityId, pinDialog.service, pinDialog.data, pinInput);
    setPinDialog(null);
    setPinInput("");
  };

  const cardClass = isLcars ? "lcars-card" : "disney-card";
  const currentRoom = dashboard?.rooms?.find(r => r.id === activeRoom);
  const isAdmin = dashboard?.is_admin;

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-[60vh]">
        <div className={`animate-pulse text-xl ${isLcars ? "text-[var(--lcars-orange)] tracking-wider" : "text-purple-300"}`}>
          {isLcars ? "LADE SMART HOME SYSTEME..." : "Lade Smart Home..."}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6" data-testid="smarthome-page">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <h2 className={`${isLcars ? "text-lg tracking-widest text-[var(--lcars-orange)]" : "disney-title text-2xl font-bold"}`}>
          {isLcars ? "SMART HOME CONTROL" : "Smart Home"}
        </h2>
        <div className="flex items-center gap-2 ml-2">
          {dashboard?.ha_connected ? (
            <span className="flex items-center gap-1 text-xs text-green-400"><WifiHigh size={14} /> {isLcars ? "HA VERBUNDEN" : "Verbunden"}</span>
          ) : dashboard?.ha_configured ? (
            <span className="flex items-center gap-1 text-xs text-yellow-400"><WifiSlash size={14} /> {isLcars ? "HA OFFLINE" : "Offline"}</span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-gray-500"><WifiSlash size={14} /> {isLcars ? "NICHT KONFIGURIERT" : "Nicht konfiguriert"}</span>
          )}
        </div>
        <div className="flex-1" />
        {isAdmin && dashboard?.ha_configured && (
          <button onClick={handleSync} disabled={syncing} className={`${isLcars ? "lcars-button" : "disney-button"} py-1 px-3 text-xs flex items-center gap-1`} data-testid="sync-ha-button">
            <ArrowClockwise size={14} className={syncing ? "animate-spin" : ""} />
            {isLcars ? "HA SYNC" : "Synchronisieren"}
          </button>
        )}
      </div>

      {/* No rooms / Not configured */}
      {(!dashboard?.rooms || dashboard.rooms.length === 0) && !dashboard?.ha_configured && (
        <div className={`${cardClass} text-center py-16`}>
          <Lightning size={64} className={`mx-auto mb-4 ${isLcars ? "text-[var(--lcars-orange)]" : "text-purple-400"}`} />
          <h3 className={`text-lg mb-2 ${isLcars ? "text-[var(--lcars-orange)] tracking-wider" : "text-purple-200 font-bold"}`}>
            {isLcars ? "SMART HOME NICHT KONFIGURIERT" : "Smart Home einrichten"}
          </h3>
          <p className={`text-sm mb-6 max-w-md mx-auto ${isLcars ? "text-gray-400" : "text-purple-300"}`}>
            Verbinde Home Assistant in den Admin-Einstellungen und erstelle Räume, um dein Smart Home hier zu verwalten.
          </p>
          {isAdmin && (
            <div className="flex gap-3 justify-center">
              <a href="/admin" className={isLcars ? "lcars-button" : "disney-button"}>
                {isLcars ? "EINSTELLUNGEN" : "Einstellungen"}
              </a>
            </div>
          )}
        </div>
      )}

      {/* No rooms but HA configured */}
      {(!dashboard?.rooms || dashboard.rooms.length === 0) && dashboard?.ha_configured && (
        <div className={`${cardClass} text-center py-16`}>
          <WifiHigh size={64} className={`mx-auto mb-4 ${isLcars ? "text-[var(--lcars-blue)]" : "text-purple-400"}`} />
          <h3 className={`text-lg mb-2 ${isLcars ? "text-[var(--lcars-orange)] tracking-wider" : "text-purple-200 font-bold"}`}>
            {isLcars ? "GERÄTE SYNCHRONISIEREN" : "Geräte importieren"}
          </h3>
          <p className={`text-sm mb-6 ${isLcars ? "text-gray-400" : "text-purple-300"}`}>
            Home Assistant ist verbunden. Synchronisiere deine Geräte und erstelle dann Räume im Admin-Bereich.
          </p>
          {isAdmin && (
            <button onClick={handleSync} disabled={syncing} className={isLcars ? "lcars-button" : "disney-button"} data-testid="initial-sync-button">
              <ArrowClockwise size={16} className={`inline mr-2 ${syncing ? "animate-spin" : ""}`} />
              {isLcars ? "JETZT SYNCHRONISIEREN" : "Jetzt synchronisieren"}
            </button>
          )}
        </div>
      )}

      {/* Room Tabs + Devices */}
      {dashboard?.rooms && dashboard.rooms.length > 0 && (
        <div>
          {/* Row 1: Automatisierungen Tab */}
          <div className={`flex gap-2 mb-2 overflow-x-auto pb-1`}>
            <button
              onClick={() => setShowAutomations(!showAutomations)}
              className={`px-4 py-2 rounded-full text-sm whitespace-nowrap transition-all ${
                showAutomations
                  ? isLcars ? "bg-[var(--lcars-orange)] text-black font-bold" : "bg-purple-600 text-white font-bold"
                  : isLcars ? "bg-[#0a0a14] border border-[var(--lcars-blue)]/30 text-[var(--lcars-blue)] hover:border-[var(--lcars-blue)]/60" : "bg-purple-950/30 border border-purple-800/20 text-purple-400 hover:border-purple-500/30"
              }`}
              data-testid="tab-automations"
            >
              <Gear size={14} className="inline mr-1.5" />
              {isLcars ? "AUTOMATISIERUNGEN" : "Automatisierungen"}
            </button>
          </div>

          {/* Row 2: Room Tabs (ALWAYS visible) */}
          <div className={`flex gap-2 mb-6 overflow-x-auto pb-2`}>
            {dashboard.rooms.map(room => (
              <button
                key={room.id}
                onClick={() => { setActiveRoom(room.id); setShowAutomations(false); }}
                className={`px-4 py-2 rounded-full text-sm whitespace-nowrap transition-all ${
                  !showAutomations && activeRoom === room.id
                    ? isLcars ? "lcars-button" : "disney-button"
                    : isLcars ? "bg-[#0a0a14] border border-[var(--lcars-purple)]/20 text-gray-400 hover:border-[var(--lcars-orange)]/30" : "bg-purple-950/30 border border-purple-800/20 text-purple-400 hover:border-purple-500/30"
                }`}
                data-testid={`room-tab-${room.id}`}
              >
                {isLcars ? room.name.toUpperCase() : room.name}
                <span className={`ml-2 text-xs ${!showAutomations && activeRoom === room.id ? "" : "text-gray-600"}`}>
                  {room.devices?.length || 0}
                </span>
              </button>
            ))}
          </div>

          {/* Content: Automations OR Room Devices */}
          {showAutomations ? (
            <div className="mb-6">
              <Automations embedded />
            </div>
          ) : (
            <>
              {/* Device Grid */}
              {currentRoom && (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4" data-testid="device-grid">
                  {currentRoom.devices?.map(dev => (
                    <DeviceWidget
                      key={dev.entity_id}
                      device={dev}
                      isLcars={isLcars}
                      onControl={handleControl}
                    />
                  ))}
                  {(!currentRoom.devices || currentRoom.devices.length === 0) && (
                    <div className="col-span-full text-center py-12 text-gray-500">
                      {isLcars ? "KEINE GERÄTE IN DIESEM SEKTOR" : "Keine Geräte in diesem Raum"}
                    </div>
                  )}
                </div>
              )}

              {/* Unassigned devices (admin only) */}
              {isAdmin && dashboard.unassigned_devices?.length > 0 && (
                <div className="mt-8">
                  <h3 className={`mb-4 text-sm ${isLcars ? "tracking-widest text-[var(--lcars-mauve)]" : "text-purple-400 font-bold"}`}>
                    {isLcars ? "NICHT ZUGEWIESEN" : "Nicht zugewiesene Geräte"} ({dashboard.unassigned_devices.length})
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                    {dashboard.unassigned_devices.map(dev => (
                      <DeviceWidget key={dev.entity_id} device={dev} isLcars={isLcars} onControl={handleControl} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* PIN Dialog */}
      {pinDialog && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" data-testid="pin-dialog">
          <div className={`${isLcars ? "lcars-card" : "disney-card"} p-8 max-w-sm w-full mx-4`}>
            <div className="flex items-center gap-3 mb-4">
              <Lightning size={24} className={isLcars ? "text-[var(--lcars-salmon)]" : "text-red-400"} />
              <h3 className={`font-bold ${isLcars ? "text-[var(--lcars-orange)] tracking-wider text-sm" : "text-purple-200"}`}>
                {isLcars ? "KRITISCHES GERÄT" : "Kritisches Gerät"}
              </h3>
            </div>
            <p className={`text-sm mb-4 ${isLcars ? "text-gray-400" : "text-purple-300"}`}>
              Dieses Gerät benötigt eine PIN-Bestätigung.
            </p>
            <input
              type="password"
              placeholder="PIN eingeben..."
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value.replace(/\D/g, "").slice(0, 8))}
              className={`${isLcars ? "lcars-input" : "disney-input"} w-full mb-4`}
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handlePinSubmit()}
              data-testid="pin-dialog-input"
            />
            <div className="flex gap-3">
              <button onClick={handlePinSubmit} className={`flex-1 ${isLcars ? "lcars-button" : "disney-button"}`} data-testid="pin-dialog-confirm">
                {isLcars ? "BESTÄTIGEN" : "Bestätigen"}
              </button>
              <button onClick={() => { setPinDialog(null); setPinInput(""); }} className="flex-1 px-4 py-2 rounded bg-gray-700 text-gray-300 hover:bg-gray-600">
                {isLcars ? "ABBRECHEN" : "Abbrechen"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SmartHome;

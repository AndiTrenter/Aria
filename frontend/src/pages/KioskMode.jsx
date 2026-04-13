import { useState, useEffect, useCallback } from "react";
import { useAuth, useTheme, API } from "@/App";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import {
  Lightbulb, Power, Thermometer, ArrowsVertical, Eye, VideoCamera,
  LockSimple, SpeakerHigh, Fan, Microphone, Moon, Sun, Book,
  GameController, FilmStrip, ArrowClockwise, House, SignOut,
  CaretUp, CaretDown
} from "@phosphor-icons/react";

const DOMAIN_ICONS = {
  light: Lightbulb, switch: Power, climate: Thermometer, cover: ArrowsVertical,
  sensor: Eye, camera: VideoCamera, lock: LockSimple, media_player: SpeakerHigh, fan: Fan,
};

const SCENE_ICONS = {
  moon: Moon, sun: Sun, book: Book, "game-controller": GameController, "film-strip": FilmStrip,
};

const KioskDevice = ({ device, isChild, onControl }) => {
  const Icon = DOMAIN_ICONS[device.domain] || Power;
  const isOn = ["on", "playing", "open", "unlocked"].includes(device.ha_state);
  const canControl = device._perm?.controllable !== false;
  const isSensor = device.domain === "sensor" || device.domain === "binary_sensor";

  return (
    <button
      onClick={() => !isSensor && canControl && onControl(device.entity_id, isOn ? "turn_off" : "turn_on", {})}
      disabled={isSensor || !canControl}
      className={`flex flex-col items-center justify-center p-6 rounded-2xl transition-all active:scale-95 ${
        isOn
          ? "bg-amber-500/20 border-2 border-amber-400/50 shadow-[0_0_20px_rgba(245,158,11,0.2)]"
          : "bg-gray-900/50 border-2 border-gray-700/30"
      } ${canControl && !isSensor ? "cursor-pointer hover:border-amber-400/30" : "cursor-default"} ${isChild ? "min-h-[140px]" : "min-h-[120px]"}`}
      data-testid={`kiosk-device-${device.entity_id}`}
    >
      <Icon size={isChild ? 48 : 36} weight={isOn ? "fill" : "regular"} className={isOn ? "text-amber-400" : "text-gray-500"} />
      <span className={`mt-3 font-bold text-center leading-tight ${isChild ? "text-base" : "text-sm"} ${isOn ? "text-amber-200" : "text-gray-400"}`}>
        {device.display_name}
      </span>
      {isSensor && (
        <span className="text-xs text-gray-500 mt-1">{device.ha_state} {device.ha_attributes?.unit_of_measurement || ""}</span>
      )}
      {device.domain === "climate" && (
        <span className="text-xs text-amber-300 mt-1">{device.ha_attributes?.temperature || "?"}°C</span>
      )}

      {/* Cover controls */}
      {device.domain === "cover" && canControl && (
        <div className="flex gap-3 mt-3" onClick={e => e.stopPropagation()}>
          <button onClick={() => onControl(device.entity_id, "open_cover", {})} className="p-2 rounded-full bg-gray-800 hover:bg-gray-700 active:scale-90">
            <CaretUp size={20} className="text-gray-300" />
          </button>
          <button onClick={() => onControl(device.entity_id, "stop_cover", {})} className="p-2 rounded-full bg-gray-800 hover:bg-gray-700 active:scale-90 text-xs text-gray-400 font-bold">
            Stop
          </button>
          <button onClick={() => onControl(device.entity_id, "close_cover", {})} className="p-2 rounded-full bg-gray-800 hover:bg-gray-700 active:scale-90">
            <CaretDown size={20} className="text-gray-300" />
          </button>
        </div>
      )}
    </button>
  );
};

const KioskScene = ({ scene, isChild, onExecute }) => {
  const Icon = SCENE_ICONS[scene.icon] || Moon;
  const [executing, setExecuting] = useState(false);

  const handleClick = async () => {
    setExecuting(true);
    await onExecute(scene);
    setTimeout(() => setExecuting(false), 2000);
  };

  return (
    <button
      onClick={handleClick}
      disabled={executing}
      className={`flex flex-col items-center justify-center p-6 rounded-2xl transition-all active:scale-95 bg-gradient-to-br from-purple-900/40 to-indigo-900/40 border-2 border-purple-600/30 hover:border-purple-500/50 ${isChild ? "min-h-[140px]" : "min-h-[120px]"} ${executing ? "animate-pulse" : ""}`}
      data-testid={`kiosk-scene-${scene.id || scene.name}`}
    >
      <Icon size={isChild ? 48 : 36} className={executing ? "text-green-400" : "text-purple-300"} />
      <span className={`mt-3 font-bold text-center ${isChild ? "text-base" : "text-sm"} text-purple-200`}>
        {scene.name}
      </span>
      <span className="text-[10px] text-purple-400 mt-1">{scene.description}</span>
    </button>
  );
};

const KioskMode = () => {
  const { user, logout } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [time, setTime] = useState(new Date());
  const [sceneTemplates, setSceneTemplates] = useState([]);
  const [availableProfiles, setAvailableProfiles] = useState([]);

  const isChild = profile?.child_mode;
  const isAdmin = user?.role === "superadmin" || user?.role === "admin";
  const previewProfileId = searchParams.get("profile");

  const fetchProfile = useCallback(async () => {
    try {
      const templatesRes = await axios.get(`${API}/smarthome/scene-templates`);
      setSceneTemplates(templatesRes.data);

      // Admin preview mode: load specific profile by ID (backend enriches with room+devices)
      if (previewProfileId && isAdmin) {
        const { data } = await axios.get(`${API}/smarthome/profiles/${previewProfileId}`);
        setProfile(data);
      } else {
        // Normal mode: load own profile
        const { data } = await axios.get(`${API}/smarthome/my-profile`);
        setProfile(data);
        if (!data.has_profile && isAdmin) {
          const profilesRes = await axios.get(`${API}/smarthome/profiles`);
          setAvailableProfiles(profilesRes.data);
        }
      }
    } catch (e) {
      console.error(e);
      if (isAdmin) {
        try {
          const profilesRes = await axios.get(`${API}/smarthome/profiles`);
          setAvailableProfiles(profilesRes.data);
        } catch {}
      }
    } finally { setLoading(false); }
  }, [navigate, previewProfileId, isAdmin]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  // Live clock
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Auto-refresh states
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        await axios.post(`${API}/smarthome/sync/states`);
        fetchProfile();
      } catch {}
    }, 8000);
    return () => clearInterval(interval);
  }, [fetchProfile]);

  const handleControl = async (entityId, service, data) => {
    try {
      const { data: result } = await axios.post(`${API}/smarthome/control`, { entity_id: entityId, service, data });
      if (!result.success) toast.error(result.message);
      setTimeout(fetchProfile, 500);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Fehler");
    }
  };

  const handleExecuteScene = async (scene) => {
    // Build actions from template using room devices
    const devices = profile?.devices || [];
    const actions = [];

    for (const tmplAction of (scene.actions_template || scene.actions || [])) {
      if (tmplAction.entity_id) {
        actions.push(tmplAction);
        continue;
      }
      // Match devices by filter
      const filter = tmplAction.entity_filter || {};
      for (const dev of devices) {
        if (filter.domain && dev.domain !== filter.domain) continue;
        const name = (dev.display_name || "").toLowerCase();
        if (filter.include_name && !filter.include_name.some(n => name.includes(n))) continue;
        if (filter.exclude_name && filter.exclude_name.some(n => name.includes(n))) continue;
        actions.push({ service: tmplAction.service, entity_id: dev.entity_id, data: tmplAction.data || {} });
      }
    }

    if (actions.length === 0) {
      toast.error("Keine passenden Geräte gefunden");
      return;
    }

    try {
      const { data: result } = await axios.post(`${API}/smarthome/execute-scene`, { name: scene.name, actions });
      toast.success(result.message);
      setTimeout(fetchProfile, 1000);
    } catch (e) {
      toast.error("Szene fehlgeschlagen");
    }
  };

  if (loading) {
    return <div className="fixed inset-0 bg-black flex items-center justify-center">
      <div className="text-2xl text-amber-400 animate-pulse">Lade...</div>
    </div>;
  }

  if (!profile?.has_profile) {
    // Admin can select a profile to preview
    if (isAdmin && availableProfiles.length > 0) {
      return (
        <div className="fixed inset-0 bg-[#0a0a14] text-white flex items-center justify-center" data-testid="kiosk-profile-selector">
          <div className="max-w-lg w-full p-8">
            <House size={48} className="mx-auto mb-4 text-amber-400" />
            <h1 className="text-2xl font-bold text-amber-300 text-center mb-2">Kiosk-Modus</h1>
            <p className="text-gray-400 text-center mb-8 text-sm">Profil zum Starten auswählen:</p>
            <div className="space-y-3">
              {availableProfiles.map(p => (
                <button key={p.id}
                  onClick={() => navigate(`/kiosk?profile=${p.id}`)}
                  className="w-full flex items-center gap-4 p-4 rounded-xl bg-gray-900/60 border border-gray-700/40 hover:border-amber-400/40 transition-all text-left"
                  data-testid={`kiosk-select-${p.id}`}
                >
                  <House size={24} className="text-amber-400" />
                  <div className="flex-1">
                    <div className="font-bold text-amber-200">{p.name}</div>
                    <div className="text-xs text-gray-500">
                      {p.kiosk_mode && "Kiosk"}{p.kiosk_mode && p.child_mode && " + "}{p.child_mode && "Kindermodus"}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <button onClick={() => navigate("/smarthome")} className="mt-6 w-full py-3 rounded-lg bg-gray-800 text-gray-400 hover:bg-gray-700 text-sm">
              Zurück zum Smart Home
            </button>
          </div>
        </div>
      );
    }
    // Non-admin without profile: redirect
    if (!loading) navigate("/smarthome");
    return null;
  }

  const devices = profile.devices || [];
  const roomName = profile.room?.name || profile.name || "Raum";
  const scenes = profile.scenes?.length > 0 ? profile.scenes : sceneTemplates;

  return (
    <div className="fixed inset-0 bg-[#0a0a14] text-white overflow-auto" data-testid="kiosk-page">
      {/* Header */}
      <div className="flex items-center px-6 py-4 bg-black/30">
        <div className="flex items-center gap-3">
          <House size={24} className="text-amber-400" />
          <h1 className={`font-bold ${isChild ? "text-2xl" : "text-xl"} text-amber-300`}>
            {roomName}
          </h1>
        </div>
        <div className="flex-1" />
        <div className="text-right">
          <div className={`font-mono ${isChild ? "text-3xl" : "text-2xl"} text-amber-400`}>
            {time.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
          </div>
          <div className="text-xs text-gray-500">{time.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })}</div>
        </div>
        {!isChild && (
          <div className="flex items-center gap-2 ml-4">
            {isAdmin && previewProfileId && (
              <button onClick={() => navigate("/kiosk")} className="p-2 rounded-lg text-gray-500 hover:text-amber-400 hover:bg-gray-800" title="Profilauswahl">
                <ArrowClockwise size={20} />
              </button>
            )}
            <button onClick={() => navigate("/smarthome")} className="p-2 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-800" title="Kiosk verlassen">
              <SignOut size={20} />
            </button>
          </div>
        )}
      </div>

      <div className="p-6 space-y-8">
        {/* Scenes */}
        {scenes.length > 0 && (
          <div>
            <h2 className={`mb-4 ${isChild ? "text-xl font-bold text-purple-300" : "text-sm text-gray-500 uppercase tracking-widest"}`}>
              {isChild ? "Was möchtest du tun?" : "Szenen"}
            </h2>
            <div className={`grid ${isChild ? "grid-cols-2 md:grid-cols-3" : "grid-cols-3 md:grid-cols-5"} gap-4`}>
              {scenes.map((scene, i) => (
                <KioskScene key={scene.id || i} scene={scene} isChild={isChild} onExecute={handleExecuteScene} />
              ))}
            </div>
          </div>
        )}

        {/* Devices */}
        <div>
          <h2 className={`mb-4 ${isChild ? "text-xl font-bold text-amber-300" : "text-sm text-gray-500 uppercase tracking-widest"}`}>
            {isChild ? "Deine Geräte" : "Geräte"}
          </h2>
          <div className={`grid ${isChild ? "grid-cols-2 md:grid-cols-3" : "grid-cols-3 md:grid-cols-4 lg:grid-cols-5"} gap-4`}>
            {devices.map(dev => (
              <KioskDevice key={dev.entity_id} device={dev} isChild={isChild} onControl={handleControl} />
            ))}
            {devices.length === 0 && (
              <div className="col-span-full text-center py-12 text-gray-600">Keine Geräte zugewiesen</div>
            )}
          </div>
        </div>
      </div>

      {/* Aria Voice Button (bottom right) */}
      {profile.child_mode !== true && (
        <div className="fixed bottom-6 right-6">
          <button className="w-16 h-16 rounded-full bg-amber-500/20 border-2 border-amber-400/40 flex items-center justify-center hover:bg-amber-500/30 active:scale-90 transition-all" title="Aria Sprachsteuerung">
            <Microphone size={28} className="text-amber-400" />
          </button>
        </div>
      )}
    </div>
  );
};

export default KioskMode;

import { useState, useEffect } from "react";
import { useAuth, useTheme, API } from "@/App";
import axios from "axios";
import { toast } from "sonner";
import {
  Lightning, Plus, Microphone, Check, X, Clock, ArrowClockwise,
  Play, Trash, ShieldCheck, Shield, Warning, CaretDown, CaretUp,
  Gear, CheckCircle, XCircle, HourglassHigh, PencilSimple
} from "@phosphor-icons/react";

const STATUS_BADGES = {
  draft: { label: "ENTWURF", color: "bg-blue-900/30 text-blue-400" },
  pending: { label: "WARTEN", color: "bg-yellow-900/30 text-yellow-400" },
  approved: { label: "GENEHMIGT", color: "bg-green-900/30 text-green-400" },
  rejected: { label: "ABGELEHNT", color: "bg-red-900/30 text-red-400" },
};

const STATUS_ICONS = {
  draft: PencilSimple, pending: HourglassHigh, approved: CheckCircle, rejected: XCircle,
};

const Automations = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [automations, setAutomations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [voiceCommand, setVoiceCommand] = useState("");
  const [creating, setCreating] = useState(false);
  const [showVoiceInput, setShowVoiceInput] = useState(false);
  const [previewAuto, setPreviewAuto] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const isLcars = theme === "startrek";
  const isAdmin = user?.role === "superadmin" || user?.role === "admin";
  const cardClass = isLcars ? "lcars-card" : "disney-card";
  const btnClass = isLcars ? "lcars-button" : "disney-button";
  const inputClass = isLcars ? "lcars-input" : "disney-input";

  const fetchData = async () => {
    try {
      const { data } = await axios.get(`${API}/automations/`);
      setAutomations(data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleVoiceCreate = async () => {
    if (!voiceCommand.trim()) return toast.error("Bitte einen Befehl eingeben");
    setCreating(true);
    try {
      const { data } = await axios.post(`${API}/automations/from-voice`, { command: voiceCommand });
      if (data.success) {
        setPreviewAuto(data);
        toast.success("Automation erstellt!");
        setVoiceCommand("");
        fetchData();
      } else {
        toast.error(data.message);
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || "Fehler beim Erstellen");
    } finally { setCreating(false); }
  };

  const handleApprove = async (autoId, action) => {
    try {
      await axios.put(`${API}/automations/${autoId}/approve`, { action });
      toast.success(action === "approve" ? "Genehmigt" : "Abgelehnt");
      fetchData();
    } catch (e) { toast.error("Fehler"); }
  };

  const handleActivate = async (autoId) => {
    try {
      const { data } = await axios.put(`${API}/automations/${autoId}/activate`);
      if (data.success) {
        toast.success(data.message);
        fetchData();
      } else {
        toast.error(data.message);
      }
    } catch (e) { toast.error(e.response?.data?.detail || "Fehler"); }
  };

  const handleDelete = async (autoId) => {
    try {
      await axios.delete(`${API}/automations/${autoId}`);
      toast.success("Gelöscht");
      fetchData();
    } catch (e) { toast.error("Fehler"); }
  };

  return (
    <div className="p-6" data-testid="automations-page">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <h2 className={`${isLcars ? "text-lg tracking-widest text-[var(--lcars-orange)]" : "disney-title text-2xl font-bold"}`}>
          {isLcars ? "AUTOMATIONEN" : "Automationen"}
        </h2>
        <div className="flex-1" />
        <button onClick={() => setShowVoiceInput(!showVoiceInput)} className={`${btnClass} py-1 px-3 text-xs flex items-center gap-1`} data-testid="toggle-voice-create">
          <Microphone size={14} />
          {isLcars ? "SPRACH-AUTOMATION" : "Per Sprache erstellen"}
        </button>
        <button onClick={fetchData} className={`${btnClass} py-1 px-3 text-xs`} data-testid="automations-refresh">
          <ArrowClockwise size={14} />
        </button>
      </div>

      {/* Voice Command Input */}
      {showVoiceInput && (
        <div className={`${cardClass} mb-6`} data-testid="voice-automation-form">
          <div className="flex items-center gap-3 mb-3">
            <Microphone size={20} className={isLcars ? "text-[var(--lcars-orange)]" : "text-purple-400"} />
            <h3 className={`font-bold text-sm ${isLcars ? "text-[var(--lcars-orange)] tracking-wider" : "text-purple-200"}`}>
              {isLcars ? "AUTOMATION PER SPRACHE ERSTELLEN" : "Automation per Sprache erstellen"}
            </h3>
          </div>
          <p className={`text-xs mb-3 ${isLcars ? "text-gray-400" : "text-purple-300"}`}>
            Beschreibe was passieren soll, z.B.: "Wenn es 20 Uhr ist, schalte das Nachtlicht im Kinderzimmer ein"
          </p>
          <div className="flex gap-3">
            <input
              value={voiceCommand}
              onChange={(e) => setVoiceCommand(e.target.value)}
              placeholder={isLcars ? "BEFEHL EINGEBEN..." : "Was soll automatisiert werden?"}
              className={`${inputClass} flex-1`}
              onKeyDown={(e) => e.key === "Enter" && handleVoiceCreate()}
              data-testid="voice-command-input"
            />
            <button onClick={handleVoiceCreate} disabled={creating} className={`${btnClass} flex items-center gap-1`} data-testid="voice-create-btn">
              {creating ? <ArrowClockwise size={14} className="animate-spin" /> : <Lightning size={14} />}
              {isLcars ? "ERSTELLEN" : "Erstellen"}
            </button>
          </div>

          {/* Examples */}
          <div className="flex flex-wrap gap-2 mt-3">
            {[
              "Wenn ich Gute Nacht sage, Licht im Kinderzimmer aus",
              "Ab 20 Uhr Nachtlicht einschalten",
              "Wenn Fenster offen, Meldung anzeigen"
            ].map((ex, i) => (
              <button key={i} onClick={() => setVoiceCommand(ex)}
                className={`text-[10px] px-2 py-1 rounded transition-all ${isLcars ? "bg-[#0a0a14] border border-[var(--lcars-purple)]/20 text-gray-500 hover:text-[var(--lcars-orange)]" : "bg-purple-950/30 text-purple-500 hover:text-purple-300"}`}>
                "{ex}"
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Preview of just-created automation */}
      {previewAuto && (
        <div className={`${cardClass} mb-6 border-2 ${isLcars ? "border-[var(--lcars-gold)]/40" : "border-purple-500/40"}`} data-testid="automation-preview">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle size={20} className="text-green-400" />
            <span className={`font-bold text-sm ${isLcars ? "text-[var(--lcars-gold)] tracking-wider" : "text-purple-200"}`}>
              {isLcars ? "AUTOMATION ERSTELLT" : "Automation erstellt!"}
            </span>
            <button onClick={() => setPreviewAuto(null)} className="ml-auto text-gray-500 hover:text-gray-300"><X size={16} /></button>
          </div>
          <div className="text-sm font-bold mb-1">{previewAuto.automation?.name}</div>
          <div className="text-xs text-gray-400 mb-2">{previewAuto.automation?.description}</div>
          
          {/* Validation Results */}
          {previewAuto.validation && (
            <div className={`p-3 rounded-lg mb-3 ${
              previewAuto.validation.severity === "ok" ? "bg-green-900/10 border border-green-800/30"
              : previewAuto.validation.severity === "warning" ? "bg-yellow-900/10 border border-yellow-800/30"
              : "bg-red-900/10 border border-red-800/30"
            }`}>
              <div className="flex items-center gap-2 mb-1">
                {previewAuto.validation.severity === "ok" ? <CheckCircle size={16} className="text-green-400" />
                  : previewAuto.validation.severity === "warning" ? <Warning size={16} className="text-yellow-400" />
                  : <XCircle size={16} className="text-red-400" />}
                <span className="text-xs font-bold">
                  {previewAuto.validation.severity === "ok" ? "Alle Prüfungen bestanden"
                    : previewAuto.validation.severity === "warning" ? "Admin-Freigabe erforderlich"
                    : "Validierung fehlgeschlagen"}
                </span>
              </div>
              {previewAuto.validation.issues?.map((issue, i) => (
                <div key={i} className="text-xs text-gray-400 ml-6">- {issue.message}</div>
              ))}
            </div>
          )}
          
          {/* YAML Preview */}
          {previewAuto.ha_yaml && (
            <details className="mb-2">
              <summary className={`text-xs cursor-pointer ${isLcars ? "text-[var(--lcars-blue)]" : "text-purple-400"}`}>
                {isLcars ? "HA YAML ANZEIGEN" : "YAML anzeigen"}
              </summary>
              <pre className="text-[10px] p-3 mt-1 rounded bg-black/50 overflow-x-auto text-gray-400">{previewAuto.ha_yaml}</pre>
            </details>
          )}

          <div className="text-xs text-gray-500">
            Status: <span className={`font-bold ${
              previewAuto.automation?.approval_status === "approved" ? "text-green-400"
              : previewAuto.automation?.approval_status === "pending" ? "text-yellow-400"
              : previewAuto.automation?.approval_status === "rejected" ? "text-red-400"
              : "text-blue-400"
            }`}>{STATUS_BADGES[previewAuto.automation?.approval_status]?.label || previewAuto.automation?.approval_status}</span>
          </div>
        </div>
      )}

      {/* Automations List */}
      {loading ? (
        <div className="text-center py-12">
          <div className={`animate-pulse ${isLcars ? "text-[var(--lcars-orange)] tracking-wider" : "text-purple-300"}`}>
            {isLcars ? "LADE AUTOMATIONEN..." : "Lade..."}
          </div>
        </div>
      ) : automations.length === 0 ? (
        <div className={`${cardClass} text-center py-16`}>
          <Gear size={64} className={`mx-auto mb-4 ${isLcars ? "text-[var(--lcars-orange)]" : "text-purple-400"}`} />
          <h3 className={`text-lg mb-2 ${isLcars ? "text-[var(--lcars-orange)] tracking-wider" : "text-purple-200 font-bold"}`}>
            {isLcars ? "KEINE AUTOMATIONEN" : "Keine Automationen"}
          </h3>
          <p className={`text-sm ${isLcars ? "text-gray-400" : "text-purple-300"}`}>
            Erstelle deine erste Automation per Sprache oder manuell.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {automations.map(auto => {
            const StatusIcon = STATUS_ICONS[auto.approval_status] || PencilSimple;
            const badge = STATUS_BADGES[auto.approval_status] || STATUS_BADGES.draft;
            const expanded = expandedId === auto.id;

            return (
              <div key={auto.id} className={cardClass} data-testid={`automation-${auto.id}`}>
                <div className="flex items-center gap-3 cursor-pointer" onClick={() => setExpandedId(expanded ? null : auto.id)}>
                  <StatusIcon size={20} className={
                    auto.approval_status === "approved" ? "text-green-400"
                    : auto.approval_status === "rejected" ? "text-red-400"
                    : auto.approval_status === "pending" ? "text-yellow-400"
                    : isLcars ? "text-[var(--lcars-blue)]" : "text-blue-400"
                  } />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`font-bold text-sm ${isLcars ? "tracking-wider" : ""}`}>{isLcars ? auto.name.toUpperCase() : auto.name}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${badge.color}`}>{badge.label}</span>
                      {auto.active && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-green-900/30 text-green-400">AKTIV</span>}
                      {auto.source === "voice" && <Microphone size={12} className="text-gray-500" title="Per Sprache erstellt" />}
                    </div>
                    <div className="text-xs text-gray-500 truncate">{auto.description || auto.original_command || ""}</div>
                  </div>
                  {expanded ? <CaretUp size={16} className="text-gray-500" /> : <CaretDown size={16} className="text-gray-500" />}
                </div>

                {/* Expanded Details */}
                {expanded && (
                  <div className="mt-4 pt-4 border-t border-gray-800 space-y-3">
                    {/* Trigger */}
                    <div>
                      <div className={`text-[10px] font-bold mb-1 ${isLcars ? "text-[var(--lcars-mauve)] tracking-wider" : "text-purple-400"}`}>TRIGGER</div>
                      <div className="text-xs text-gray-400">
                        {auto.trigger?.platform === "time" && `Um ${auto.trigger.at}`}
                        {auto.trigger?.platform === "state" && `Wenn ${auto.trigger.entity_id} auf "${auto.trigger.state}" wechselt`}
                        {auto.trigger?.platform === "sun" && `Bei ${auto.trigger.event === "sunset" ? "Sonnenuntergang" : "Sonnenaufgang"}`}
                        {auto.trigger?.platform === "numeric_state" && `Wenn ${auto.trigger.entity_id} ${auto.trigger.below ? "unter " + auto.trigger.below : "über " + auto.trigger.above}`}
                        {!auto.trigger?.platform && "Nicht definiert"}
                      </div>
                    </div>
                    {/* Actions */}
                    <div>
                      <div className={`text-[10px] font-bold mb-1 ${isLcars ? "text-[var(--lcars-mauve)] tracking-wider" : "text-purple-400"}`}>AKTIONEN</div>
                      {auto.actions?.map((a, i) => (
                        <div key={i} className="text-xs text-gray-400">{a.service} → {a.entity_id}</div>
                      ))}
                    </div>
                    {/* YAML */}
                    {auto.ha_yaml && (
                      <details>
                        <summary className={`text-xs cursor-pointer ${isLcars ? "text-[var(--lcars-blue)]" : "text-purple-400"}`}>YAML</summary>
                        <pre className="text-[10px] p-3 mt-1 rounded bg-black/50 overflow-x-auto text-gray-400">{auto.ha_yaml}</pre>
                      </details>
                    )}
                    {/* Validation Issues */}
                    {auto.validation?.issues?.length > 0 && (
                      <div className="space-y-1">
                        {auto.validation.issues.map((issue, i) => (
                          <div key={i} className={`text-xs flex items-center gap-1 ${issue.type === "no_permission" || issue.type === "critical_device" ? "text-red-400" : "text-yellow-400"}`}>
                            <Warning size={12} /> {issue.message}
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Info */}
                    <div className="text-[10px] text-gray-600 space-y-1">
                      <div>Erstellt von: {auto.creator_email} | Quelle: {auto.source}</div>
                      <div>Erstellt: {auto.created_at ? new Date(auto.created_at).toLocaleString("de-DE") : ""}</div>
                      {auto.rejection_reason && <div className="text-red-400">Grund: {auto.rejection_reason}</div>}
                    </div>
                    {/* Action Buttons */}
                    <div className="flex gap-2 pt-2">
                      {isAdmin && auto.approval_status === "pending" && (
                        <>
                          <button onClick={() => handleApprove(auto.id, "approve")} className={`${btnClass} py-1 px-3 text-xs flex items-center gap-1`} data-testid={`approve-${auto.id}`}>
                            <Check size={14} /> {isLcars ? "GENEHMIGEN" : "Genehmigen"}
                          </button>
                          <button onClick={() => handleApprove(auto.id, "reject")} className="py-1 px-3 text-xs rounded bg-red-900/30 text-red-400 hover:bg-red-900/50 flex items-center gap-1" data-testid={`reject-${auto.id}`}>
                            <X size={14} /> {isLcars ? "ABLEHNEN" : "Ablehnen"}
                          </button>
                        </>
                      )}
                      {auto.approval_status === "approved" && !auto.active && (
                        <button onClick={() => handleActivate(auto.id)} className={`${btnClass} py-1 px-3 text-xs flex items-center gap-1`} data-testid={`activate-${auto.id}`}>
                          <Play size={14} /> {isLcars ? "IN HA AKTIVIEREN" : "In HA aktivieren"}
                        </button>
                      )}
                      <button onClick={() => handleDelete(auto.id)} className="py-1 px-3 text-xs rounded bg-red-900/20 text-red-400 hover:bg-red-900/40 flex items-center gap-1 ml-auto" data-testid={`delete-${auto.id}`}>
                        <Trash size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Automations;

import { useState, useEffect } from "react";
import axios from "axios";
import { API, useTheme } from "@/App";
import { toast } from "sonner";
import { PencilSimple, FloppyDisk, X } from "@phosphor-icons/react";

const SECTIONS = [
  { title: "Identität", fields: [
    ["first_name", "Vorname"], ["last_name", "Nachname"], ["nickname", "Rufname"],
    ["birth_date", "Geburtsdatum"], ["gender", "Geschlecht"], ["nationality", "Nationalität"],
    ["preferred_language", "Sprache"],
  ]},
  { title: "Adresse", fields: [
    ["address_street", "Strasse"], ["address_zip", "PLZ"], ["address_city", "Ort"], ["address_country", "Land"],
  ]},
  { title: "Kontakt", fields: [
    ["phone_mobile", "Mobil"], ["phone_home", "Festnetz"],
    ["emergency_contact_name", "Notfall (Name)"], ["emergency_contact_phone", "Notfall (Telefon)"],
  ]},
  { title: "Familie", fields: [
    ["marital_status", "Familienstand"], ["partner_name", "Partner:in"],
  ]},
  { title: "Gesundheit & Küche", fields: [
    ["allergies", "Allergien"], ["intolerances", "Unverträglichkeiten"],
    ["diet", "Diät"], ["medications", "Medikamente"], ["blood_type", "Blutgruppe"],
    ["gp_name", "Hausarzt"], ["gp_phone", "Hausarzt (Tel)"], ["health_insurance", "Krankenkasse"],
  ]},
  { title: "Beruf & Präferenzen", fields: [
    ["occupation", "Beruf"], ["employer", "Arbeitgeber"],
    ["interests", "Interessen"], ["favorite_color", "Lieblingsfarbe"], ["notes", "Notizen"],
  ]},
];

const ProfilePage = () => {
  const { theme } = useTheme();
  const isLcars = theme === "startrek";
  const isStarwars = theme === "starwars";
  const [profile, setProfile] = useState({});
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);

  const load = () => axios.get(`${API}/profile/me`).then(r => setProfile(r.data || {})).catch(() => {});
  useEffect(() => { load(); }, []);

  const startEdit = () => { setDraft({ ...profile }); setEditing(true); };
  const save = async () => {
    setSaving(true);
    try {
      await axios.patch(`${API}/profile/me`, draft);
      toast.success("Profil aktualisiert");
      setEditing(false);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Fehler"); }
    finally { setSaving(false); }
  };
  const revokeConsent = async () => {
    if (!confirm("Einverständnis widerrufen? CaseDesk & CookPilot bekommen dann keinen Zugriff mehr auf dein Profil.")) return;
    try {
      await axios.patch(`${API}/profile/me`, { consent_share_with_services: false });
      toast.success("Einverständnis widerrufen");
      load();
    } catch (e) { toast.error("Fehler"); }
  };

  const cardCls = `rounded-lg p-5 mb-4 ${isLcars ? "bg-[#0a0a14] border border-[var(--lcars-orange)]/30" : isStarwars ? "disney-card" : "bg-purple-950/30 border border-purple-700/40"}`;
  const labelCls = `text-[10px] ${isLcars ? "tracking-wider text-gray-400" : "text-purple-300"}`;
  const inputCls = `w-full text-sm rounded px-2 py-1 ${isLcars ? "bg-black/60 border border-[var(--lcars-purple)]/40 text-white" : isStarwars ? "bg-black/60 border border-white/10 text-white" : "bg-purple-950/40 border border-purple-700/40 text-white"}`;
  const btnPrimary = `px-3 py-1.5 rounded text-xs font-bold ${isLcars ? "bg-[var(--lcars-orange)] text-black" : isStarwars ? "bg-[#E10600] text-white" : "bg-purple-600 text-white"}`;
  const btnGhost = `px-3 py-1.5 rounded text-xs border ${isLcars ? "border-[var(--lcars-purple)] text-[var(--lcars-purple)]" : isStarwars ? "border-white/20 text-gray-300" : "border-purple-700 text-purple-300"}`;

  return (
    <div className="p-4 md:p-8 max-w-4xl" data-testid="profile-page">
      <div className="flex items-center justify-between mb-4">
        <h1 className={`text-2xl font-bold ${isLcars ? "tracking-widest" : ""}`}>
          {isLcars ? "PROFIL" : "Mein Profil"}
        </h1>
        <div className="flex gap-2">
          {!editing ? (
            <button onClick={startEdit} className={btnPrimary} data-testid="edit-profile-btn">
              <PencilSimple size={12} className="inline mr-1" /> Bearbeiten
            </button>
          ) : (
            <>
              <button onClick={() => setEditing(false)} className={btnGhost}>
                <X size={12} className="inline mr-1" /> Abbrechen
              </button>
              <button onClick={save} disabled={saving} className={btnPrimary} data-testid="save-profile-btn">
                <FloppyDisk size={12} className="inline mr-1" /> {saving ? "Speichert..." : "Speichern"}
              </button>
            </>
          )}
        </div>
      </div>

      {!profile.onboarded_at && (
        <div className={`${cardCls} border-yellow-500/40`} data-testid="profile-not-onboarded">
          <div className="text-xs">
            Profil noch nicht vollständig eingerichtet.{" "}
            <a href="/onboarding" className={isLcars ? "text-[var(--lcars-orange)] underline" : "text-purple-300 underline"}>
              Jetzt Wizard öffnen →
            </a>
          </div>
        </div>
      )}

      {SECTIONS.map(sec => (
        <div key={sec.title} className={cardCls}>
          <h2 className={`text-sm font-bold mb-3 ${isLcars ? "tracking-widest text-[var(--lcars-orange)]" : isStarwars ? "tracking-widest text-white" : "text-purple-200"}`}>
            {isLcars ? sec.title.toUpperCase() : sec.title}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {sec.fields.map(([key, label]) => (
              <div key={key} data-testid={`profile-row-${key}`}>
                <div className={labelCls} style={{ textTransform: "none" }}>{label}</div>
                {editing ? (
                  <input className={inputCls} value={draft[key] || ""} onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))} data-testid={`profile-input-${key}`} />
                ) : (
                  <div className="text-sm" style={{ textTransform: "none" }}>{profile[key] || <span className="text-gray-600">—</span>}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className={cardCls}>
        <h2 className={`text-sm font-bold mb-2 ${isLcars ? "tracking-widest text-[var(--lcars-orange)]" : "text-purple-200"}`}>
          {isLcars ? "DATENSCHUTZ" : "Datenschutz"}
        </h2>
        <div className="text-xs" style={{ textTransform: "none" }}>
          Einverständnis zur Weitergabe an angebundene Dienste:{" "}
          <b>{profile.consent_share_with_services ? "JA (aktiv)" : "NEIN (widerrufen)"}</b>
        </div>
        {profile.consent_share_with_services && (
          <button onClick={revokeConsent} className={`mt-2 ${btnGhost}`} style={{ textTransform: "none" }} data-testid="revoke-consent-btn">
            Einverständnis widerrufen
          </button>
        )}
      </div>
    </div>
  );
};

export default ProfilePage;

import { useState, useEffect } from "react";
import axios from "axios";
import { API, useTheme, useAuth } from "@/App";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { CaretLeft, CaretRight, Check, SkipForward } from "@phosphor-icons/react";

const STEPS = [
  { id: "identity", title: "Wer bist du?", hint: "Basisdaten für Aria — die brauche ich damit dich alle Dienste persönlich ansprechen können." },
  { id: "address", title: "Wo wohnst du?", hint: "Adresse für Wetter, Lieferungen, Dokumente." },
  { id: "contact", title: "Kontakt & Notfall", hint: "Wenn mal was passiert oder Aria dich anrufen soll." },
  { id: "family", title: "Familie", hint: "Damit ich Geburtstage merke und weiß wer sonst noch im Haushalt lebt." },
  { id: "health", title: "Gesundheit & Küche", hint: "Das Wichtigste: Allergien & Diät damit CookPilot dich nicht vergiftet." },
  { id: "prefs", title: "Präferenzen", hint: "Smalltalk-Material für Aria — optional aber nett." },
  { id: "consent", title: "Datenschutz", hint: "Letzter Schritt: Einverständnis dass diese Daten an angebundene Dienste (CookPilot, CaseDesk) gehen." },
];

const OnboardingWizard = () => {
  const { theme } = useTheme();
  const { user } = useAuth();
  const isLcars = theme === "startrek";
  const isStarwars = theme === "starwars";
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState({});
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);

  // Load any partial profile
  useEffect(() => {
    axios.get(`${API}/profile/me`).then(r => setProfile(r.data || {})).catch(() => {});
  }, []);

  const update = (k, v) => setProfile(p => ({ ...p, [k]: v }));

  const saveStep = async () => {
    setSaving(true);
    try {
      await axios.patch(`${API}/profile/me`, profile);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Speichern fehlgeschlagen");
    } finally { setSaving(false); }
  };

  const next = async () => {
    await saveStep();
    if (step < STEPS.length - 1) setStep(step + 1);
  };

  const finish = async () => {
    setCompleting(true);
    try {
      await axios.post(`${API}/profile/me/complete`, profile);
      toast.success("Profil gespeichert. Aria kennt dich jetzt.");
      nav("/");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Abschluss fehlgeschlagen");
    } finally { setCompleting(false); }
  };

  const skip = async () => {
    try { await axios.post(`${API}/profile/me/skip`); } catch {}
    nav("/");
  };

  const cardCls = `rounded-lg p-6 ${isLcars ? "bg-[#0a0a14] border border-[var(--lcars-orange)]/30" : isStarwars ? "disney-card" : "bg-purple-950/30 border border-purple-700/40"}`;
  const labelCls = `block text-[11px] mb-1 ${isLcars ? "tracking-wider text-[var(--lcars-orange)]" : isStarwars ? "tracking-widest text-gray-400" : "text-purple-300"}`;
  const inputCls = `w-full text-sm rounded px-3 py-2 ${isLcars ? "bg-black/60 border border-[var(--lcars-purple)]/40 text-white" : isStarwars ? "bg-black/60 border border-white/10 text-white" : "bg-purple-950/40 border border-purple-700/40 text-white"}`;
  const btnPrimary = `px-4 py-2 rounded text-xs font-bold transition-all ${isLcars ? "bg-[var(--lcars-orange)] text-black hover:bg-yellow-400" : isStarwars ? "bg-[#E10600] text-white hover:bg-[#b30500]" : "bg-purple-600 text-white hover:bg-purple-500"}`;
  const btnGhost = `px-4 py-2 rounded text-xs transition-all ${isLcars ? "border border-[var(--lcars-purple)] text-[var(--lcars-purple)] hover:bg-[var(--lcars-purple)]/20" : isStarwars ? "border border-white/20 text-gray-300 hover:bg-white/5" : "border border-purple-700 text-purple-300 hover:bg-purple-800/30"}`;

  const cur = STEPS[step];
  const progress = ((step + 1) / STEPS.length) * 100;

  return (
    <div className="min-h-screen p-4 md:p-8 flex items-center justify-center" data-testid="onboarding-wizard">
      <div className="w-full max-w-2xl space-y-4">
        {/* Header */}
        <div className={isLcars ? "tracking-widest text-[var(--lcars-orange)]" : isStarwars ? "tracking-widest text-white" : "text-purple-200"} style={{ textTransform: "none" }}>
          <div className="text-[10px] opacity-70">{isLcars ? "WILLKOMMEN AN BORD" : isStarwars ? "IMPERIAL ONBOARDING" : "Willkommen"}</div>
          <div className={`${isLcars ? "text-2xl" : "text-3xl"} font-bold mt-1`}>Hi {user?.name?.split(" ")[0] || user?.email?.split("@")[0]}!</div>
          <div className="text-xs opacity-70 mt-1" style={{ textTransform: "none" }}>Ich möchte dich ein bisschen kennenlernen. 2 Minuten, dann bin ich dein persönlicher Assistent.</div>
        </div>

        {/* Progress */}
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] opacity-70" style={{ textTransform: "none" }}>
            <span>Schritt {step + 1} von {STEPS.length}: {cur.title}</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="h-1 bg-black/40 rounded">
            <div className="h-full rounded transition-all" style={{ width: `${progress}%`, background: isLcars ? "var(--lcars-orange)" : isStarwars ? "#E10600" : "#a855f7" }} data-testid="onboarding-progress" />
          </div>
        </div>

        {/* Step content */}
        <div className={cardCls}>
          <h2 className={`text-lg font-bold mb-1 ${isLcars ? "tracking-widest" : ""}`}>{cur.title}</h2>
          <p className="text-[11px] opacity-70 mb-4" style={{ textTransform: "none" }}>{cur.hint}</p>

          {cur.id === "identity" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><label className={labelCls}>Vorname *</label><input className={inputCls} value={profile.first_name || ""} onChange={e => update("first_name", e.target.value)} data-testid="field-first_name" /></div>
              <div><label className={labelCls}>Nachname</label><input className={inputCls} value={profile.last_name || ""} onChange={e => update("last_name", e.target.value)} data-testid="field-last_name" /></div>
              <div><label className={labelCls}>Rufname / Spitzname</label><input className={inputCls} value={profile.nickname || ""} onChange={e => update("nickname", e.target.value)} placeholder="(optional)" data-testid="field-nickname" /></div>
              <div><label className={labelCls}>Geburtsdatum</label><input type="date" className={inputCls} value={profile.birth_date || ""} onChange={e => update("birth_date", e.target.value)} data-testid="field-birth_date" /></div>
              <div><label className={labelCls}>Geschlecht</label>
                <select className={inputCls} value={profile.gender || ""} onChange={e => update("gender", e.target.value)} data-testid="field-gender">
                  <option value="">– keine Angabe –</option>
                  <option value="m">männlich</option><option value="f">weiblich</option><option value="d">divers</option>
                </select>
              </div>
              <div><label className={labelCls}>Nationalität</label><input className={inputCls} value={profile.nationality || ""} onChange={e => update("nationality", e.target.value)} placeholder="z.B. CH, DE, AT" data-testid="field-nationality" /></div>
              <div className="md:col-span-2"><label className={labelCls}>Bevorzugte Sprache</label>
                <select className={inputCls} value={profile.preferred_language || "de"} onChange={e => update("preferred_language", e.target.value)} data-testid="field-preferred_language">
                  <option value="de">Deutsch</option><option value="en">English</option><option value="fr">Français</option><option value="it">Italiano</option>
                </select>
              </div>
            </div>
          )}

          {cur.id === "address" && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2"><label className={labelCls}>Strasse & Nr.</label><input className={inputCls} value={profile.address_street || ""} onChange={e => update("address_street", e.target.value)} data-testid="field-address_street" /></div>
              <div><label className={labelCls}>PLZ</label><input className={inputCls} value={profile.address_zip || ""} onChange={e => update("address_zip", e.target.value)} data-testid="field-address_zip" /></div>
              <div className="md:col-span-2"><label className={labelCls}>Ort</label><input className={inputCls} value={profile.address_city || ""} onChange={e => update("address_city", e.target.value)} data-testid="field-address_city" /></div>
              <div><label className={labelCls}>Land</label><input className={inputCls} value={profile.address_country || "CH"} onChange={e => update("address_country", e.target.value)} data-testid="field-address_country" /></div>
            </div>
          )}

          {cur.id === "contact" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><label className={labelCls}>Mobilnummer</label><input className={inputCls} value={profile.phone_mobile || ""} onChange={e => update("phone_mobile", e.target.value)} placeholder="+41 79 ..." data-testid="field-phone_mobile" /></div>
              <div><label className={labelCls}>Festnetz</label><input className={inputCls} value={profile.phone_home || ""} onChange={e => update("phone_home", e.target.value)} data-testid="field-phone_home" /></div>
              <div><label className={labelCls}>Notfall-Kontakt (Name)</label><input className={inputCls} value={profile.emergency_contact_name || ""} onChange={e => update("emergency_contact_name", e.target.value)} data-testid="field-emergency_contact_name" /></div>
              <div><label className={labelCls}>Notfall-Kontakt (Telefon)</label><input className={inputCls} value={profile.emergency_contact_phone || ""} onChange={e => update("emergency_contact_phone", e.target.value)} data-testid="field-emergency_contact_phone" /></div>
            </div>
          )}

          {cur.id === "family" && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><label className={labelCls}>Familienstand *</label>
                  <select className={inputCls} value={profile.marital_status || ""} onChange={e => update("marital_status", e.target.value)} data-testid="field-marital_status">
                    <option value="">– bitte wählen –</option>
                    <option value="single">ledig</option><option value="relationship">in Beziehung</option>
                    <option value="married">verheiratet</option><option value="civil_partnership">eingetragene Partnerschaft</option>
                    <option value="separated">getrennt</option><option value="divorced">geschieden</option><option value="widowed">verwitwet</option>
                  </select>
                </div>
                <div><label className={labelCls}>Name Partner:in</label><input className={inputCls} value={profile.partner_name || ""} onChange={e => update("partner_name", e.target.value)} data-testid="field-partner_name" /></div>
              </div>
              <div>
                <label className={labelCls}>Kinder (Name, Geburtsdatum)</label>
                {(profile.children || []).map((c, i) => (
                  <div key={i} className="flex gap-2 mb-2" data-testid={`children-row-${i}`}>
                    <input className={`${inputCls} flex-1`} placeholder="Name" value={c.name || ""} onChange={e => update("children", profile.children.map((cc, ii) => ii === i ? { ...cc, name: e.target.value } : cc))} />
                    <input type="date" className={`${inputCls} w-40`} value={c.birth_date || ""} onChange={e => update("children", profile.children.map((cc, ii) => ii === i ? { ...cc, birth_date: e.target.value } : cc))} />
                    <button onClick={() => update("children", profile.children.filter((_, ii) => ii !== i))} className={btnGhost}>×</button>
                  </div>
                ))}
                <button onClick={() => update("children", [...(profile.children || []), { name: "", birth_date: "" }])} className={btnGhost} data-testid="add-child-btn">+ Kind hinzufügen</button>
              </div>
            </div>
          )}

          {cur.id === "health" && (
            <div className="space-y-3">
              <div><label className={labelCls}>Allergien *</label>
                <textarea className={inputCls} rows={2} value={profile.allergies || ""} onChange={e => update("allergies", e.target.value)} placeholder="z.B. Erdnüsse, Hausstaub – oder 'keine'" data-testid="field-allergies" />
              </div>
              <div><label className={labelCls}>Unverträglichkeiten</label>
                <input className={inputCls} value={profile.intolerances || ""} onChange={e => update("intolerances", e.target.value)} placeholder="Laktose, Gluten, ..." data-testid="field-intolerances" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><label className={labelCls}>Diät</label>
                  <select className={inputCls} value={profile.diet || ""} onChange={e => update("diet", e.target.value)} data-testid="field-diet">
                    <option value="">– keine besondere –</option>
                    <option value="vegetarian">vegetarisch</option><option value="vegan">vegan</option>
                    <option value="pescetarian">pescetarisch</option><option value="keto">keto</option>
                    <option value="lowcarb">Low-Carb</option><option value="halal">halal</option><option value="kosher">koscher</option>
                  </select>
                </div>
                <div><label className={labelCls}>Blutgruppe</label>
                  <select className={inputCls} value={profile.blood_type || ""} onChange={e => update("blood_type", e.target.value)} data-testid="field-blood_type">
                    <option value="">– unbekannt –</option>
                    {["0+","0-","A+","A-","B+","B-","AB+","AB-"].map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
              </div>
              <div><label className={labelCls}>Regelmässige Medikamente</label>
                <textarea className={inputCls} rows={2} value={profile.medications || ""} onChange={e => update("medications", e.target.value)} placeholder="(optional)" data-testid="field-medications" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><label className={labelCls}>Hausarzt (Name)</label><input className={inputCls} value={profile.gp_name || ""} onChange={e => update("gp_name", e.target.value)} data-testid="field-gp_name" /></div>
                <div><label className={labelCls}>Hausarzt (Telefon)</label><input className={inputCls} value={profile.gp_phone || ""} onChange={e => update("gp_phone", e.target.value)} data-testid="field-gp_phone" /></div>
              </div>
              <div><label className={labelCls}>Krankenkasse</label><input className={inputCls} value={profile.health_insurance || ""} onChange={e => update("health_insurance", e.target.value)} data-testid="field-health_insurance" /></div>
            </div>
          )}

          {cur.id === "prefs" && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><label className={labelCls}>Beruf</label><input className={inputCls} value={profile.occupation || ""} onChange={e => update("occupation", e.target.value)} data-testid="field-occupation" /></div>
                <div><label className={labelCls}>Arbeitgeber</label><input className={inputCls} value={profile.employer || ""} onChange={e => update("employer", e.target.value)} data-testid="field-employer" /></div>
              </div>
              <div><label className={labelCls}>Interessen / Hobbys</label>
                <textarea className={inputCls} rows={2} value={profile.interests || ""} onChange={e => update("interests", e.target.value)} placeholder="Kommagetrennt — Aria nutzt das für Smalltalk" data-testid="field-interests" />
              </div>
              <div><label className={labelCls}>Lieblingsfarbe</label><input className={inputCls} value={profile.favorite_color || ""} onChange={e => update("favorite_color", e.target.value)} data-testid="field-favorite_color" /></div>
              <div><label className={labelCls}>Sonstige Notizen (nur für Aria)</label>
                <textarea className={inputCls} rows={3} value={profile.notes || ""} onChange={e => update("notes", e.target.value)} placeholder="Alles was Aria über dich wissen sollte..." data-testid="field-notes" />
              </div>
            </div>
          )}

          {cur.id === "consent" && (
            <div className="space-y-3 text-sm" style={{ textTransform: "none" }}>
              <p className="opacity-80">
                Aria speichert diese Daten in deiner eigenen Mongo-Datenbank (dein Unraid-Server, keine Cloud).
                Damit CookPilot dich nicht vergiftet und CaseDesk deinen Namen auf Dokumente drucken kann,
                müssen angebundene Dienste auf dieses Profil zugreifen dürfen.
              </p>
              <label className="flex items-start gap-3 cursor-pointer" data-testid="consent-checkbox-label">
                <input type="checkbox"
                  checked={!!profile.consent_share_with_services}
                  onChange={e => update("consent_share_with_services", e.target.checked)}
                  className="mt-1"
                  data-testid="field-consent_share_with_services" />
                <span className="text-xs">
                  <b>Ich bin einverstanden</b>, dass die hier erfassten Daten an die in Aria konfigurierten
                  Dienste (CookPilot, CaseDesk, ForgePilot, Home Assistant) weitergegeben werden —
                  ausschliesslich zu Zwecken der persönlichen Nutzung durch mich. Diese Einwilligung kann ich
                  jederzeit in <i>Konto → Profil</i> widerrufen.
                </span>
              </label>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={skip} className={btnGhost} data-testid="skip-onboarding">
            <SkipForward size={12} className="inline mr-1" /> Später nachholen
          </button>
          <div className="flex-1" />
          {step > 0 && (
            <button onClick={() => setStep(step - 1)} className={btnGhost} data-testid="prev-step">
              <CaretLeft size={12} className="inline mr-1" /> Zurück
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <button onClick={next} disabled={saving} className={btnPrimary} data-testid="next-step">
              {saving ? "Speichert..." : "Weiter"} <CaretRight size={12} className="inline ml-1" />
            </button>
          ) : (
            <button onClick={finish} disabled={completing} className={btnPrimary} data-testid="finish-onboarding">
              <Check size={12} className="inline mr-1" />
              {completing ? "Speichert..." : "Fertig — los geht's"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default OnboardingWizard;

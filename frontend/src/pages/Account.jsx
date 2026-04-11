import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth, useTheme, API, formatApiError } from "@/App";
import axios from "axios";
import { toast } from "sonner";
import { ArrowLeft, User, Link as LinkIcon, Check, X, Eye, EyeSlash } from "@phosphor-icons/react";

const Account = () => {
  const { user, checkAuth } = useAuth();
  const { theme, setTheme } = useTheme();
  const [services, setServices] = useState([]);
  const [linkForm, setLinkForm] = useState({ service_id: "", username: "", password: "" });
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [showLinkPassword, setShowLinkPassword] = useState(false);

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

  const cardClass = theme === "startrek" ? "lcars-card" : "disney-card";
  const btnClass = theme === "startrek" ? "lcars-button" : "disney-button";
  const inputClass = theme === "startrek" ? "lcars-input" : "disney-input";

  return (
    <div className="min-h-screen relative z-10">
      <header className={theme === "startrek" ? "lcars-header" : "disney-header py-4 px-6"}>
        {theme === "startrek" ? (
          <>
            <div className="lcars-header-cap">
              <Link to="/" className="text-black">ARIA</Link>
            </div>
            <div className="lcars-header-bar">
              <span className="text-xs text-gray-500 ml-3 tracking-wider">BENUTZER PROFIL</span>
            </div>
            <div className="lcars-header-end" />
          </>
        ) : (
          <div className="max-w-7xl mx-auto flex items-center gap-4 w-full">
            <Link to="/" className="text-purple-200"><ArrowLeft size={24} /></Link>
            <h1 className="disney-title text-2xl font-bold">Mein Konto</h1>
          </div>
        )}
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
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
          </div>
        </div>

        {/* Theme */}
        <div className={`${cardClass} mb-6`}>
          <h3 className={theme === "startrek" ? "text-sm tracking-widest mb-4" : "font-bold mb-4"}>
            {theme === "startrek" ? "INTERFACE DESIGN" : "🎨 Theme wählen"}
          </h3>
          <div className="flex gap-4">
            <button
              onClick={() => setTheme("startrek")}
              className={`flex-1 p-4 rounded-lg border-2 transition-all ${theme === "startrek" ? "border-orange-500 bg-orange-500/10" : "border-gray-600"}`}
            >
              <div className="text-2xl mb-2">🚀</div>
              <div className="font-bold">Star Trek</div>
              <div className="text-xs text-gray-400">LCARS Interface</div>
            </button>
            <button
              onClick={() => setTheme("disney")}
              className={`flex-1 p-4 rounded-lg border-2 transition-all ${theme === "disney" ? "border-purple-500 bg-purple-500/10" : "border-gray-600"}`}
            >
              <div className="text-2xl mb-2">🏰</div>
              <div className="font-bold">Disney</div>
              <div className="text-xs text-gray-400">Magical Theme</div>
            </button>
          </div>
        </div>

        {/* Linked Services */}
        <div className={cardClass}>
          <div className="flex justify-between items-center mb-4">
            <h3 className={theme === "startrek" ? "text-sm tracking-widest" : "font-bold"}>
              {theme === "startrek" ? "VERKNÜPFTE DIENSTE" : "🔗 Verknüpfte Konten"}
            </h3>
            <button onClick={() => setShowLinkForm(!showLinkForm)} className={btnClass}>
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
      </main>
    </div>
  );
};

export default Account;

import { useState } from "react";
import { useAuth, API, formatApiError } from "@/App";
import axios from "axios";
import { toast } from "sonner";
import { HardDrives, User, ArrowRight, Check, Eye, EyeSlash } from "@phosphor-icons/react";

const SetupWizard = () => {
  const { completeSetup } = useAuth();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({ name: "", email: "", password: "", confirmPassword: "" });

  const handleCreateAdmin = async () => {
    if (!formData.name.trim()) return toast.error("Name erforderlich");
    if (!formData.email.includes("@")) return toast.error("Gültige E-Mail erforderlich");
    if (formData.password.length < 6) return toast.error("Passwort min. 6 Zeichen");
    if (formData.password !== formData.confirmPassword) return toast.error("Passwörter stimmen nicht überein");

    setLoading(true);
    try {
      await completeSetup(formData.email, formData.password, formData.name);
      toast.success("Admin-Account erstellt!");
      setStep(2);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  };

  const finishSetup = () => window.location.href = "/";

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-orange-500 to-purple-600 mb-4">
            <HardDrives size={40} weight="duotone" className="text-white" />
          </div>
          <h1 className="text-4xl font-bold text-white">Aria Setup</h1>
          <p className="text-gray-400 mt-2">Konfiguriere dein Dashboard</p>
        </div>

        <div className="flex justify-center gap-2 mb-8">
          <div className={`h-2 w-16 rounded-full ${step >= 1 ? 'bg-orange-500' : 'bg-gray-700'}`} />
          <div className={`h-2 w-16 rounded-full ${step >= 2 ? 'bg-orange-500' : 'bg-gray-700'}`} />
        </div>

        {step === 1 && (
          <div className="bg-gray-800/50 backdrop-blur rounded-2xl border border-gray-700 p-8">
            <div className="flex items-center gap-3 mb-6">
              <User size={24} className="text-orange-500" />
              <h2 className="text-xl font-bold text-white">Admin-Account erstellen</h2>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-300 mb-1">Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Dein Name"
                  className="w-full px-4 py-3 bg-gray-900 border border-gray-600 rounded-lg text-white focus:border-orange-500 focus:outline-none"
                  data-testid="setup-name-input"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">E-Mail</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="admin@example.com"
                  className="w-full px-4 py-3 bg-gray-900 border border-gray-600 rounded-lg text-white focus:border-orange-500 focus:outline-none"
                  data-testid="setup-email-input"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Passwort</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder="Min. 6 Zeichen"
                    className="w-full px-4 py-3 bg-gray-900 border border-gray-600 rounded-lg text-white focus:border-orange-500 focus:outline-none pr-10"
                    data-testid="setup-password-input"
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                    {showPassword ? <EyeSlash size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Passwort bestätigen</label>
                <input
                  type="password"
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                  placeholder="Passwort wiederholen"
                  className="w-full px-4 py-3 bg-gray-900 border border-gray-600 rounded-lg text-white focus:border-orange-500 focus:outline-none"
                  data-testid="setup-confirm-password-input"
                />
              </div>
            </div>

            <button
              onClick={handleCreateAdmin}
              disabled={loading}
              className="w-full mt-6 py-3 bg-gradient-to-r from-orange-500 to-purple-600 text-white font-bold rounded-lg hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
              data-testid="setup-create-admin-button"
            >
              {loading ? "Erstelle..." : <>Weiter <ArrowRight size={18} /></>}
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="bg-gray-800/50 backdrop-blur rounded-2xl border border-gray-700 p-8 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-500/20 border border-green-500 mb-6">
              <Check size={32} className="text-green-500" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Setup abgeschlossen!</h2>
            <p className="text-gray-400 mb-6">Dein Aria Dashboard ist bereit.</p>
            <button
              onClick={finishSetup}
              className="w-full py-3 bg-gradient-to-r from-orange-500 to-purple-600 text-white font-bold rounded-lg hover:opacity-90"
              data-testid="setup-finish-button"
            >
              Zum Dashboard <ArrowRight size={18} className="inline ml-2" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default SetupWizard;

import { useState } from "react";
import { useAuth, useTheme, formatApiError } from "@/App";
import { toast } from "sonner";
import { Eye, EyeSlash } from "@phosphor-icons/react";

const Login = () => {
  const { login } = useAuth();
  const { theme } = useTheme();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({ email: "", password: "" });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.email || !formData.password) {
      toast.error("Bitte fülle alle Felder aus");
      return;
    }
    setLoading(true);
    try {
      await login(formData.email, formData.password);
      toast.success("Willkommen!");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Login fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  };

  if (theme === "startrek") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          {/* LCARS Frame around login */}
          <div className="mb-6">
            <div className="flex gap-2 mb-2">
              <div className="h-3 flex-1 bg-[var(--lcars-orange)] rounded-l-full rounded-r" />
              <div className="h-3 w-16 bg-[var(--lcars-mauve)] rounded" />
              <div className="h-3 w-10 bg-[var(--lcars-purple)] rounded-r-full" />
            </div>
            <h1 className="text-4xl font-bold tracking-[0.3em] text-center text-[var(--lcars-orange)] my-6">ARIA</h1>
            <p className="text-center text-xs tracking-[0.2em] text-gray-500">ZUGANGSPORTAL</p>
          </div>

          <div className="lcars-card">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="lcars-label block mb-2">BENUTZER-ID</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="name@domain.com"
                  className="lcars-input w-full"
                  data-testid="login-email-input"
                />
              </div>
              <div>
                <label className="lcars-label block mb-2">ZUGANGSCODE</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder="..."
                    className="lcars-input w-full pr-10"
                    data-testid="login-password-input"
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--lcars-purple)]">
                    {showPassword ? <EyeSlash size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
              <button type="submit" disabled={loading} className="lcars-button w-full h-12 text-lg" data-testid="login-submit-button">
                {loading ? "AUTHENTIFIZIERUNG..." : "ZUGANG GEWÄHREN"}
              </button>
            </form>
          </div>

          <div className="flex gap-2 mt-4">
            <div className="h-2 flex-1 bg-[var(--lcars-blue)] rounded-l-full rounded-r" />
            <div className="h-2 w-20 bg-[var(--lcars-salmon)] rounded" />
            <div className="h-2 flex-1 bg-[var(--lcars-purple)] rounded-r-full" />
          </div>
          <p className="text-center text-gray-700 text-[10px] mt-4 tracking-[0.2em]">
            ARIA V2.0 LCARS INTERFACE
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative z-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="disney-title text-4xl font-bold disney-glow">Aria</h1>
          <p className="text-purple-300 mt-2">Willkommen zurück in deinem Königreich</p>
        </div>
        <div className="disney-panel p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm text-purple-300 mb-2">E-Mail</label>
              <input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="deine@email.com" className="disney-input w-full" data-testid="login-email-input" />
            </div>
            <div>
              <label className="block text-sm text-purple-300 mb-2">Passwort</label>
              <div className="relative">
                <input type={showPassword ? "text" : "password"} value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="..." className="disney-input w-full pr-10" data-testid="login-password-input" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-purple-400">
                  {showPassword ? <EyeSlash size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            <button type="submit" disabled={loading} className="disney-button w-full h-12 text-lg" data-testid="login-submit-button">
              {loading ? "Einen Moment..." : "Eintreten"}
            </button>
          </form>
        </div>
        <p className="text-center text-purple-400 text-sm mt-6">Aria Dashboard v2.0</p>
      </div>
    </div>
  );
};

export default Login;

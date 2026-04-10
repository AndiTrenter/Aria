import { useState } from "react";
import { useAuth, useTheme, formatApiError } from "@/App";
import { toast } from "sonner";
import { HardDrives, SignIn, Eye, EyeSlash } from "@phosphor-icons/react";

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

  // Star Trek Theme
  if (theme === "startrek") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full border-4 border-orange-500 mb-4">
              <HardDrives size={40} weight="duotone" className="text-orange-500" />
            </div>
            <h1 className="text-4xl font-bold tracking-widest">ARIA</h1>
            <p className="text-gray-500 mt-2 tracking-wide">ZUGANGSPORTAL</p>
          </div>

          <div className="lcars-card">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-xs text-orange-400 mb-2 tracking-widest">BENUTZER-ID</label>
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
                <label className="block text-xs text-orange-400 mb-2 tracking-widest">ZUGANGSCODE</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder="••••••••"
                    className="lcars-input w-full pr-10"
                    data-testid="login-password-input"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-orange-400"
                  >
                    {showPassword ? <EyeSlash size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="lcars-button w-full h-12 text-lg"
                data-testid="login-submit-button"
              >
                {loading ? "AUTHENTIFIZIERUNG..." : "ZUGANG GEWÄHREN"}
              </button>
            </form>
          </div>

          <p className="text-center text-gray-600 text-xs mt-6 tracking-wide">
            ARIA DASHBOARD V2.0 | LCARS INTERFACE
          </p>
        </div>
      </div>
    );
  }

  // Disney Theme
  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative z-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-6xl mb-4">🏰</div>
          <h1 className="disney-title text-4xl font-bold disney-glow">Aria</h1>
          <p className="text-purple-300 mt-2">Willkommen zurück in deinem Königreich</p>
        </div>

        <div className="disney-panel p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm text-purple-300 mb-2">E-Mail</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="deine@email.com"
                className="disney-input w-full"
                data-testid="login-email-input"
              />
            </div>
            <div>
              <label className="block text-sm text-purple-300 mb-2">Passwort</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="••••••••"
                  className="disney-input w-full pr-10"
                  data-testid="login-password-input"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-purple-400"
                >
                  {showPassword ? <EyeSlash size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="disney-button w-full h-12 text-lg"
              data-testid="login-submit-button"
            >
              {loading ? "Einen Moment..." : "Eintreten ✨"}
            </button>
          </form>
        </div>

        <p className="text-center text-purple-400 text-sm mt-6">
          ✨ Aria Dashboard v2.0 ✨
        </p>
      </div>
    </div>
  );
};

export default Login;

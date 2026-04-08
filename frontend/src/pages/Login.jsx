import { useState } from "react";
import { motion } from "framer-motion";
import { useAuth, formatApiError } from "@/App";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HardDrives, SignIn, Spinner, Eye, EyeSlash } from "@phosphor-icons/react";

const Login = () => {
  const { login } = useAuth();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    email: "",
    password: ""
  });

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.email || !formData.password) {
      toast.error("Bitte fülle alle Felder aus");
      return;
    }

    setLoading(true);
    try {
      await login(formData.email, formData.password);
      toast.success("Erfolgreich angemeldet!");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Login fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div 
      className="min-h-screen bg-zinc-950 flex items-center justify-center p-4 relative overflow-hidden"
      style={{
        backgroundImage: `linear-gradient(rgba(0,0,0,0.85), rgba(0,0,0,0.95)), url('https://images.unsplash.com/photo-1676068646516-5eda1745a641?w=1920&q=80')`,
        backgroundSize: 'cover',
        backgroundPosition: 'center'
      }}
    >
      {/* Background grid */}
      <div className="absolute inset-0 bg-grid-pattern opacity-30" />
      
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md relative z-10"
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", duration: 0.6 }}
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-zinc-900 border border-white/10 mb-4"
          >
            <HardDrives size={32} weight="duotone" className="text-zinc-50" />
          </motion.div>
          <h1 className="text-4xl font-bold tracking-tight text-zinc-50 font-['Outfit']">Aria</h1>
          <p className="text-zinc-400 mt-2">Dashboard Login</p>
        </div>

        {/* Login Form */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-zinc-900 rounded-3xl border border-white/10 p-8"
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="email" className="text-zinc-300">E-Mail</Label>
              <Input
                id="email"
                name="email"
                type="email"
                value={formData.email}
                onChange={handleInputChange}
                placeholder="deine@email.com"
                className="mt-1.5 bg-zinc-800/50 border-white/10 focus:border-zinc-50 text-zinc-50 placeholder:text-zinc-500"
                data-testid="login-email-input"
                autoComplete="email"
              />
            </div>
            <div>
              <Label htmlFor="password" className="text-zinc-300">Passwort</Label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  value={formData.password}
                  onChange={handleInputChange}
                  placeholder="Dein Passwort"
                  className="mt-1.5 bg-zinc-800/50 border-white/10 focus:border-zinc-50 text-zinc-50 placeholder:text-zinc-500 pr-10"
                  data-testid="login-password-input"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-50 mt-0.5"
                >
                  {showPassword ? <EyeSlash size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full mt-6 bg-zinc-50 text-zinc-950 hover:bg-zinc-200 h-12 text-base font-medium"
              data-testid="login-submit-button"
            >
              {loading ? (
                <Spinner size={20} className="animate-spin" />
              ) : (
                <>
                  <SignIn size={18} className="mr-2" />
                  Anmelden
                </>
              )}
            </Button>
          </form>
        </motion.div>

        {/* Footer */}
        <p className="text-center text-zinc-500 text-sm mt-6">
          Aria Dashboard v1.0
        </p>
      </motion.div>
    </div>
  );
};

export default Login;

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth, API, formatApiError } from "@/App";
import axios from "axios";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  HardDrives, 
  User, 
  ArrowRight, 
  ArrowLeft, 
  Check,
  Spinner,
  CloudArrowDown,
  Eye,
  EyeSlash
} from "@phosphor-icons/react";

const SetupWizard = () => {
  const { completeSetup } = useAuth();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  
  // Form data
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: ""
  });
  
  // Containers
  const [containers, setContainers] = useState([]);
  const [selectedContainers, setSelectedContainers] = useState([]);
  const [scanningContainers, setScanningContainers] = useState(false);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const validateStep1 = () => {
    if (!formData.name.trim()) {
      toast.error("Bitte gib deinen Namen ein");
      return false;
    }
    if (!formData.email.trim() || !formData.email.includes("@")) {
      toast.error("Bitte gib eine gültige E-Mail ein");
      return false;
    }
    if (formData.password.length < 6) {
      toast.error("Passwort muss mindestens 6 Zeichen haben");
      return false;
    }
    if (formData.password !== formData.confirmPassword) {
      toast.error("Passwörter stimmen nicht überein");
      return false;
    }
    return true;
  };

  const handleCreateAdmin = async () => {
    if (!validateStep1()) return;
    
    setLoading(true);
    try {
      await completeSetup(formData.email, formData.password, formData.name);
      toast.success("Admin-Account erstellt!");
      setStep(2);
      // Start scanning for containers
      scanContainers();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  };

  const scanContainers = async () => {
    setScanningContainers(true);
    try {
      const { data } = await axios.get(`${API}/docker/containers`);
      setContainers(data);
    } catch (e) {
      console.error("Container scan error:", e);
      toast.error("Container konnten nicht geladen werden");
    } finally {
      setScanningContainers(false);
    }
  };

  const toggleContainer = (containerId) => {
    setSelectedContainers(prev => 
      prev.includes(containerId)
        ? prev.filter(id => id !== containerId)
        : [...prev, containerId]
    );
  };

  const handleAddContainers = async () => {
    if (selectedContainers.length === 0) {
      setStep(3);
      return;
    }
    
    setLoading(true);
    try {
      const containersToAdd = containers.filter(c => selectedContainers.includes(c.id));
      await axios.post(`${API}/docker/containers/add`, containersToAdd);
      toast.success(`${selectedContainers.length} Container hinzugefügt!`);
      setStep(3);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  };

  const finishSetup = () => {
    window.location.href = "/";
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
        className="w-full max-w-lg relative z-10"
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
          <p className="text-zinc-400 mt-2">Dashboard Setup</p>
        </div>

        {/* Progress */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`h-2 rounded-full transition-all duration-300 ${
                s === step ? "w-8 bg-zinc-50" : s < step ? "w-2 bg-emerald-500" : "w-2 bg-zinc-800"
              }`}
            />
          ))}
        </div>

        {/* Steps */}
        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="bg-zinc-900 rounded-3xl border border-white/10 p-8"
            >
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-xl bg-zinc-800">
                  <User size={24} weight="duotone" className="text-zinc-50" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-zinc-50 font-['Outfit']">Admin-Account</h2>
                  <p className="text-sm text-zinc-400">Erstelle deinen Administrator-Zugang</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <Label htmlFor="name" className="text-zinc-300">Name</Label>
                  <Input
                    id="name"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    placeholder="Dein Name"
                    className="mt-1.5 bg-zinc-800/50 border-white/10 focus:border-zinc-50 text-zinc-50 placeholder:text-zinc-500"
                    data-testid="setup-name-input"
                  />
                </div>
                <div>
                  <Label htmlFor="email" className="text-zinc-300">E-Mail</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    placeholder="admin@example.com"
                    className="mt-1.5 bg-zinc-800/50 border-white/10 focus:border-zinc-50 text-zinc-50 placeholder:text-zinc-500"
                    data-testid="setup-email-input"
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
                      placeholder="Mindestens 6 Zeichen"
                      className="mt-1.5 bg-zinc-800/50 border-white/10 focus:border-zinc-50 text-zinc-50 placeholder:text-zinc-500 pr-10"
                      data-testid="setup-password-input"
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
                <div>
                  <Label htmlFor="confirmPassword" className="text-zinc-300">Passwort bestätigen</Label>
                  <Input
                    id="confirmPassword"
                    name="confirmPassword"
                    type="password"
                    value={formData.confirmPassword}
                    onChange={handleInputChange}
                    placeholder="Passwort wiederholen"
                    className="mt-1.5 bg-zinc-800/50 border-white/10 focus:border-zinc-50 text-zinc-50 placeholder:text-zinc-500"
                    data-testid="setup-confirm-password-input"
                  />
                </div>
              </div>

              <Button
                onClick={handleCreateAdmin}
                disabled={loading}
                className="w-full mt-6 bg-zinc-50 text-zinc-950 hover:bg-zinc-200 h-12 text-base font-medium"
                data-testid="setup-create-admin-button"
              >
                {loading ? (
                  <Spinner size={20} className="animate-spin" />
                ) : (
                  <>
                    Weiter
                    <ArrowRight size={18} className="ml-2" />
                  </>
                )}
              </Button>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="bg-zinc-900 rounded-3xl border border-white/10 p-8"
            >
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-xl bg-zinc-800">
                  <CloudArrowDown size={24} weight="duotone" className="text-zinc-50" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-zinc-50 font-['Outfit']">Docker Container</h2>
                  <p className="text-sm text-zinc-400">Wähle Container für dein Dashboard</p>
                </div>
              </div>

              {scanningContainers ? (
                <div className="py-12 text-center">
                  <Spinner size={32} className="animate-spin text-zinc-400 mx-auto mb-3" />
                  <p className="text-zinc-400">Scanne nach Docker Containern...</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto pr-2">
                  {containers.length === 0 ? (
                    <div className="py-8 text-center text-zinc-400">
                      <p>Keine Container gefunden.</p>
                      <p className="text-sm mt-1">Du kannst später manuell Kacheln hinzufügen.</p>
                    </div>
                  ) : (
                    containers.map((container) => (
                      <div
                        key={container.id}
                        className={`flex items-center gap-3 p-4 rounded-xl border transition-all cursor-pointer ${
                          selectedContainers.includes(container.id)
                            ? "bg-zinc-800 border-zinc-50/20"
                            : "bg-zinc-800/50 border-white/5 hover:border-white/10"
                        }`}
                        onClick={() => toggleContainer(container.id)}
                        data-testid={`container-${container.name}`}
                      >
                        <Checkbox
                          checked={selectedContainers.includes(container.id)}
                          onCheckedChange={() => toggleContainer(container.id)}
                          className="border-zinc-600 data-[state=checked]:bg-zinc-50 data-[state=checked]:text-zinc-950"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-zinc-50 truncate">
                            {container.name}
                          </p>
                          <p className="text-xs text-zinc-500 truncate">{container.image}</p>
                        </div>
                        <div
                          className={`px-2 py-1 rounded-full text-xs font-medium ${
                            container.status === "running"
                              ? "status-running"
                              : "status-stopped"
                          }`}
                        >
                          {container.status === "running" ? "Läuft" : "Gestoppt"}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              <div className="flex gap-3 mt-6">
                <Button
                  variant="outline"
                  onClick={() => setStep(1)}
                  className="flex-1 border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                  data-testid="setup-back-button"
                >
                  <ArrowLeft size={18} className="mr-2" />
                  Zurück
                </Button>
                <Button
                  onClick={handleAddContainers}
                  disabled={loading}
                  className="flex-1 bg-zinc-50 text-zinc-950 hover:bg-zinc-200"
                  data-testid="setup-add-containers-button"
                >
                  {loading ? (
                    <Spinner size={20} className="animate-spin" />
                  ) : (
                    <>
                      {selectedContainers.length > 0 ? `${selectedContainers.length} hinzufügen` : "Überspringen"}
                      <ArrowRight size={18} className="ml-2" />
                    </>
                  )}
                </Button>
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="bg-zinc-900 rounded-3xl border border-white/10 p-8 text-center"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", duration: 0.5 }}
                className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-6"
              >
                <Check size={32} weight="bold" className="text-emerald-500" />
              </motion.div>
              
              <h2 className="text-2xl font-bold text-zinc-50 font-['Outfit'] mb-2">Setup abgeschlossen!</h2>
              <p className="text-zinc-400 mb-8">
                Dein Aria Dashboard ist bereit. Du kannst jetzt loslegen!
              </p>

              <Button
                onClick={finishSetup}
                className="w-full bg-zinc-50 text-zinc-950 hover:bg-zinc-200 h-12 text-base font-medium"
                data-testid="setup-finish-button"
              >
                Zum Dashboard
                <ArrowRight size={18} className="ml-2" />
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
};

export default SetupWizard;

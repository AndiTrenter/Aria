import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth, useTheme, API, formatApiError } from "@/App";
import axios from "axios";
import { toast } from "sonner";
import { ArrowLeft, Plus, User, Trash, PencilSimple, Check, X, HardDrives, Shield } from "@phosphor-icons/react";

const Admin = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [users, setUsers] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("users");
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({ email: "", password: "", name: "", role: "user" });
  const [editingServices, setEditingServices] = useState(null);

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    try {
      const [usersRes, servicesRes] = await Promise.all([
        axios.get(`${API}/admin/users`),
        axios.get(`${API}/services`)
      ]);
      setUsers(usersRes.data);
      setServices(servicesRes.data);
    } catch (e) {
      toast.error("Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  };

  const handleAddUser = async () => {
    if (!newUser.email || !newUser.password || !newUser.name) {
      toast.error("Alle Felder ausfüllen");
      return;
    }
    try {
      await axios.post(`${API}/admin/users`, newUser);
      toast.success("Benutzer erstellt");
      setShowAddUser(false);
      setNewUser({ email: "", password: "", name: "", role: "user" });
      fetchData();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  const handleDeleteUser = async (userId) => {
    if (!window.confirm("Benutzer wirklich löschen?")) return;
    try {
      await axios.delete(`${API}/admin/users/${userId}`);
      toast.success("Benutzer gelöscht");
      fetchData();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  const handleToggleActive = async (userId, currentActive) => {
    try {
      await axios.put(`${API}/admin/users/${userId}`, { is_active: !currentActive });
      toast.success(currentActive ? "Deaktiviert" : "Aktiviert");
      fetchData();
    } catch (e) {
      toast.error("Fehler");
    }
  };

  const handleUpdateServices = async (userId, serviceIds) => {
    try {
      await axios.put(`${API}/admin/users/${userId}/services`, { services: serviceIds });
      toast.success("Dienste aktualisiert");
      setEditingServices(null);
      fetchData();
    } catch (e) {
      toast.error("Fehler");
    }
  };

  const cardClass = theme === "startrek" ? "lcars-card" : "disney-card";
  const btnClass = theme === "startrek" ? "lcars-button" : "disney-button";
  const inputClass = theme === "startrek" ? "lcars-input" : "disney-input";

  return (
    <div className="min-h-screen relative z-10">
      {/* Header */}
      <header className={theme === "startrek" ? "lcars-header px-6 flex items-center" : "disney-header py-4 px-6"}>
        <div className="max-w-7xl mx-auto flex items-center gap-4 w-full">
          <Link to="/" className={theme === "startrek" ? "text-black hover:text-gray-700" : "text-purple-200 hover:text-white"}>
            <ArrowLeft size={24} />
          </Link>
          {theme === "startrek" ? (
            <span className="text-black font-bold text-xl tracking-widest">ADMIN KONTROLLE</span>
          ) : (
            <h1 className="disney-title text-2xl font-bold">👑 Admin-Bereich</h1>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Tabs */}
        <div className="flex gap-4 mb-8">
          <button
            onClick={() => setActiveTab("users")}
            className={`px-6 py-2 rounded-full font-bold transition-all ${activeTab === "users" ? btnClass : 'bg-gray-700 text-gray-300'}`}
          >
            <User size={18} className="inline mr-2" /> Benutzer
          </button>
          <button
            onClick={() => setActiveTab("services")}
            className={`px-6 py-2 rounded-full font-bold transition-all ${activeTab === "services" ? btnClass : 'bg-gray-700 text-gray-300'}`}
          >
            <HardDrives size={18} className="inline mr-2" /> Dienste
          </button>
        </div>

        {/* Users Tab */}
        {activeTab === "users" && (
          <div className={cardClass}>
            <div className="flex justify-between items-center mb-6">
              <h2 className={theme === "startrek" ? "text-lg tracking-widest" : "disney-title text-xl"}>
                {theme === "startrek" ? "BENUTZER DATENBANK" : "Benutzer verwalten"}
              </h2>
              <button onClick={() => setShowAddUser(true)} className={btnClass}>
                <Plus size={16} className="inline mr-1" /> Neu
              </button>
            </div>

            {showAddUser && (
              <div className="mb-6 p-4 bg-gray-900/50 rounded-lg border border-gray-700">
                <h3 className="font-bold mb-4">Neuer Benutzer</h3>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <input placeholder="Name" value={newUser.name} onChange={(e) => setNewUser({...newUser, name: e.target.value})} className={inputClass} />
                  <input placeholder="E-Mail" value={newUser.email} onChange={(e) => setNewUser({...newUser, email: e.target.value})} className={inputClass} />
                  <input type="password" placeholder="Passwort" value={newUser.password} onChange={(e) => setNewUser({...newUser, password: e.target.value})} className={inputClass} />
                  <select value={newUser.role} onChange={(e) => setNewUser({...newUser, role: e.target.value})} className={inputClass}>
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                    <option value="readonly">ReadOnly</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <button onClick={handleAddUser} className={btnClass}>Erstellen</button>
                  <button onClick={() => setShowAddUser(false)} className="px-4 py-2 bg-gray-700 rounded-lg">Abbrechen</button>
                </div>
              </div>
            )}

            <div className="space-y-3">
              {users.map((u) => (
                <div key={u.id} className="flex items-center gap-4 p-4 bg-gray-900/30 rounded-lg border border-gray-700">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-500 to-purple-600 flex items-center justify-center">
                    <User size={20} className="text-white" />
                  </div>
                  <div className="flex-1">
                    <div className="font-bold">{u.name}</div>
                    <div className="text-sm text-gray-400">{u.email}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-1 rounded text-xs ${u.role === 'superadmin' ? 'bg-purple-600' : u.role === 'admin' ? 'bg-orange-600' : 'bg-gray-600'}`}>
                      {u.role}
                    </span>
                    <span className={`px-2 py-1 rounded text-xs ${u.is_active ? 'bg-green-600' : 'bg-red-600'}`}>
                      {u.is_active ? 'Aktiv' : 'Inaktiv'}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setEditingServices(editingServices === u.id ? null : u.id)} className="p-2 hover:bg-gray-700 rounded" title="Dienste">
                      <Shield size={18} />
                    </button>
                    <button onClick={() => handleToggleActive(u.id, u.is_active)} className="p-2 hover:bg-gray-700 rounded" title={u.is_active ? "Deaktivieren" : "Aktivieren"}>
                      {u.is_active ? <X size={18} /> : <Check size={18} />}
                    </button>
                    {u.role !== 'superadmin' && (
                      <button onClick={() => handleDeleteUser(u.id)} className="p-2 hover:bg-red-900 rounded text-red-400" title="Löschen">
                        <Trash size={18} />
                      </button>
                    )}
                  </div>
                  
                  {editingServices === u.id && (
                    <div className="w-full mt-4 p-4 bg-gray-800 rounded-lg">
                      <h4 className="font-bold mb-2">Dienst-Freigaben</h4>
                      <div className="flex flex-wrap gap-2">
                        {services.map((s) => {
                          const isAllowed = u.allowed_services?.includes(s.id);
                          return (
                            <button
                              key={s.id}
                              onClick={() => {
                                const newServices = isAllowed 
                                  ? u.allowed_services.filter(id => id !== s.id)
                                  : [...(u.allowed_services || []), s.id];
                                handleUpdateServices(u.id, newServices);
                              }}
                              className={`px-3 py-1 rounded-full text-sm ${isAllowed ? 'bg-green-600' : 'bg-gray-600'}`}
                            >
                              {s.name} {isAllowed ? '✓' : ''}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Services Tab */}
        {activeTab === "services" && (
          <div className={cardClass}>
            <h2 className={theme === "startrek" ? "text-lg tracking-widest mb-6" : "disney-title text-xl mb-6"}>
              {theme === "startrek" ? "DIENSTE KONFIGURATION" : "Dienste"}
            </h2>
            <div className="space-y-3">
              {services.map((s) => (
                <div key={s.id} className="flex items-center gap-4 p-4 bg-gray-900/30 rounded-lg border border-gray-700">
                  <HardDrives size={24} className="text-orange-500" />
                  <div className="flex-1">
                    <div className="font-bold">{s.name}</div>
                    <div className="text-sm text-gray-400">{s.url}</div>
                  </div>
                  <span className="px-2 py-1 rounded text-xs bg-gray-600">{s.category}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default Admin;

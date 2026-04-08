import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useAuth, API, formatApiError } from "@/App";
import { Link } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  HardDrives,
  ArrowLeft,
  Plus,
  Cube,
  Cloud,
  HouseLine,
  PlayCircle,
  Wrench,
  Files,
  Folder,
  Trash,
  PencilSimple,
  Eye,
  EyeSlash,
  CloudArrowDown,
  Spinner,
  Circle,
  X,
  Check
} from "@phosphor-icons/react";

// Icon options
const iconOptions = [
  { value: "cube", label: "Würfel", Icon: Cube },
  { value: "hard-drives", label: "Server", Icon: HardDrives },
  { value: "cloud", label: "Cloud", Icon: Cloud },
  { value: "house-line", label: "Haus", Icon: HouseLine },
  { value: "play-circle", label: "Medien", Icon: PlayCircle },
  { value: "wrench", label: "Tools", Icon: Wrench },
  { value: "files", label: "Dateien", Icon: Files },
  { value: "folder", label: "Ordner", Icon: Folder },
];

const iconMap = {
  "hard-drives": HardDrives,
  "cube": Cube,
  "cloud": Cloud,
  "house-line": HouseLine,
  "play-circle": PlayCircle,
  "wrench": Wrench,
  "files": Files,
  "folder": Folder,
};

const getIcon = (iconName) => {
  return iconMap[iconName] || Cube;
};

const Admin = () => {
  const { user } = useAuth();
  const [tiles, setTiles] = useState([]);
  const [categories, setCategories] = useState([]);
  const [containers, setContainers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scanningContainers, setScanningContainers] = useState(false);
  
  // Dialog states
  const [addTileOpen, setAddTileOpen] = useState(false);
  const [editTileOpen, setEditTileOpen] = useState(false);
  const [selectedTile, setSelectedTile] = useState(null);
  
  // Form data
  const [tileForm, setTileForm] = useState({
    name: "",
    url: "",
    icon: "cube",
    category: "Sonstige",
    description: "",
    visible: true
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [tilesRes, categoriesRes] = await Promise.all([
        axios.get(`${API}/tiles`),
        axios.get(`${API}/categories`)
      ]);
      setTiles(tilesRes.data);
      setCategories(categoriesRes.data);
    } catch (e) {
      console.error("Failed to fetch data:", e);
      toast.error("Daten konnten nicht geladen werden");
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

  const handleAddTile = async () => {
    if (!tileForm.name || !tileForm.url) {
      toast.error("Name und URL sind erforderlich");
      return;
    }
    
    try {
      const { data } = await axios.post(`${API}/tiles`, tileForm);
      setTiles(prev => [...prev, data]);
      setAddTileOpen(false);
      setTileForm({
        name: "",
        url: "",
        icon: "cube",
        category: "Sonstige",
        description: "",
        visible: true
      });
      toast.success("Kachel hinzugefügt!");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  const handleEditTile = async () => {
    if (!selectedTile) return;
    
    try {
      const { data } = await axios.put(`${API}/tiles/${selectedTile.id}`, tileForm);
      setTiles(prev => prev.map(t => t.id === selectedTile.id ? data : t));
      setEditTileOpen(false);
      setSelectedTile(null);
      toast.success("Kachel aktualisiert!");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  const handleDeleteTile = async (tileId) => {
    try {
      await axios.delete(`${API}/tiles/${tileId}`);
      setTiles(prev => prev.filter(t => t.id !== tileId));
      toast.success("Kachel gelöscht!");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  const handleToggleVisibility = async (tile) => {
    try {
      const { data } = await axios.put(`${API}/tiles/${tile.id}`, {
        visible: !tile.visible
      });
      setTiles(prev => prev.map(t => t.id === tile.id ? data : t));
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  const openEditDialog = (tile) => {
    setSelectedTile(tile);
    setTileForm({
      name: tile.name,
      url: tile.url,
      icon: tile.icon,
      category: tile.category,
      description: tile.description || "",
      visible: tile.visible
    });
    setEditTileOpen(true);
  };

  const addContainerAsTile = async (container) => {
    try {
      await axios.post(`${API}/docker/containers/add`, [container]);
      await fetchData();
      // Update container status
      setContainers(prev => prev.map(c => 
        c.id === container.id ? { ...c, added_to_dashboard: true } : c
      ));
      toast.success(`${container.name} zum Dashboard hinzugefügt!`);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Header */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-zinc-950/70 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <Button asChild variant="ghost" size="icon" className="text-zinc-400 hover:text-zinc-50">
                <Link to="/" data-testid="back-to-dashboard">
                  <ArrowLeft size={20} />
                </Link>
              </Button>
              <div>
                <h1 className="text-xl font-bold text-zinc-50 font-['Outfit']">Admin-Bereich</h1>
                <p className="text-xs text-zinc-500">Kacheln und Container verwalten</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <Tabs defaultValue="tiles" className="space-y-6">
          <TabsList className="bg-zinc-900 border border-white/5">
            <TabsTrigger 
              value="tiles" 
              className="data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-50"
              data-testid="tab-tiles"
            >
              Kacheln
            </TabsTrigger>
            <TabsTrigger 
              value="containers"
              className="data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-50"
              data-testid="tab-containers"
            >
              Docker Container
            </TabsTrigger>
          </TabsList>

          {/* Tiles Tab */}
          <TabsContent value="tiles" className="space-y-6">
            {/* Actions */}
            <div className="flex justify-between items-center">
              <p className="text-zinc-400 text-sm">{tiles.length} Kacheln</p>
              <Dialog open={addTileOpen} onOpenChange={setAddTileOpen}>
                <DialogTrigger asChild>
                  <Button className="bg-zinc-50 text-zinc-950 hover:bg-zinc-200" data-testid="add-tile-button">
                    <Plus size={16} className="mr-2" />
                    Neue Kachel
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-zinc-900 border-white/10 text-zinc-50">
                  <DialogHeader>
                    <DialogTitle className="font-['Outfit']">Neue Kachel erstellen</DialogTitle>
                    <DialogDescription className="text-zinc-400">
                      Füge einen neuen Dienst zu deinem Dashboard hinzu.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-zinc-300">Name</Label>
                        <Input
                          value={tileForm.name}
                          onChange={(e) => setTileForm(prev => ({ ...prev, name: e.target.value }))}
                          placeholder="z.B. Nextcloud"
                          className="mt-1.5 bg-zinc-800/50 border-white/10 text-zinc-50"
                          data-testid="tile-name-input"
                        />
                      </div>
                      <div>
                        <Label className="text-zinc-300">Icon</Label>
                        <Select
                          value={tileForm.icon}
                          onValueChange={(value) => setTileForm(prev => ({ ...prev, icon: value }))}
                        >
                          <SelectTrigger className="mt-1.5 bg-zinc-800/50 border-white/10 text-zinc-50">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-zinc-900 border-white/10">
                            {iconOptions.map(({ value, label, Icon }) => (
                              <SelectItem key={value} value={value} className="text-zinc-50 focus:bg-zinc-800">
                                <div className="flex items-center gap-2">
                                  <Icon size={16} />
                                  {label}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <Label className="text-zinc-300">URL</Label>
                      <Input
                        value={tileForm.url}
                        onChange={(e) => setTileForm(prev => ({ ...prev, url: e.target.value }))}
                        placeholder="https://192.168.1.140:8080"
                        className="mt-1.5 bg-zinc-800/50 border-white/10 text-zinc-50"
                        data-testid="tile-url-input"
                      />
                    </div>
                    <div>
                      <Label className="text-zinc-300">Kategorie</Label>
                      <Select
                        value={tileForm.category}
                        onValueChange={(value) => setTileForm(prev => ({ ...prev, category: value }))}
                      >
                        <SelectTrigger className="mt-1.5 bg-zinc-800/50 border-white/10 text-zinc-50">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-zinc-900 border-white/10">
                          {categories.map((cat) => (
                            <SelectItem key={cat.name} value={cat.name} className="text-zinc-50 focus:bg-zinc-800">
                              {cat.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-zinc-300">Beschreibung (optional)</Label>
                      <Input
                        value={tileForm.description}
                        onChange={(e) => setTileForm(prev => ({ ...prev, description: e.target.value }))}
                        placeholder="Kurze Beschreibung"
                        className="mt-1.5 bg-zinc-800/50 border-white/10 text-zinc-50"
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="ghost" onClick={() => setAddTileOpen(false)} className="text-zinc-400">
                      Abbrechen
                    </Button>
                    <Button onClick={handleAddTile} className="bg-zinc-50 text-zinc-950 hover:bg-zinc-200" data-testid="save-tile-button">
                      Erstellen
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>

            {/* Tiles List */}
            {loading ? (
              <div className="py-12 text-center">
                <Spinner size={32} className="animate-spin text-zinc-400 mx-auto" />
              </div>
            ) : tiles.length === 0 ? (
              <div className="py-12 text-center bg-zinc-900 rounded-2xl border border-white/5">
                <Cube size={48} weight="duotone" className="text-zinc-600 mx-auto mb-4" />
                <p className="text-zinc-400">Noch keine Kacheln vorhanden.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {tiles.map((tile) => {
                  const Icon = getIcon(tile.icon);
                  return (
                    <motion.div
                      key={tile.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-center gap-4 p-4 bg-zinc-900 rounded-xl border border-white/5 hover:border-white/10 transition-colors"
                    >
                      <div className="p-2.5 rounded-xl bg-zinc-800">
                        <Icon size={20} weight="duotone" className="text-zinc-300" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-zinc-50 truncate">{tile.name}</h3>
                          {!tile.visible && (
                            <span className="px-2 py-0.5 rounded text-xs bg-zinc-800 text-zinc-500">
                              Versteckt
                            </span>
                          )}
                          {!tile.is_manual && (
                            <span className="px-2 py-0.5 rounded text-xs bg-zinc-800 text-zinc-500">
                              Docker
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-zinc-500 truncate">{tile.url}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleToggleVisibility(tile)}
                          className="text-zinc-400 hover:text-zinc-50"
                          data-testid={`toggle-visibility-${tile.id}`}
                        >
                          {tile.visible ? <Eye size={18} /> : <EyeSlash size={18} />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditDialog(tile)}
                          className="text-zinc-400 hover:text-zinc-50"
                          data-testid={`edit-tile-${tile.id}`}
                        >
                          <PencilSimple size={18} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteTile(tile.id)}
                          className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                          data-testid={`delete-tile-${tile.id}`}
                        >
                          <Trash size={18} />
                        </Button>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* Containers Tab */}
          <TabsContent value="containers" className="space-y-6">
            <div className="flex justify-between items-center">
              <p className="text-zinc-400 text-sm">
                {containers.length > 0 
                  ? `${containers.length} Container gefunden`
                  : "Scanne nach Docker Containern"}
              </p>
              <Button
                onClick={scanContainers}
                disabled={scanningContainers}
                className="bg-zinc-800 text-zinc-50 hover:bg-zinc-700"
                data-testid="scan-containers-button"
              >
                {scanningContainers ? (
                  <Spinner size={16} className="animate-spin mr-2" />
                ) : (
                  <CloudArrowDown size={16} className="mr-2" />
                )}
                Container scannen
              </Button>
            </div>

            {/* Container Info */}
            <div className="bg-zinc-900/50 rounded-xl border border-white/5 p-4">
              <p className="text-sm text-zinc-400">
                <strong className="text-zinc-300">Hinweis:</strong> Um Docker Container automatisch zu erkennen, 
                muss der Docker Socket gemountet werden beim Starten des Aria Containers:
              </p>
              <code className="block mt-2 p-3 bg-zinc-950 rounded-lg text-xs text-emerald-400 overflow-x-auto">
                -v /var/run/docker.sock:/var/run/docker.sock:ro
              </code>
            </div>

            {/* Containers List */}
            {scanningContainers ? (
              <div className="py-12 text-center">
                <Spinner size={32} className="animate-spin text-zinc-400 mx-auto mb-3" />
                <p className="text-zinc-400">Scanne nach Docker Containern...</p>
              </div>
            ) : containers.length === 0 ? (
              <div className="py-12 text-center bg-zinc-900 rounded-2xl border border-white/5">
                <CloudArrowDown size={48} weight="duotone" className="text-zinc-600 mx-auto mb-4" />
                <p className="text-zinc-400">Klicke auf "Container scannen" um Docker Container zu finden.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {containers.map((container) => (
                  <div
                    key={container.id}
                    className="flex items-center gap-4 p-4 bg-zinc-900 rounded-xl border border-white/5"
                  >
                    <Circle
                      size={12}
                      weight="fill"
                      className={container.status === "running" ? "text-emerald-500" : "text-red-500"}
                    />
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-zinc-50">{container.name}</h3>
                      <p className="text-sm text-zinc-500 truncate">{container.image}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-1 rounded text-xs ${
                        container.status === "running" ? "status-running" : "status-stopped"
                      }`}>
                        {container.status === "running" ? "Läuft" : "Gestoppt"}
                      </span>
                      {container.added_to_dashboard ? (
                        <span className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-emerald-500/10 text-emerald-400">
                          <Check size={14} />
                          Hinzugefügt
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => addContainerAsTile(container)}
                          className="bg-zinc-800 text-zinc-50 hover:bg-zinc-700"
                          data-testid={`add-container-${container.name}`}
                        >
                          <Plus size={14} className="mr-1" />
                          Hinzufügen
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>

      {/* Edit Tile Dialog */}
      <Dialog open={editTileOpen} onOpenChange={setEditTileOpen}>
        <DialogContent className="bg-zinc-900 border-white/10 text-zinc-50">
          <DialogHeader>
            <DialogTitle className="font-['Outfit']">Kachel bearbeiten</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-zinc-300">Name</Label>
                <Input
                  value={tileForm.name}
                  onChange={(e) => setTileForm(prev => ({ ...prev, name: e.target.value }))}
                  className="mt-1.5 bg-zinc-800/50 border-white/10 text-zinc-50"
                />
              </div>
              <div>
                <Label className="text-zinc-300">Icon</Label>
                <Select
                  value={tileForm.icon}
                  onValueChange={(value) => setTileForm(prev => ({ ...prev, icon: value }))}
                >
                  <SelectTrigger className="mt-1.5 bg-zinc-800/50 border-white/10 text-zinc-50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-white/10">
                    {iconOptions.map(({ value, label, Icon }) => (
                      <SelectItem key={value} value={value} className="text-zinc-50 focus:bg-zinc-800">
                        <div className="flex items-center gap-2">
                          <Icon size={16} />
                          {label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-zinc-300">URL</Label>
              <Input
                value={tileForm.url}
                onChange={(e) => setTileForm(prev => ({ ...prev, url: e.target.value }))}
                className="mt-1.5 bg-zinc-800/50 border-white/10 text-zinc-50"
              />
            </div>
            <div>
              <Label className="text-zinc-300">Kategorie</Label>
              <Select
                value={tileForm.category}
                onValueChange={(value) => setTileForm(prev => ({ ...prev, category: value }))}
              >
                <SelectTrigger className="mt-1.5 bg-zinc-800/50 border-white/10 text-zinc-50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-white/10">
                  {categories.map((cat) => (
                    <SelectItem key={cat.name} value={cat.name} className="text-zinc-50 focus:bg-zinc-800">
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-zinc-300">Beschreibung</Label>
              <Input
                value={tileForm.description}
                onChange={(e) => setTileForm(prev => ({ ...prev, description: e.target.value }))}
                className="mt-1.5 bg-zinc-800/50 border-white/10 text-zinc-50"
              />
            </div>
            <div className="flex items-center justify-between pt-2">
              <Label className="text-zinc-300">Sichtbar im Dashboard</Label>
              <Switch
                checked={tileForm.visible}
                onCheckedChange={(checked) => setTileForm(prev => ({ ...prev, visible: checked }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditTileOpen(false)} className="text-zinc-400">
              Abbrechen
            </Button>
            <Button onClick={handleEditTile} className="bg-zinc-50 text-zinc-950 hover:bg-zinc-200">
              Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Admin;

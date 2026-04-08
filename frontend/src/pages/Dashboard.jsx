import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useAuth, API } from "@/App";
import { Link } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  HardDrives,
  User,
  SignOut,
  Gear,
  ArrowSquareOut,
  Circle,
  Cube,
  Cloud,
  HouseLine,
  PlayCircle,
  Wrench,
  Files,
  Folder,
  CaretDown,
  MagnifyingGlass,
  Plus
} from "@phosphor-icons/react";

// Icon mapping
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

const Dashboard = () => {
  const { user, logout } = useAuth();
  const [tiles, setTiles] = useState([]);
  const [categories, setCategories] = useState([]);
  const [activeCategory, setActiveCategory] = useState("all");
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [tilesRes, categoriesRes] = await Promise.all([
        axios.get(`${API}/tiles?visible_only=true`),
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

  const handleLogout = async () => {
    await logout();
    toast.success("Abgemeldet");
  };

  const filteredTiles = tiles.filter(tile => {
    const matchesCategory = activeCategory === "all" || tile.category === activeCategory;
    const matchesSearch = !searchQuery || 
      tile.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tile.description?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const containerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.05
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 10 },
    show: { opacity: 1, y: 0 }
  };

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Header */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-zinc-950/70 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-zinc-900 border border-white/10">
                <HardDrives size={24} weight="duotone" className="text-zinc-50" />
              </div>
              <span className="text-xl font-bold text-zinc-50 font-['Outfit']">Aria</span>
            </div>

            {/* Search (Desktop) */}
            <div className="hidden md:flex flex-1 max-w-md mx-8">
              <div className="relative w-full">
                <MagnifyingGlass size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  placeholder="Dienste suchen..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-10 pl-10 pr-4 rounded-xl bg-zinc-900/50 border border-white/5 text-zinc-50 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-50/20"
                  data-testid="dashboard-search-input"
                />
              </div>
            </div>

            {/* User Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button 
                  variant="ghost" 
                  className="flex items-center gap-2 text-zinc-300 hover:text-zinc-50 hover:bg-zinc-800"
                  data-testid="user-menu-button"
                >
                  <div className="w-8 h-8 rounded-full bg-zinc-800 border border-white/10 flex items-center justify-center">
                    <User size={16} weight="bold" />
                  </div>
                  <span className="hidden sm:inline">{user?.name}</span>
                  <CaretDown size={14} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 bg-zinc-900 border-white/10">
                <DropdownMenuItem asChild className="text-zinc-300 focus:bg-zinc-800 focus:text-zinc-50 cursor-pointer">
                  <Link to="/admin" data-testid="admin-link">
                    <Gear size={16} className="mr-2" />
                    Admin-Bereich
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-white/10" />
                <DropdownMenuItem 
                  onClick={handleLogout}
                  className="text-red-400 focus:bg-red-500/10 focus:text-red-400 cursor-pointer"
                  data-testid="logout-button"
                >
                  <SignOut size={16} className="mr-2" />
                  Abmelden
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* Category Tabs */}
      <div className="border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2 py-4 overflow-x-auto category-tabs">
            <button
              onClick={() => setActiveCategory("all")}
              className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
                activeCategory === "all"
                  ? "bg-zinc-50 text-zinc-950"
                  : "text-zinc-400 hover:text-zinc-50 hover:bg-zinc-800"
              }`}
              data-testid="category-all"
            >
              Alle
            </button>
            {categories.map((category) => {
              const Icon = getIcon(category.icon);
              return (
                <button
                  key={category.name}
                  onClick={() => setActiveCategory(category.name)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
                    activeCategory === category.name
                      ? "bg-zinc-50 text-zinc-950"
                      : "text-zinc-400 hover:text-zinc-50 hover:bg-zinc-800"
                  }`}
                  data-testid={`category-${category.name.toLowerCase()}`}
                >
                  <Icon size={16} weight="duotone" />
                  {category.name}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Mobile Search */}
      <div className="md:hidden px-4 py-4">
        <div className="relative">
          <MagnifyingGlass size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            placeholder="Dienste suchen..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-10 pl-10 pr-4 rounded-xl bg-zinc-900/50 border border-white/5 text-zinc-50 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-50/20"
            data-testid="dashboard-search-input-mobile"
          />
        </div>
      </div>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4 sm:gap-6">
            {[...Array(6)].map((_, i) => (
              <div
                key={i}
                className="aspect-square rounded-2xl bg-zinc-900 border border-white/5 animate-pulse"
              />
            ))}
          </div>
        ) : filteredTiles.length === 0 ? (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-zinc-900 border border-white/10 mb-4">
              <Cube size={32} weight="duotone" className="text-zinc-500" />
            </div>
            <h3 className="text-lg font-medium text-zinc-300 mb-2">Keine Kacheln gefunden</h3>
            <p className="text-zinc-500 mb-6">
              {searchQuery 
                ? "Keine Dienste gefunden, die deiner Suche entsprechen."
                : "Füge im Admin-Bereich neue Kacheln hinzu."}
            </p>
            <Button asChild className="bg-zinc-800 text-zinc-50 hover:bg-zinc-700">
              <Link to="/admin" data-testid="add-tile-link">
                <Plus size={16} className="mr-2" />
                Kachel hinzufügen
              </Link>
            </Button>
          </div>
        ) : (
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4 sm:gap-6"
          >
            {filteredTiles.map((tile) => {
              const Icon = getIcon(tile.icon);
              return (
                <motion.a
                  key={tile.id}
                  href={tile.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  variants={itemVariants}
                  whileTap={{ scale: 0.95 }}
                  className="group relative aspect-square rounded-2xl bg-zinc-900 border border-white/5 p-4 sm:p-5 transition-all duration-200 hover:bg-zinc-800 hover:border-white/10 tile-glow flex flex-col"
                  data-testid={`tile-${tile.name.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  {/* Status dot */}
                  <div className="absolute top-3 right-3">
                    <Circle
                      size={10}
                      weight="fill"
                      className={`${
                        tile.status === "running"
                          ? "text-emerald-500 status-dot-running"
                          : tile.status === "stopped"
                          ? "text-red-500"
                          : "text-zinc-600"
                      }`}
                    />
                  </div>

                  {/* Icon */}
                  <div className="flex-1 flex items-start">
                    <div className="p-2.5 rounded-xl bg-zinc-800/50 group-hover:bg-zinc-700/50 transition-colors">
                      <Icon size={24} weight="duotone" className="text-zinc-300 group-hover:text-zinc-50" />
                    </div>
                  </div>

                  {/* Info */}
                  <div className="mt-auto">
                    <h3 className="font-semibold text-zinc-50 truncate text-sm sm:text-base">
                      {tile.name}
                    </h3>
                    <div className="flex items-center gap-1 mt-1 text-zinc-500 text-xs">
                      <ArrowSquareOut size={12} />
                      <span className="truncate">Öffnen</span>
                    </div>
                  </div>
                </motion.a>
              );
            })}
          </motion.div>
        )}
      </main>
    </div>
  );
};

export default Dashboard;

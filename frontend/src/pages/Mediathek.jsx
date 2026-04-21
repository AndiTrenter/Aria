import { useState, useEffect, useCallback } from "react";
import { useAuth, useTheme, API } from "@/App";
import axios from "axios";
import { MagnifyingGlass, Play, Clock, Star, FilmStrip, MusicNote, Television, ArrowLeft, X } from "@phosphor-icons/react";

const Mediathek = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [libraries, setLibraries] = useState([]);
  const [activeLib, setActiveLib] = useState(null);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState(null);
  const [detail, setDetail] = useState(null);
  const [recentlyAdded, setRecentlyAdded] = useState([]);
  const [onDeck, setOnDeck] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [cacheVersion, setCacheVersion] = useState("");
  const isLcars = theme === "startrek";

  const fetchInit = useCallback(async () => {
    try {
      const [libR, statusR, recentR, deckR, cacheR] = await Promise.all([
        axios.get(`${API}/plex/libraries`).catch(() => ({ data: [] })),
        axios.get(`${API}/plex/status`).catch(() => ({ data: { connected: false } })),
        axios.get(`${API}/plex/recently-added?limit=12`).catch(() => ({ data: [] })),
        axios.get(`${API}/plex/on-deck`).catch(() => ({ data: [] })),
        axios.get(`${API}/plex/cache-version`).catch(() => ({ data: { version: "" } })),
      ]);
      setLibraries(libR.data);
      setStatus(statusR.data);
      setRecentlyAdded(recentR.data);
      setOnDeck(deckR.data);
      setCacheVersion(cacheR.data?.version || "");
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchInit(); }, [fetchInit]);

  const loadLibrary = async (lib) => {
    setActiveLib(lib);
    setSearchResults(null);
    setDetail(null);
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/plex/library/${lib.id}?size=60`);
      setItems(data.items);
      setTotal(data.total);
    } catch { setItems([]); }
    finally { setLoading(false); }
  };

  const handleSearch = async () => {
    if (!search.trim()) { setSearchResults(null); return; }
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/plex/search?q=${encodeURIComponent(search)}`);
      setSearchResults(data.results);
    } catch { setSearchResults([]); }
    finally { setLoading(false); }
  };

  const openDetail = async (ratingKey) => {
    try {
      const { data } = await axios.get(`${API}/plex/metadata/${ratingKey}`);
      setDetail(data);
    } catch {}
  };

  const goHome = () => { setActiveLib(null); setDetail(null); setSearchResults(null); setSearch(""); };

  const formatDuration = (ms) => {
    if (!ms) return "";
    const min = Math.round(ms / 60000);
    if (min < 60) return `${min} Min`;
    return `${Math.floor(min / 60)}h ${min % 60}m`;
  };

  const TypeIcon = ({ type }) => {
    if (type === "movie") return <FilmStrip size={14} />;
    if (type === "show" || type === "episode") return <Television size={14} />;
    if (type === "artist" || type === "track" || type === "album") return <MusicNote size={14} />;
    return <FilmStrip size={14} />;
  };

  const cardBg = isLcars ? "bg-[#0a0a14] border border-[var(--lcars-purple)]/20 hover:border-[var(--lcars-orange)]/40" : "bg-purple-950/40 border border-purple-800/20 hover:border-purple-500/40";

  // Not connected
  if (!loading && status && !status.connected) {
    return (
      <div className="p-6 flex items-center justify-center h-[60vh]" data-testid="mediathek-offline">
        <div className="text-center">
          <FilmStrip size={48} className={isLcars ? "text-[var(--lcars-purple)] mx-auto mb-4" : "text-purple-500 mx-auto mb-4"} />
          <h2 className={isLcars ? "text-lg tracking-widest text-[var(--lcars-orange)] mb-2" : "text-xl font-bold text-purple-200 mb-2"}>
            {isLcars ? "PLEX NICHT VERBUNDEN" : "Plex nicht verbunden"}
          </h2>
          <p className="text-sm text-gray-500">Plex URL und Token in Admin → Einstellungen konfigurieren.</p>
        </div>
      </div>
    );
  }

  // Detail Modal
  if (detail) {
    return (
      <div className="p-4" data-testid="mediathek-detail">
        <button onClick={() => setDetail(null)} className={`mb-4 flex items-center gap-2 text-sm ${isLcars ? "text-[var(--lcars-blue)]" : "text-purple-400"} hover:underline`}>
          <ArrowLeft size={16} /> Zurück
        </button>
        <div className="flex gap-6 flex-col md:flex-row">
          {/* Poster */}
          <div className="w-48 flex-shrink-0">
            {detail.thumb ? (
              <img src={`${API}${(detail.thumb.startsWith('/api') ? detail.thumb.substring(4) : detail.thumb)}${cacheVersion ? (detail.thumb.includes('?') ? '&' : '?') + 'v=' + cacheVersion : ''}`} alt={detail.title} className="w-full rounded-xl shadow-lg" />
            ) : (
              <div className={`w-full h-72 rounded-xl flex items-center justify-center ${isLcars ? "bg-[#0a0a14]" : "bg-purple-950/50"}`}>
                <TypeIcon type={detail.type} />
              </div>
            )}
          </div>
          {/* Info */}
          <div className="flex-1 min-w-0">
            <h1 className={`text-2xl font-bold mb-1 ${isLcars ? "text-[var(--lcars-orange)] tracking-wider" : ""}`}>{detail.title}</h1>
            <div className="flex items-center gap-3 mb-3 text-sm text-gray-400 flex-wrap">
              {detail.year && <span>{detail.year}</span>}
              {detail.content_rating && <span className="px-2 py-0.5 border border-gray-600 rounded text-xs">{detail.content_rating}</span>}
              {detail.duration_ms > 0 && <span><Clock size={12} className="inline mr-1" />{formatDuration(detail.duration_ms)}</span>}
              {detail.rating > 0 && <span><Star size={12} weight="fill" className="inline mr-1 text-yellow-500" />{detail.rating.toFixed(1)}</span>}
              {detail.video_resolution && <span className="text-xs px-1.5 py-0.5 bg-gray-800 rounded">{detail.video_resolution}</span>}
            </div>
            {detail.tagline && <p className={`text-sm italic mb-3 ${isLcars ? "text-[var(--lcars-mauve)]" : "text-purple-300"}`}>{detail.tagline}</p>}
            {detail.summary && <p className="text-sm text-gray-400 mb-4 leading-relaxed" style={{ textTransform: "none", letterSpacing: "normal" }}>{detail.summary}</p>}
            {detail.genres?.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-3">
                {detail.genres.map(g => <span key={g} className={`text-[10px] px-2 py-0.5 rounded ${isLcars ? "bg-[var(--lcars-purple)]/20 text-[var(--lcars-purple)]" : "bg-purple-800/30 text-purple-300"}`}>{g}</span>)}
              </div>
            )}
            {detail.directors?.length > 0 && <p className="text-xs text-gray-500 mb-1">Regie: {detail.directors.join(", ")}</p>}
            {detail.studio && <p className="text-xs text-gray-500 mb-3">Studio: {detail.studio}</p>}

            {/* Play Button */}
            <a href={`${status?.url || 'http://192.168.1.140:32400'}/web/index.html#!/server/${detail.rating_key}?key=/library/metadata/${detail.rating_key}`}
              target="_blank" rel="noreferrer"
              className={`inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all ${isLcars ? "bg-[var(--lcars-orange)] text-black hover:bg-[var(--lcars-gold)]" : "bg-purple-600 text-white hover:bg-purple-500"}`}
              data-testid="plex-play-button">
              <Play size={20} weight="fill" /> {isLcars ? "IN PLEX ABSPIELEN" : "In Plex abspielen"}
            </a>

            {/* Cast */}
            {detail.roles?.length > 0 && (
              <div className="mt-6">
                <h3 className={`text-xs font-bold mb-3 ${isLcars ? "text-[var(--lcars-blue)] tracking-wider" : "text-purple-300"}`}>
                  {isLcars ? "BESETZUNG" : "Besetzung"}
                </h3>
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {detail.roles.map((r, i) => (
                    <div key={i} className="flex-shrink-0 w-20 text-center">
                      <div className={`w-16 h-16 mx-auto rounded-full mb-1 flex items-center justify-center text-gray-600 text-lg ${isLcars ? "bg-[#0a0a14]" : "bg-purple-950/50"}`}>
                      {r.thumb ? <img src={`${API}${(r.thumb.startsWith('/api') ? r.thumb.substring(4) : r.thumb)}${cacheVersion ? (r.thumb.includes('?') ? '&' : '?') + 'v=' + cacheVersion : ''}`} className="w-full h-full rounded-full object-cover" alt={r.name} /> : r.name[0]}
                      </div>
                      <div className="text-[10px] font-bold truncate">{r.name}</div>
                      {r.role && <div className="text-[9px] text-gray-500 truncate">{r.role}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Seasons */}
            {detail.seasons?.length > 0 && (
              <div className="mt-6">
                <h3 className={`text-xs font-bold mb-3 ${isLcars ? "text-[var(--lcars-blue)] tracking-wider" : "text-purple-300"}`}>
                  {isLcars ? "STAFFELN" : "Staffeln"}
                </h3>
                <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
                  {detail.seasons.map(s => (
                    <button key={s.key} onClick={() => openDetail(s.key)} className={`${cardBg} rounded-lg p-2 text-center transition-all`}>
                      <div className="text-sm font-bold">{s.title}</div>
                      <div className="text-[10px] text-gray-500">{s.episode_count} Episoden</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Episodes */}
            {detail.episodes?.length > 0 && (
              <div className="mt-6">
                <h3 className={`text-xs font-bold mb-3 ${isLcars ? "text-[var(--lcars-blue)] tracking-wider" : "text-purple-300"}`}>
                  {isLcars ? "EPISODEN" : "Episoden"}
                </h3>
                <div className="space-y-2">
                  {detail.episodes.map(ep => (
                    <div key={ep.rating_key} onClick={() => openDetail(ep.rating_key)} className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer ${cardBg}`}>
                      <span className={`text-sm font-bold w-8 text-center ${isLcars ? "text-[var(--lcars-orange)]" : "text-purple-300"}`}>{ep.index}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{ep.title}</div>
                        <div className="text-[10px] text-gray-500">{formatDuration(ep.duration)}{ep.originally_available ? ` | ${ep.originally_available}` : ""}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4" data-testid="mediathek-page">
      {/* Header */}
      <div className="flex items-center gap-4 mb-4">
        {activeLib && (
          <button onClick={goHome} className={`p-2 rounded ${isLcars ? "text-[var(--lcars-blue)] hover:bg-[var(--lcars-blue)]/10" : "text-purple-400 hover:bg-purple-800/30"}`}>
            <ArrowLeft size={20} />
          </button>
        )}
        <h2 className={`${isLcars ? "text-lg tracking-widest text-[var(--lcars-orange)]" : "text-xl font-bold"}`}>
          {activeLib ? (isLcars ? activeLib.title.toUpperCase() : activeLib.title) : (isLcars ? "MEDIATHEK" : "Mediathek")}
        </h2>
        <div className="flex-1" />
        {/* Search */}
        <div className="flex gap-2">
          <div className="relative">
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder={isLcars ? "SUCHEN..." : "Suchen..."}
              className={`${isLcars ? "lcars-input" : "disney-input"} w-48 pr-8`}
              style={{ textTransform: "none" }}
              data-testid="mediathek-search" />
            {search && (
              <button onClick={() => { setSearch(""); setSearchResults(null); }} className="absolute right-8 top-1/2 -translate-y-1/2 text-gray-500"><X size={14} /></button>
            )}
            <button onClick={handleSearch} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500"><MagnifyingGlass size={16} /></button>
          </div>
        </div>
      </div>

      {/* Search Results */}
      {searchResults !== null && (
        <div className="mb-6">
          <h3 className={`text-xs font-bold mb-3 ${isLcars ? "text-[var(--lcars-blue)] tracking-wider" : "text-purple-300"}`}>
            {isLcars ? `${searchResults.length} TREFFER` : `${searchResults.length} Treffer`}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
            {searchResults.map(item => <MediaCard key={item.rating_key} item={item} cacheVersion={cacheVersion} onClick={() => openDetail(item.rating_key)} isLcars={isLcars} cardBg={cardBg} formatDuration={formatDuration} />)}
          </div>
          {searchResults.length === 0 && <p className="text-center text-gray-500 py-8">Keine Ergebnisse</p>}
        </div>
      )}

      {/* Home View */}
      {!activeLib && !searchResults && (
        <>
          {/* Libraries */}
          <div className="flex gap-3 mb-6 overflow-x-auto pb-2">
            {libraries.map(lib => (
              <button key={lib.id} onClick={() => loadLibrary(lib)}
                className={`flex-shrink-0 px-5 py-3 rounded-xl font-bold text-sm transition-all ${isLcars ? "bg-[var(--lcars-purple)]/15 text-[var(--lcars-purple)] hover:bg-[var(--lcars-purple)]/25 border border-[var(--lcars-purple)]/30" : "bg-purple-800/30 text-purple-300 hover:bg-purple-700/40 border border-purple-700/30"}`}
                data-testid={`lib-${lib.id}`}>
                {lib.type === "movie" ? <FilmStrip size={16} className="inline mr-2" /> : lib.type === "show" ? <Television size={16} className="inline mr-2" /> : <MusicNote size={16} className="inline mr-2" />}
                {isLcars ? lib.title.toUpperCase() : lib.title}
              </button>
            ))}
          </div>

          {/* On Deck */}
          {onDeck.length > 0 && (
            <div className="mb-6">
              <h3 className={`text-xs font-bold mb-3 ${isLcars ? "text-[var(--lcars-orange)] tracking-wider" : "text-purple-200"}`}>
                {isLcars ? "WEITERSCHAUEN" : "Weiterschauen"}
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
                {onDeck.map(item => <MediaCard key={item.rating_key} item={item} cacheVersion={cacheVersion} onClick={() => openDetail(item.rating_key)} isLcars={isLcars} cardBg={cardBg} formatDuration={formatDuration} />)}
              </div>
            </div>
          )}

          {/* Recently Added */}
          {recentlyAdded.length > 0 && (
            <div className="mb-6">
              <h3 className={`text-xs font-bold mb-3 ${isLcars ? "text-[var(--lcars-blue)] tracking-wider" : "text-purple-200"}`}>
                {isLcars ? "ZULETZT HINZUGEFÜGT" : "Zuletzt hinzugefügt"}
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
                {recentlyAdded.map(item => <MediaCard key={item.rating_key} item={item} cacheVersion={cacheVersion} onClick={() => openDetail(item.rating_key)} isLcars={isLcars} cardBg={cardBg} formatDuration={formatDuration} />)}
              </div>
            </div>
          )}
        </>
      )}

      {/* Library Grid */}
      {activeLib && !searchResults && (
        <div>
          <p className={`text-xs mb-3 ${isLcars ? "text-gray-500" : "text-purple-400"}`}>{total} {isLcars ? "EINTRÄGE" : "Einträge"}</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
            {items.map(item => <MediaCard key={item.rating_key} item={item} cacheVersion={cacheVersion} onClick={() => openDetail(item.rating_key)} isLcars={isLcars} cardBg={cardBg} formatDuration={formatDuration} />)}
          </div>
          {items.length === 0 && !loading && <p className="text-center text-gray-500 py-12">Keine Medien gefunden</p>}
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-12">
          <div className={`w-8 h-8 border-2 rounded-full animate-spin ${isLcars ? "border-[var(--lcars-orange)] border-t-transparent" : "border-purple-500 border-t-transparent"}`} />
        </div>
      )}
    </div>
  );
};

const MediaCard = ({ item, onClick, isLcars, cardBg, formatDuration, cacheVersion }) => {
  const busted = item.thumb
    ? `${process.env.REACT_APP_BACKEND_URL}${item.thumb}${cacheVersion ? (item.thumb.includes('?') ? '&' : '?') + 'v=' + cacheVersion : ''}`
    : "";
  return (
    <button onClick={onClick} className={`${cardBg} rounded-xl overflow-hidden transition-all group text-left w-full`} data-testid={`media-${item.rating_key}`}>
      <div className="aspect-[2/3] relative overflow-hidden bg-gray-900">
        {busted ? (
          <img src={busted} alt={item.title}
            className="w-full h-full object-cover transition-transform group-hover:scale-105"
            loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-700">
            <FilmStrip size={32} />
          </div>
        )}
        {item.duration > 0 && (
          <div className="absolute bottom-1 right-1 text-[9px] px-1.5 py-0.5 rounded bg-black/70 text-gray-300">{formatDuration(item.duration)}</div>
        )}
      </div>
      <div className="p-2">
        <div className="text-xs font-bold truncate">{item.title}</div>
        <div className="text-[10px] text-gray-500 truncate">
          {item.year}{item.parent_title ? ` | ${item.parent_title}` : ""}{item.grandparent_title ? ` | ${item.grandparent_title}` : ""}
        </div>
      </div>
    </button>
  );
};

export default Mediathek;

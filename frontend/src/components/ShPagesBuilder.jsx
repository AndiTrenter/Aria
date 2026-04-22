import { useState, useEffect, useMemo } from "react";
import axios from "axios";
import { toast } from "sonner";
import { API, formatApiError } from "@/App";
import { Plus, Trash, PencilSimple, FloppyDisk, X, ArrowsOutCardinal, CaretUp, CaretDown } from "@phosphor-icons/react";

/**
 * Reusable SmartHome Page Templates editor.
 * - Admin lists / creates / deletes named pages
 * - Per page: ordered sections (drag-reorder + up/down buttons)
 * - Per section: title, room filter, layout (grid-1/2/3/list), device items
 * - Per item: entity_id, widget type, size
 * - Bottom: assign page to users
 */
const ShPagesBuilder = ({ isLcars, cardClass, btnClass, inputClass, users, devices, rooms }) => {
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [newName, setNewName] = useState("");

  const loadPages = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/smarthome/pages`);
      setPages(data || []);
    } catch { setPages([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadPages(); }, []);

  const startEdit = (page) => {
    setEditingId(page.id);
    setDraft(JSON.parse(JSON.stringify(page)));
  };
  const cancelEdit = () => { setEditingId(null); setDraft(null); };

  const createPage = async () => {
    if (!newName.trim()) { toast.error("Name angeben"); return; }
    try {
      const { data } = await axios.post(`${API}/smarthome/pages`, { name: newName.trim(), sections: [] });
      setNewName("");
      toast.success(`Seite "${data.name}" erstellt`);
      loadPages();
      startEdit(data);
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const deletePage = async (id) => {
    if (!window.confirm("Seite wirklich löschen? Zuweisungen an User werden entfernt.")) return;
    try {
      await axios.delete(`${API}/smarthome/pages/${id}`);
      toast.success("Seite gelöscht");
      loadPages();
      if (editingId === id) cancelEdit();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const savePage = async () => {
    try {
      const { data } = await axios.put(`${API}/smarthome/pages/${draft.id}`, draft);
      toast.success("Seite gespeichert");
      setDraft(data);
      loadPages();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const addSection = () => {
    const newSec = {
      id: `sec-${Date.now()}`,
      title: "Neue Sektion",
      room_id: null,
      layout: "grid-2",
      items: [],
    };
    setDraft({ ...draft, sections: [...(draft.sections || []), newSec] });
  };

  const updateSection = (secIdx, patch) => {
    const secs = [...draft.sections];
    secs[secIdx] = { ...secs[secIdx], ...patch };
    setDraft({ ...draft, sections: secs });
  };
  const removeSection = (secIdx) => {
    if (!window.confirm("Sektion entfernen?")) return;
    setDraft({ ...draft, sections: draft.sections.filter((_, i) => i !== secIdx) });
  };
  const moveSection = (from, to) => {
    if (to < 0 || to >= draft.sections.length) return;
    const secs = [...draft.sections];
    [secs[from], secs[to]] = [secs[to], secs[from]];
    setDraft({ ...draft, sections: secs });
  };

  const addItemToSection = (secIdx, entity_id) => {
    if (!entity_id) return;
    const secs = [...draft.sections];
    if (secs[secIdx].items.some(it => it.entity_id === entity_id)) return;
    secs[secIdx] = {
      ...secs[secIdx],
      items: [...secs[secIdx].items, { entity_id, widget: "auto", size: "normal" }],
    };
    setDraft({ ...draft, sections: secs });
  };
  const removeItem = (secIdx, itemIdx) => {
    const secs = [...draft.sections];
    secs[secIdx] = { ...secs[secIdx], items: secs[secIdx].items.filter((_, i) => i !== itemIdx) };
    setDraft({ ...draft, sections: secs });
  };
  const updateItem = (secIdx, itemIdx, patch) => {
    const secs = [...draft.sections];
    const items = [...secs[secIdx].items];
    items[itemIdx] = { ...items[itemIdx], ...patch };
    secs[secIdx] = { ...secs[secIdx], items };
    setDraft({ ...draft, sections: secs });
  };
  const moveItem = (secIdx, from, to) => {
    const secs = [...draft.sections];
    const items = [...secs[secIdx].items];
    if (to < 0 || to >= items.length) return;
    [items[from], items[to]] = [items[to], items[from]];
    secs[secIdx] = { ...secs[secIdx], items };
    setDraft({ ...draft, sections: secs });
  };

  // HTML5 drag-and-drop for items (within same section)
  const onItemDragStart = (e, secIdx, itemIdx) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", `${secIdx}:${itemIdx}`);
  };
  const onItemDrop = (e, secIdx, itemIdx) => {
    e.preventDefault();
    const [fromSec, fromIdx] = e.dataTransfer.getData("text/plain").split(":").map(Number);
    if (fromSec !== secIdx) return;
    moveItem(secIdx, fromIdx, itemIdx);
  };

  const assignToUser = async (userId, pageId) => {
    try {
      await axios.put(`${API}/smarthome/users/${userId}/assign-page`, { page_id: pageId || null });
      toast.success(pageId ? "Seite zugewiesen" : "Zuweisung entfernt");
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const currentPage = useMemo(() => pages.find(p => p.id === editingId), [pages, editingId]);
  const deviceOptions = useMemo(() => {
    const sorted = [...(devices || [])].sort((a, b) => (a.friendly_name || a.entity_id).localeCompare(b.friendly_name || b.entity_id));
    return sorted;
  }, [devices]);

  return (
    <div className="space-y-4" data-testid="sh-pages-builder">
      <div className={cardClass}>
        <h3 className={`text-sm mb-2 ${isLcars ? "tracking-widest text-[var(--lcars-orange)]" : "font-bold text-purple-200"}`}>
          {isLcars ? "SMARTHOME SEITEN-TEMPLATES" : "SmartHome Seiten-Templates"}
        </h3>
        <p className="text-xs text-gray-500 mb-3 leading-relaxed" style={{ textTransform: "none" }}>
          Erstelle benannte Seiten (z.B. "Luzia's Home", "Einfach-Modus"), platziere Geräte per Drag & Drop und Hoch/Runter-Pfeile,
          weise dann diese Seite unten einem User zu. Der User sieht genau dieses Layout wenn er SmartHome öffnet.
        </p>
        <div className="flex gap-2 flex-wrap">
          <input
            placeholder="Neuer Seiten-Name (z.B. Luzia's Home)"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && createPage()}
            className={`${inputClass} flex-1 min-w-[200px]`}
            style={{ textTransform: "none" }}
            data-testid="new-page-name"
          />
          <button onClick={createPage} className={`${btnClass} py-1 px-3 text-xs flex items-center gap-1`} data-testid="create-page-btn">
            <Plus size={14} /> {isLcars ? "NEU ERSTELLEN" : "Erstellen"}
          </button>
        </div>
      </div>

      {/* Pages list */}
      <div className={cardClass}>
        <div className="flex items-center gap-3 mb-3">
          <h3 className={`text-sm ${isLcars ? "tracking-widest text-[var(--lcars-orange)]" : "font-bold text-purple-200"}`}>
            {isLcars ? "VORHANDENE SEITEN" : "Vorhandene Seiten"}
          </h3>
          <span className="text-xs text-gray-500">{pages.length} Seiten</span>
        </div>
        {pages.length === 0 && !loading && (
          <div className="text-gray-500 text-xs text-center py-4" style={{ textTransform: "none" }}>
            Noch keine Seite erstellt — gib oben einen Namen ein und klicke "Erstellen".
          </div>
        )}
        <div className="space-y-2">
          {pages.map(p => (
            <div key={p.id}
              className={`flex items-center gap-2 px-3 py-2 rounded ${editingId === p.id ? (isLcars ? "bg-[var(--lcars-orange)]/20" : "bg-purple-700/30") : "bg-black/20"}`}
              data-testid={`page-row-${p.id}`}>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm truncate" style={{ textTransform: "none" }}>{p.name}</div>
                <div className="text-xs text-gray-500">
                  {p.sections?.length || 0} Sektionen · {p.sections?.reduce((n, s) => n + (s.items?.length || 0), 0) || 0} Geräte
                </div>
              </div>
              <button onClick={() => startEdit(p)} className={`${btnClass} py-1 px-2 text-xs`} data-testid={`edit-page-${p.id}`}>
                <PencilSimple size={12} />
              </button>
              <button onClick={() => deletePage(p.id)} className="py-1 px-2 text-xs rounded bg-red-900/40 text-red-300 hover:bg-red-800/50" data-testid={`delete-page-${p.id}`}>
                <Trash size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Editor */}
      {draft && currentPage && (
        <div className={cardClass} data-testid="page-editor">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <input
              value={draft.name}
              onChange={e => setDraft({ ...draft, name: e.target.value })}
              className={`${inputClass} flex-1 min-w-[200px] font-bold`}
              style={{ textTransform: "none" }}
              data-testid="page-name-edit"
            />
            <button onClick={savePage} className={`${btnClass} py-1 px-3 text-xs flex items-center gap-1`} data-testid="save-page-btn">
              <FloppyDisk size={14} /> {isLcars ? "SPEICHERN" : "Speichern"}
            </button>
            <button onClick={cancelEdit} className={`${btnClass} py-1 px-3 text-xs opacity-70 flex items-center gap-1`}>
              <X size={14} />
            </button>
          </div>
          <input
            placeholder="Beschreibung (optional)"
            value={draft.description || ""}
            onChange={e => setDraft({ ...draft, description: e.target.value })}
            className={`${inputClass} w-full text-xs mb-4`}
            style={{ textTransform: "none" }}
          />

          <div className="space-y-3">
            {(draft.sections || []).map((sec, secIdx) => (
              <div key={sec.id} className={`${isLcars ? "bg-[#0a0a14]" : "bg-purple-950/30"} p-3 rounded-lg border border-gray-700`} data-testid={`section-${sec.id}`}>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <button onClick={() => moveSection(secIdx, secIdx - 1)} disabled={secIdx === 0} className={`${btnClass} py-0.5 px-1.5 text-[10px] disabled:opacity-30`}>
                    <CaretUp size={10} />
                  </button>
                  <button onClick={() => moveSection(secIdx, secIdx + 1)} disabled={secIdx === draft.sections.length - 1} className={`${btnClass} py-0.5 px-1.5 text-[10px] disabled:opacity-30`}>
                    <CaretDown size={10} />
                  </button>
                  <input
                    value={sec.title}
                    onChange={e => updateSection(secIdx, { title: e.target.value })}
                    className={`${inputClass} flex-1 min-w-[120px] font-bold text-xs`}
                    style={{ textTransform: "none" }}
                    placeholder="Sektions-Titel"
                    data-testid={`section-title-${sec.id}`}
                  />
                  <select
                    value={sec.room_id || ""}
                    onChange={e => updateSection(secIdx, { room_id: e.target.value || null })}
                    className={`${inputClass} text-xs`}
                    style={{ textTransform: "none" }}
                    data-testid={`section-room-${sec.id}`}>
                    <option value="">— kein Raum-Filter —</option>
                    {(rooms || []).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                  <select
                    value={sec.layout}
                    onChange={e => updateSection(secIdx, { layout: e.target.value })}
                    className={`${inputClass} text-xs`}
                    data-testid={`section-layout-${sec.id}`}>
                    <option value="grid-1">1 Spalte</option>
                    <option value="grid-2">2 Spalten</option>
                    <option value="grid-3">3 Spalten</option>
                    <option value="list">Liste</option>
                  </select>
                  <button onClick={() => removeSection(secIdx)} className="py-0.5 px-1.5 text-[10px] rounded bg-red-900/40 text-red-300">
                    <Trash size={10} />
                  </button>
                </div>

                {/* Items within section */}
                <div className="space-y-1 ml-1">
                  {sec.items.length === 0 && (
                    <div className="text-[11px] text-gray-500 italic pl-2" style={{ textTransform: "none" }}>
                      Noch keine Geräte — unten auswählen und hinzufügen.
                    </div>
                  )}
                  {sec.items.map((it, itemIdx) => {
                    const dev = deviceOptions.find(d => d.entity_id === it.entity_id);
                    return (
                      <div key={`${it.entity_id}-${itemIdx}`}
                        draggable
                        onDragStart={(e) => onItemDragStart(e, secIdx, itemIdx)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => onItemDrop(e, secIdx, itemIdx)}
                        className="flex items-center gap-1 px-2 py-1 rounded bg-black/30 text-xs cursor-move"
                        data-testid={`item-${sec.id}-${itemIdx}`}>
                        <ArrowsOutCardinal size={10} className="text-gray-500" />
                        <span className="flex-1 truncate" style={{ textTransform: "none" }}>
                          {dev ? (dev.friendly_name || dev.entity_id) : it.entity_id}
                          <span className="text-gray-500 ml-1">[{it.entity_id}]</span>
                        </span>
                        <select value={it.size} onChange={e => updateItem(secIdx, itemIdx, { size: e.target.value })} className={`${inputClass} text-[10px] py-0 px-1`}>
                          <option value="normal">Normal</option>
                          <option value="wide">Breit</option>
                          <option value="tall">Hoch</option>
                          <option value="full">Voll</option>
                        </select>
                        <button onClick={() => moveItem(secIdx, itemIdx, itemIdx - 1)} disabled={itemIdx === 0} className="text-[10px] px-1 disabled:opacity-30">↑</button>
                        <button onClick={() => moveItem(secIdx, itemIdx, itemIdx + 1)} disabled={itemIdx === sec.items.length - 1} className="text-[10px] px-1 disabled:opacity-30">↓</button>
                        <button onClick={() => removeItem(secIdx, itemIdx)} className="text-[10px] px-1 text-red-400">✕</button>
                      </div>
                    );
                  })}
                </div>
                <select
                  onChange={e => { addItemToSection(secIdx, e.target.value); e.target.value = ""; }}
                  className={`${inputClass} text-xs mt-2 w-full`}
                  style={{ textTransform: "none" }}
                  data-testid={`add-item-${sec.id}`}>
                  <option value="">+ Gerät zur Sektion hinzufügen...</option>
                  {deviceOptions
                    .filter(d => !sec.items.some(it => it.entity_id === d.entity_id))
                    .filter(d => !sec.room_id || d.room_id === sec.room_id)
                    .map(d => (
                      <option key={d.entity_id} value={d.entity_id}>
                        {d.friendly_name || d.entity_id} ({d.entity_id})
                      </option>
                    ))}
                </select>
              </div>
            ))}
          </div>

          <button onClick={addSection} className={`${btnClass} py-1 px-3 text-xs flex items-center gap-1 mt-3`} data-testid="add-section-btn">
            <Plus size={12} /> {isLcars ? "SEKTION HINZUFÜGEN" : "Sektion hinzufügen"}
          </button>
        </div>
      )}

      {/* User assignment */}
      <div className={cardClass} data-testid="page-assignments">
        <h3 className={`text-sm mb-3 ${isLcars ? "tracking-widest text-[var(--lcars-orange)]" : "font-bold text-purple-200"}`}>
          {isLcars ? "SEITE EINEM USER ZUWEISEN" : "Seite einem User zuweisen"}
        </h3>
        <div className="space-y-1">
          {(users || []).filter(u => u.role === "user").map(u => (
            <div key={u.id} className="flex items-center gap-2 px-2 py-1 rounded bg-black/20" data-testid={`assign-row-${u.id}`}>
              <span className="flex-1 truncate text-sm" style={{ textTransform: "none" }}>{u.name || u.email}</span>
              <select
                defaultValue={u.sh_page_id || ""}
                onChange={e => assignToUser(u.id, e.target.value)}
                className={`${inputClass} text-xs`}
                style={{ textTransform: "none" }}
                data-testid={`assign-select-${u.id}`}>
                <option value="">— Standard (kein Template) —</option>
                {pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          ))}
          {(users || []).filter(u => u.role === "user").length === 0 && (
            <div className="text-xs text-gray-500 text-center py-3" style={{ textTransform: "none" }}>
              Keine User-Accounts vorhanden (nur Admins).
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ShPagesBuilder;

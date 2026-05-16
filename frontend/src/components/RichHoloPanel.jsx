/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useState } from "react";
import { Sun, CloudRain, Cloud, Snowflake, Lightning, Drop, Wind, Thermometer,
         Envelope, ChefHat, Newspaper, MagnifyingGlass, CircleNotch,
         CheckCircle, Warning, Globe } from "@phosphor-icons/react";

/**
 * RichHoloPanel
 * --------------
 * Renders one of several "rich" holo content layouts based on `panel.kind`:
 *   • "weather"  → live weather card with icon, temperature, conditions, mini-forecast
 *   • "email"    → email draft preview (To / Subject / Body)
 *   • "recipe"   → recipe card with title, ingredients, prep
 *   • "news"     → list of news headlines with sources
 *   • default    → falls back to the simple text "query / snippet" layout
 *
 * The panel chrome (border glow, corner ticks, scan lines, holo-in/float
 * animation) is identical to the existing compact HoloPanel so the visual
 * language stays consistent across the cortex hud.
 */
const KIND_META = {
  weather: { hue: "200", icon: <Cloud size={11} weight="bold" />, title: "WETTER" },
  email:   { hue: "38",  icon: <Envelope size={11} weight="bold" />, title: "E-MAIL" },
  recipe:  { hue: "28",  icon: <ChefHat size={11} weight="bold" />, title: "REZEPT" },
  news:    { hue: "45",  icon: <Newspaper size={11} weight="bold" />, title: "NEWS" },
  search:  { hue: "180", icon: <MagnifyingGlass size={11} weight="bold" />, title: "SUCHE" },
};

export default function RichHoloPanel({ panel, slot, index }) {
  const meta = KIND_META[panel.kind] || KIND_META.search;
  const hue = meta.hue;
  const status = panel.status || "active";

  const statusBadge =
    status === "active" ? { color: "text-cyan-300", text: "LIVE", icon: <CircleNotch size={11} weight="bold" className="animate-spin" /> }
    : status === "done" ? { color: "text-emerald-300", text: "OK",  icon: <CheckCircle size={11} weight="fill" /> }
    : status === "error" ? { color: "text-red-300", text: "FEHLER", icon: <Warning size={11} weight="fill" /> }
    : { color: "text-amber-300/80", text: "...", icon: <CircleNotch size={11} weight="bold" /> };

  const tz = slot.tz ?? 60;
  const ry = slot.ry ?? 0;
  const rx = slot.rx ?? 0;

  // Rich panels are larger to hold real content
  const width = panel.kind === "email" ? 340
              : panel.kind === "news"  ? 320
              : panel.kind === "recipe" ? 320
              : panel.kind === "weather" ? 280 : 260;

  return (
    <div
      className="absolute pointer-events-none holo-panel"
      style={{
        top: slot.top, bottom: slot.bottom, left: slot.left, right: slot.right,
        width,
        transformStyle: "preserve-3d",
        animation: "aria-holo-in 520ms cubic-bezier(.2,.9,.3,1.2) both",
        animationDelay: `${index * 80}ms`,
      }}
    >
      <div
        className="holo-panel-inner"
        style={{
          transformStyle: "preserve-3d",
          transform: `translateZ(${tz}px) rotateY(${ry}deg) rotateX(${rx}deg)`,
          animation: `aria-holo-float ${5 + (index % 3)}s ease-in-out ${index * 0.35}s infinite alternate`,
        }}
      >
        <div
          className="relative rounded-md border backdrop-blur-md overflow-hidden"
          style={{
            background: `linear-gradient(180deg, hsla(${hue},90%,40%,0.18), hsla(${hue},90%,15%,0.55))`,
            borderColor: `hsla(${hue},90%,65%,0.6)`,
            boxShadow: `0 0 24px hsla(${hue},90%,55%,0.4), 0 0 60px hsla(${hue},90%,55%,0.18), inset 0 0 30px hsla(${hue},90%,40%,0.2)`,
          }}
        >
          {/* HUD top stripe */}
          <div
            className="flex items-center justify-between px-3 py-1.5 text-[10px] tracking-[0.25em] font-bold border-b"
            style={{
              color: `hsl(${hue},90%,82%)`,
              borderColor: `hsla(${hue},90%,65%,0.45)`,
              background: `hsla(${hue},90%,30%,0.28)`,
            }}
          >
            <span className="flex items-center gap-1.5">
              {meta.icon}
              {panel.title || meta.title}
            </span>
            <span className={`flex items-center gap-1 ${statusBadge.color}`}>
              {statusBadge.icon}
              {statusBadge.text}
            </span>
          </div>

          {/* Body: kind-specific renderer */}
          <div className="px-3 py-3">
            {panel.kind === "weather" && <WeatherBody data={panel.data} hue={hue} />}
            {panel.kind === "email"   && <EmailBody   data={panel.data} hue={hue} />}
            {panel.kind === "recipe"  && <RecipeBody  data={panel.data} hue={hue} />}
            {panel.kind === "news"    && <NewsBody    data={panel.data} hue={hue} />}
            {(!panel.kind || panel.kind === "search") && (
              <FallbackBody panel={panel} hue={hue} />
            )}

            {status === "active" && (
              <div className="h-[2px] mt-2 rounded overflow-hidden" style={{ background: `hsla(${hue},90%,40%,0.3)` }}>
                <div
                  className="h-full rounded"
                  style={{
                    width: "40%",
                    background: `hsl(${hue},90%,70%)`,
                    animation: "aria-holo-bar 1.4s linear infinite",
                    boxShadow: `0 0 10px hsl(${hue},90%,70%)`,
                  }}
                />
              </div>
            )}
          </div>

          {/* Corner ticks */}
          <div className="absolute -top-px -left-px w-3 h-3 border-t border-l" style={{ borderColor: `hsla(${hue},90%,80%,0.9)` }} />
          <div className="absolute -top-px -right-px w-3 h-3 border-t border-r" style={{ borderColor: `hsla(${hue},90%,80%,0.9)` }} />
          <div className="absolute -bottom-px -left-px w-3 h-3 border-b border-l" style={{ borderColor: `hsla(${hue},90%,80%,0.9)` }} />
          <div className="absolute -bottom-px -right-px w-3 h-3 border-b border-r" style={{ borderColor: `hsla(${hue},90%,80%,0.9)` }} />

          {/* Scan-line shimmer */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: `repeating-linear-gradient(0deg, hsla(${hue},90%,80%,0.05) 0, hsla(${hue},90%,80%,0.05) 1px, transparent 1px, transparent 4px)`,
              mixBlendMode: "overlay",
            }}
          />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── KIND BODIES ─────────────────────────── */

const conditionIcon = (id) => {
  // OpenWeatherMap condition id → phosphor icon
  if (!id) return <Cloud size={42} weight="duotone" />;
  if (id >= 200 && id < 300) return <Lightning size={42} weight="fill" />;
  if (id >= 300 && id < 600) return <CloudRain size={42} weight="duotone" />;
  if (id >= 600 && id < 700) return <Snowflake size={42} weight="duotone" />;
  if (id === 800) return <Sun size={42} weight="fill" />;
  return <Cloud size={42} weight="duotone" />;
};

function WeatherBody({ data, hue }) {
  if (!data) return <SkeletonLines hue={hue} count={3} />;
  if (data.error) {
    return <p className="text-xs text-red-200/90" style={{ textTransform: "none" }}>{data.error}</p>;
  }
  const c = data.current || {};
  const forecast = (data.forecast || []).slice(0, 4);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div style={{ color: `hsl(${hue},90%,85%)` }}>
          {conditionIcon(c.condition_id)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] tracking-widest text-cyan-300/80 truncate" style={{ textTransform: "uppercase" }}>
            {c.city || "—"}
          </div>
          <div className="text-3xl font-bold text-white leading-none">
            {Math.round(c.temp ?? 0)}°<span className="text-base text-cyan-200/70">C</span>
          </div>
          <div className="text-[11px] text-cyan-100/85 truncate" style={{ textTransform: "none" }}>
            {c.description || ""}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1.5 text-[10px] text-cyan-100/85" style={{ textTransform: "none" }}>
        <div className="flex items-center gap-1"><Thermometer size={12} weight="bold" /> {Math.round(c.feels_like ?? 0)}°</div>
        <div className="flex items-center gap-1"><Drop size={12} weight="bold" /> {c.humidity ?? "—"}%</div>
        <div className="flex items-center gap-1"><Wind size={12} weight="bold" /> {Math.round(c.wind_speed ?? 0)} m/s</div>
      </div>
      {forecast.length > 0 && (
        <div className="grid grid-cols-4 gap-1 pt-1.5 border-t" style={{ borderColor: `hsla(${hue},80%,60%,0.3)` }}>
          {forecast.map((f, i) => (
            <div key={i} className="text-center">
              <div className="text-[9px] tracking-widest text-cyan-400/70">{f.day_short}</div>
              <div className="my-0.5 text-cyan-200/90 inline-block">{conditionIconSmall(f.condition_id)}</div>
              <div className="text-[10px] text-cyan-100">
                {Math.round(f.temp_max ?? 0)}° <span className="text-cyan-300/60">{Math.round(f.temp_min ?? 0)}°</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const conditionIconSmall = (id) => {
  if (id >= 200 && id < 300) return <Lightning size={16} weight="fill" />;
  if (id >= 300 && id < 600) return <CloudRain size={16} weight="duotone" />;
  if (id >= 600 && id < 700) return <Snowflake size={16} weight="duotone" />;
  if (id === 800) return <Sun size={16} weight="fill" />;
  return <Cloud size={16} weight="duotone" />;
};

function EmailBody({ data, hue }) {
  if (!data) return <SkeletonLines hue={hue} count={4} />;
  const { to, subject, body } = data;
  return (
    <div className="space-y-2 text-[11px]" style={{ textTransform: "none" }}>
      <div className="flex gap-2">
        <span className="text-amber-300/80 font-semibold w-12 shrink-0">An:</span>
        <span className="text-amber-100 truncate">{to || <em className="text-amber-200/50">…</em>}</span>
      </div>
      <div className="flex gap-2">
        <span className="text-amber-300/80 font-semibold w-12 shrink-0">Betreff:</span>
        <span className="text-amber-100 truncate">{subject || <em className="text-amber-200/50">…</em>}</span>
      </div>
      <div className="border-t pt-2 mt-1" style={{ borderColor: `hsla(${hue},80%,60%,0.3)` }}>
        <div className="text-amber-50 leading-snug whitespace-pre-wrap max-h-44 overflow-y-auto pr-1 text-[11px]">
          {body || <em className="text-amber-200/50">Aria verfasst den Text …</em>}
        </div>
      </div>
    </div>
  );
}

function RecipeBody({ data, hue }) {
  if (!data) return <SkeletonLines hue={hue} count={5} />;
  const { title, prep_time, ingredients = [], steps = [] } = data;
  return (
    <div className="space-y-2 text-[11px]" style={{ textTransform: "none" }}>
      <div className="text-orange-100 font-bold text-[13px] leading-tight">{title || "Rezept"}</div>
      {prep_time && <div className="text-orange-300/80 text-[10px]">⏱ {prep_time}</div>}
      {ingredients.length > 0 && (
        <div>
          <div className="text-[9px] tracking-widest text-orange-300/80 mb-1" style={{ textTransform: "uppercase" }}>Zutaten</div>
          <ul className="space-y-0.5 text-orange-50 max-h-24 overflow-y-auto pr-1">
            {ingredients.slice(0, 8).map((it, i) => (
              <li key={i} className="flex gap-1.5"><span className="text-orange-400/70">›</span>{it}</li>
            ))}
            {ingredients.length > 8 && (
              <li className="text-orange-300/60 italic">+ {ingredients.length - 8} weitere</li>
            )}
          </ul>
        </div>
      )}
      {steps.length > 0 && (
        <div className="border-t pt-1.5" style={{ borderColor: `hsla(${hue},80%,60%,0.3)` }}>
          <div className="text-[9px] tracking-widest text-orange-300/80 mb-1" style={{ textTransform: "uppercase" }}>Zubereitung</div>
          <ol className="space-y-1 text-orange-50 max-h-28 overflow-y-auto pr-1 list-decimal pl-4">
            {steps.slice(0, 4).map((s, i) => <li key={i} className="leading-snug">{s}</li>)}
          </ol>
        </div>
      )}
    </div>
  );
}

function NewsBody({ data, hue }) {
  if (!data) return <SkeletonLines hue={hue} count={4} />;
  const items = data.items || [];
  if (items.length === 0) {
    return <p className="text-[11px] text-cyan-100/70 italic" style={{ textTransform: "none" }}>Keine Treffer.</p>;
  }
  return (
    <ul className="space-y-2 text-[11px] max-h-56 overflow-y-auto pr-1" style={{ textTransform: "none" }}>
      {items.slice(0, 5).map((it, i) => (
        <li
          key={i}
          className="border-l-2 pl-2 py-0.5"
          style={{ borderColor: `hsla(${hue},90%,70%,0.6)`, animation: `aria-holo-in 400ms ease-out both`, animationDelay: `${i * 100}ms` }}
        >
          <div className="text-yellow-100 leading-snug font-semibold">{it.title}</div>
          <div className="flex items-center gap-1 text-[9px] text-yellow-300/70 mt-0.5">
            <Globe size={9} weight="bold" />
            <span className="truncate">{it.source || ""}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function FallbackBody({ panel, hue }) {
  return (
    <div className="space-y-1.5">
      {panel.query && (
        <div className="text-[11px] text-cyan-100/85 leading-snug line-clamp-2" style={{ textTransform: "none" }}>
          <span className="text-cyan-400/80">QUERY ›</span> {panel.query}
        </div>
      )}
      {panel.snippet && (
        <div className="text-[11px] text-emerald-100/85 leading-snug line-clamp-3" style={{ textTransform: "none" }}>
          <span className="text-emerald-400/80">↳</span> {panel.snippet}
        </div>
      )}
      {!panel.query && !panel.snippet && (
        <div className="text-[11px] text-cyan-300/60 italic">verarbeite…</div>
      )}
    </div>
  );
}

function SkeletonLines({ hue, count = 3 }) {
  return (
    <div className="space-y-1.5">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="h-2 rounded animate-pulse"
          style={{
            width: `${50 + ((i * 17) % 50)}%`,
            background: `hsla(${hue},80%,60%,0.25)`,
          }}
        />
      ))}
    </div>
  );
}

/* Hook helper: gently fade a panel away after `ms`. Used by AriaMode
   to auto-close rich panels once the user moves on. */
export function useAutoFade(onFade, deps, ms = 30000) {
  const [, force] = useState(0);
  useEffect(() => {
    force((x) => x + 1);
    const id = setTimeout(() => { try { onFade && onFade(); } catch {} }, ms);
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

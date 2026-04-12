import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useTheme, API } from "@/App";
import axios from "axios";
import { ArrowClockwise, Sun, Cloud, CloudRain, Snowflake, Wind, Drop, Thermometer, CloudSun } from "@phosphor-icons/react";

const OWM_ICON_URL = "https://openweathermap.org/img/wn";

const WeatherImage = ({ iconCode, size = 100, className = "" }) => {
  if (!iconCode) return null;
  return (
    <img
      src={`${OWM_ICON_URL}/${iconCode}@4x.png`}
      alt="Wetter"
      width={size}
      height={size}
      className={`drop-shadow-[0_0_12px_rgba(255,200,50,0.4)] ${className}`}
      style={{ imageRendering: "auto" }}
      data-testid="weather-image"
    />
  );
};

const SmallWeatherImage = ({ iconCode, size = 64 }) => {
  if (!iconCode) return null;
  return (
    <img
      src={`${OWM_ICON_URL}/${iconCode}@2x.png`}
      alt="Wetter"
      width={size}
      height={size}
      className="drop-shadow-[0_0_8px_rgba(255,200,50,0.3)]"
      data-testid="weather-image-small"
    />
  );
};

const weekday = (dateStr) => {
  const d = new Date(dateStr + "T12:00:00");
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Heute";
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return "Morgen";
  return d.toLocaleDateString("de-DE", { weekday: "long" });
};

const Weather = () => {
  const { theme } = useTheme();
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(true);
  const isLcars = theme === "startrek";
  const cardClass = isLcars ? "lcars-card" : "disney-card";

  const fetchWeather = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/weather`);
      setWeather(data);
    } catch { setWeather({ available: false, message: "Fehler beim Laden der Wetterdaten." }); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchWeather(); }, []);

  const sunTime = (ts) => ts ? new Date(ts * 1000).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "-";

  return (
    <div className="p-6">
      {/* Page Title */}
      <div className="flex items-center gap-4 mb-6">
        <h2 className={`${isLcars ? "text-lg tracking-widest text-[var(--lcars-orange)]" : "disney-title text-2xl font-bold"}`}>
          {isLcars ? "METEOROLOGISCHER SENSOR" : "Wetter"}
        </h2>
        <div className="flex-1" />
        <button onClick={fetchWeather} className={isLcars ? "lcars-button py-1 px-3 text-xs" : "disney-button py-1 px-3"} data-testid="weather-refresh">
          <ArrowClockwise size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div>
        {loading && !weather ? (
          <div className="text-center py-20">
            <div className={`animate-pulse text-xl ${isLcars ? "text-[var(--lcars-orange)] tracking-wider" : "text-purple-300"}`}>
              {isLcars ? "SCANNE ATMOSPHÄRE..." : "Lade Wetterdaten..."}
            </div>
          </div>
        ) : !weather?.available ? (
          <div className={`${cardClass} text-center py-12`} data-testid="weather-not-configured">
            <Cloud size={64} className={`mx-auto mb-4 ${isLcars ? "text-[var(--lcars-blue)]" : "text-purple-400"}`} />
            <p className={`text-lg mb-2 ${isLcars ? "text-[var(--lcars-orange)]" : "text-purple-200"}`}>
              {isLcars ? "SENSOREN NICHT KALIBRIERT" : "Wetter nicht verfügbar"}
            </p>
            <p className={`text-sm mb-4 ${isLcars ? "text-[var(--lcars-gold)]" : "text-purple-300"}`}>
              {weather?.message?.includes("Invalid API key")
                ? "Ungültiger API-Key. Bitte prüfe deinen OpenWeatherMap API-Key in den Admin-Einstellungen."
                : weather?.message?.includes("city not found")
                ? "Stadt nicht gefunden. Bitte prüfe den Stadtnamen in den Admin-Einstellungen (Format: Berlin,DE)."
                : weather?.message?.includes("nicht konfiguriert")
                ? "Bitte hinterlege Stadt und API-Key in den Admin-Einstellungen."
                : weather?.message || "Unbekannter Fehler."}
            </p>
            {weather?.message?.includes("Invalid API key") && (
              <p className={`text-xs mb-4 ${isLcars ? "text-gray-400" : "text-purple-400"}`}>
                Tipp: Neue API-Keys bei OpenWeatherMap können bis zu 2 Stunden brauchen um aktiv zu werden.
              </p>
            )}
            <Link to="/admin" className={isLcars ? "lcars-button" : "disney-button"} data-testid="weather-go-to-settings">
              {isLcars ? "ZU DEN EINSTELLUNGEN" : "Einstellungen"}
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Current Weather - Hero Card */}
            <div className={cardClass} data-testid="current-weather">
              <div className="flex items-center gap-6">
                {/* Weather Image */}
                <div className={`relative flex-shrink-0 ${isLcars ? "" : ""}`}>
                  <div className={`rounded-2xl p-2 ${isLcars ? "bg-[#1a1a2e]/60 border border-[var(--lcars-purple)]/20" : "bg-purple-900/20 border border-purple-700/20"}`}>
                    <WeatherImage iconCode={weather.current.icon} size={120} />
                  </div>
                </div>

                {/* Temperature + City */}
                <div className="flex-1">
                  <h2 className={`text-2xl font-bold mb-1 ${isLcars ? "text-[var(--lcars-orange)]" : "disney-title disney-glow"}`}>
                    {weather.city}
                  </h2>
                  <p className="text-sm text-gray-400 capitalize mb-3">{weather.current.description}</p>
                  <div className="flex items-end gap-2">
                    <span className={`text-6xl font-bold ${isLcars ? "text-[var(--lcars-orange)]" : "text-purple-100"}`}>
                      {weather.current.temp}
                    </span>
                    <span className={`text-2xl mb-2 ${isLcars ? "text-[var(--lcars-mauve)]" : "text-purple-300"}`}>°C</span>
                    <span className="text-sm text-gray-500 mb-2 ml-4">
                      Gefühlt {weather.current.feels_like}°C
                    </span>
                  </div>
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6">
                <div className="flex items-center gap-2">
                  <Drop size={18} className={isLcars ? "text-[var(--lcars-blue)]" : "text-blue-400"} />
                  <div>
                    <div className="text-xs text-gray-500">{isLcars ? "FEUCHTIGKEIT" : "Feuchtigkeit"}</div>
                    <div className="font-bold text-sm">{weather.current.humidity}%</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Wind size={18} className={isLcars ? "text-[var(--lcars-mauve)]" : "text-purple-400"} />
                  <div>
                    <div className="text-xs text-gray-500">{isLcars ? "WIND" : "Wind"}</div>
                    <div className="font-bold text-sm">{weather.current.wind_speed} km/h</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Thermometer size={18} className={isLcars ? "text-[var(--lcars-salmon)]" : "text-red-400"} />
                  <div>
                    <div className="text-xs text-gray-500">{isLcars ? "DRUCK" : "Druck"}</div>
                    <div className="font-bold text-sm">{weather.current.pressure} hPa</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Cloud size={18} className={isLcars ? "text-[var(--lcars-lavender)]" : "text-gray-400"} />
                  <div>
                    <div className="text-xs text-gray-500">{isLcars ? "WOLKEN" : "Wolken"}</div>
                    <div className="font-bold text-sm">{weather.current.clouds}%</div>
                  </div>
                </div>
              </div>

              {/* Sunrise/Sunset */}
              <div className="flex gap-8 mt-4 pt-4 border-t border-gray-800">
                <div className="flex items-center gap-2">
                  <Sun size={16} className="text-yellow-400" />
                  <span className="text-xs text-gray-500">Aufgang: <span className="font-bold text-gray-300">{sunTime(weather.current.sunrise)}</span></span>
                </div>
                <div className="flex items-center gap-2">
                  <Sun size={16} className="text-orange-500" />
                  <span className="text-xs text-gray-500">Untergang: <span className="font-bold text-gray-300">{sunTime(weather.current.sunset)}</span></span>
                </div>
              </div>
            </div>

            {/* Forecast */}
            {weather.forecast && weather.forecast.length > 0 && (
              <div data-testid="weather-forecast">
                <h3 className={`mb-4 ${isLcars ? "text-xs tracking-widest text-[var(--lcars-mauve)]" : "disney-title text-lg font-bold"}`}>
                  {isLcars ? "VORHERSAGE" : "Vorhersage"}
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {weather.forecast.map((day, i) => (
                    <div key={i} className={cardClass + " text-center"} data-testid={`forecast-day-${i}`}>
                      <div className={`text-sm font-bold mb-1 ${isLcars ? "text-[var(--lcars-orange)]" : "text-purple-200"}`}>
                        {weekday(day.date)}
                      </div>
                      <div className="flex justify-center">
                        <SmallWeatherImage iconCode={day.icon} size={64} />
                      </div>
                      <div className="text-xs text-gray-400 capitalize mb-2">{day.description}</div>
                      <div className="flex justify-center gap-3">
                        <span className="font-bold text-sm">{day.temp_max}°</span>
                        <span className="text-gray-500 text-sm">{day.temp_min}°</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Weather;

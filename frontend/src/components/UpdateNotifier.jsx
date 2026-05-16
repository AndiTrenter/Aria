/**
 * GitHub-Releases Update-Notifier (Android-only).
 *
 * On launch + every 6 hours:
 *   - Fetch GitHub `releases/latest` for the configured repo.
 *   - Compare `tag_name` (e.g. "v1.2.3") with the running app's
 *     declared version (from package.json, baked at build time as
 *     `process.env.REACT_APP_APP_VERSION`).
 *   - If a newer release exists AND there's an .apk asset attached,
 *     surface a small banner with a "Aktualisieren"-button that
 *     opens the APK download URL. Android's package installer
 *     handles the install confirmation natively.
 *
 * No-ops on non-Android platforms (Web build).
 *
 * Env vars (compile-time, supplied by GitHub Action or local .env):
 *   REACT_APP_GITHUB_REPO       — "owner/repo"  (required)
 *   REACT_APP_APP_VERSION       — current app version, e.g. "1.0.3"
 */
import { useEffect, useState } from "react";

const REPO = process.env.REACT_APP_GITHUB_REPO || "";
const APP_VERSION = process.env.REACT_APP_APP_VERSION || "0.0.0";
const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 min — frequent enough to catch fresh CI builds

// Detect Capacitor native runtime (so we don't badger Web users with
// "install APK" prompts they can't use).
const isNative = () => {
  try {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  } catch {
    return false;
  }
};

// Semver-ish compare. Accepts "v1.2.3" or "1.2.3". Returns:
//   1  if a > b, -1 if a < b, 0 if equal.
const cmpSemver = (a, b) => {
  const strip = (s) => String(s || "").replace(/^v/i, "").trim();
  const pa = strip(a).split(".").map((x) => parseInt(x, 10) || 0);
  const pb = strip(b).split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
};

export default function UpdateNotifier() {
  const [release, setRelease] = useState(null); // {tag, apkUrl, name, body}
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isNative()) return;
    if (!REPO) return;

    let alive = true;
    const check = async () => {
      try {
        const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
          headers: { Accept: "application/vnd.github+json" },
        });
        if (!res.ok) return;
        const data = await res.json();
        const latestTag = data?.tag_name || data?.name || "";
        if (cmpSemver(latestTag, APP_VERSION) <= 0) return;
        const apkAsset = (data?.assets || []).find((a) => /\.apk$/i.test(a.name));
        if (!apkAsset?.browser_download_url) return;
        if (!alive) return;
        // Honour per-version dismiss (so a user who tapped Später doesn't
        // see the same banner every 6 h)
        try {
          const skip = localStorage.getItem("aria_update_skip_tag");
          if (skip === latestTag) return;
        } catch {}
        setRelease({
          tag: latestTag,
          apkUrl: apkAsset.browser_download_url,
          name: data?.name || latestTag,
          body: (data?.body || "").slice(0, 600),
        });
      } catch (e) {
        // network blip — silently retry next interval
      }
    };
    check();
    const id = setInterval(check, CHECK_INTERVAL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (!release || dismissed) return null;

  const openApk = async () => {
    try {
      // Use Capacitor's App API to open the APK URL in the system
      // browser/downloader. Android's package installer takes over.
      const { App } = await import("@capacitor/app");
      if (App?.exitApp) {
        // Open URL via the Browser plugin if available; otherwise
        // fall back to window.open which Capacitor maps to the
        // system intent.
        const url = release.apkUrl;
        window.open(url, "_system");
      }
    } catch {
      window.open(release.apkUrl, "_blank");
    }
  };

  const skipThisVersion = () => {
    try { localStorage.setItem("aria_update_skip_tag", release.tag); } catch {}
    setDismissed(true);
  };

  return (
    <div
      data-testid="aria-update-banner"
      style={{
        position: "fixed",
        bottom: 16,
        left: 16,
        right: 16,
        zIndex: 9999,
        padding: "14px 16px",
        borderRadius: 12,
        background: "rgba(40,15,5,0.92)",
        border: "1px solid rgba(255,140,60,0.55)",
        boxShadow: "0 0 32px rgba(255,120,40,0.35)",
        color: "#ffd9b0",
        fontFamily: "ui-monospace, monospace",
        backdropFilter: "blur(8px)",
      }}
    >
      <div style={{ fontSize: 11, letterSpacing: "0.25em", color: "#ffaa6c", marginBottom: 4 }}>
        A.R.I.A. — UPDATE VERFÜGBAR
      </div>
      <div style={{ fontSize: 14, fontWeight: 600 }}>
        Neue Version <span style={{ color: "#ffd17a" }}>{release.tag}</span> bereit
      </div>
      {release.body && (
        <div style={{ fontSize: 11, opacity: 0.75, marginTop: 6, whiteSpace: "pre-wrap", maxHeight: 120, overflow: "auto" }}>
          {release.body}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button
          onClick={openApk}
          data-testid="aria-update-install-btn"
          style={{
            flex: 1,
            padding: "8px 14px",
            borderRadius: 8,
            background: "linear-gradient(180deg,#ff7a14,#c84808)",
            color: "#fff",
            border: 0,
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          Aktualisieren
        </button>
        <button
          onClick={skipThisVersion}
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            background: "transparent",
            color: "#ffd9b0",
            border: "1px solid rgba(255,170,90,0.4)",
            fontSize: 13,
          }}
        >
          Später
        </button>
      </div>
    </div>
  );
}

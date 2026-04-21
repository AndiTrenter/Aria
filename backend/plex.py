"""
Aria Plex Integration Module
Connects to local Plex Media Server for browsing and playing media.
"""
from fastapi import APIRouter, HTTPException, Request, Response
import httpx
import logging
import asyncio
import time

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/plex")

db = None
get_current_user = None

# Shared HTTP client with connection pooling for image proxy.
# Reusing one client prevents pool exhaustion when a grid of 30+ posters
# hits the proxy simultaneously (each new AsyncClient opens a fresh TCP
# connection — quickly overwhelms Plex and causes random thumbnail failures).
_image_client: httpx.AsyncClient | None = None

# Cache-bust version. Incremented when admin clicks "Cache leeren" — frontend
# appends this as query param so browser re-fetches all thumbnails.
_cache_bust_version: int = int(time.time())


def _get_image_client() -> httpx.AsyncClient:
    global _image_client
    if _image_client is None or _image_client.is_closed:
        _image_client = httpx.AsyncClient(
            timeout=httpx.Timeout(10.0, connect=5.0),
            follow_redirects=True,
            limits=httpx.Limits(max_keepalive_connections=20, max_connections=40),
        )
    return _image_client


def init(database, auth_func):
    global db, get_current_user
    db = database
    get_current_user = auth_func


async def get_plex_settings():
    url_doc = await db.settings.find_one({"key": "plex_url"})
    token_doc = await db.settings.find_one({"key": "plex_token"})
    url = url_doc["value"].rstrip("/") if url_doc and url_doc.get("value") else ""
    # Auto-prepend http:// if missing
    if url and not url.startswith("http"):
        url = f"http://{url}"
    token = token_doc["value"] if token_doc and token_doc.get("value") and "..." not in token_doc["value"] else ""
    return url, token


async def plex_request(path, params=None):
    """Make authenticated request to Plex API."""
    url, token = await get_plex_settings()
    if not url or not token:
        return None, "Plex nicht konfiguriert"
    try:
        headers = {"Accept": "application/json", "X-Plex-Token": token}
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{url}{path}", headers=headers, params=params or {})
            if resp.status_code == 200:
                return resp.json(), None
            return None, f"Plex Fehler: HTTP {resp.status_code}"
    except Exception as e:
        logger.error(f"Plex request error: {e}")
        return None, str(e)


@router.get("/status")
async def plex_status(request: Request):
    await get_current_user(request)
    url, token = await get_plex_settings()
    if not url or not token:
        return {"connected": False, "message": "Nicht konfiguriert"}
    data, err = await plex_request("/")
    if data:
        mc = data.get("MediaContainer", {})
        return {"connected": True, "name": mc.get("friendlyName", "Plex"), "version": mc.get("version", "?")}
    return {"connected": False, "message": err or "Nicht erreichbar"}


@router.get("/libraries")
async def get_libraries(request: Request):
    """Get all Plex libraries (Movies, TV, Music)."""
    await get_current_user(request)
    data, err = await plex_request("/library/sections")
    if not data:
        return []
    dirs = data.get("MediaContainer", {}).get("Directory", [])
    return [{"id": d["key"], "title": d["title"], "type": d["type"],
             "count": d.get("count", 0), "thumb": d.get("composite", "")} for d in dirs]


@router.get("/library/{section_id}")
async def get_library_items(request: Request, section_id: str, start: int = 0, size: int = 50, sort: str = "addedAt:desc"):
    """Get items in a library section with pagination."""
    await get_current_user(request)
    params = {"X-Plex-Container-Start": start, "X-Plex-Container-Size": size, "sort": sort}
    data, err = await plex_request(f"/library/sections/{section_id}/all", params)
    if not data:
        return {"items": [], "total": 0}
    mc = data.get("MediaContainer", {})
    items = mc.get("Metadata", [])
    url, token = await get_plex_settings()
    return {
        "items": [_format_item(item, url, token) for item in items],
        "total": mc.get("totalSize", mc.get("size", len(items))),
        "offset": mc.get("offset", start),
    }


@router.get("/search")
async def search_media(request: Request, q: str = ""):
    """Search across all Plex libraries."""
    await get_current_user(request)
    if not q:
        return {"results": []}
    data, err = await plex_request("/hubs/search", {"query": q, "limit": 20})
    if not data:
        return {"results": [], "error": err}
    url, token = await get_plex_settings()
    results = []
    for hub in data.get("MediaContainer", {}).get("Hub", []):
        for item in hub.get("Metadata", []):
            results.append(_format_item(item, url, token))
    return {"results": results}


@router.get("/metadata/{rating_key}")
async def get_metadata(request: Request, rating_key: str):
    """Get detailed metadata for a specific item."""
    await get_current_user(request)
    data, err = await plex_request(f"/library/metadata/{rating_key}")
    if not data:
        raise HTTPException(404, err or "Nicht gefunden")
    url, token = await get_plex_settings()
    items = data.get("MediaContainer", {}).get("Metadata", [])
    if not items:
        raise HTTPException(404, "Nicht gefunden")
    item = items[0]
    detail = _format_item(item, url, token)
    # Add extra details
    detail["summary"] = item.get("summary", "")
    detail["tagline"] = item.get("tagline", "")
    detail["studio"] = item.get("studio", "")
    detail["content_rating"] = item.get("contentRating", "")
    detail["audience_rating"] = item.get("audienceRating", 0)
    detail["duration_ms"] = item.get("duration", 0)
    # Genres
    detail["genres"] = [g.get("tag", "") for g in item.get("Genre", [])]
    # Cast
    detail["roles"] = [{"name": r.get("tag", ""), "role": r.get("role", ""), "thumb": _thumb_url(r.get("thumb"), url, token)} for r in item.get("Role", [])[:10]]
    # Directors
    detail["directors"] = [d.get("tag", "") for d in item.get("Director", [])]
    # Media info
    media = item.get("Media", [{}])[0] if item.get("Media") else {}
    detail["video_resolution"] = media.get("videoResolution", "")
    detail["audio_channels"] = media.get("audioChannels", 0)
    detail["container"] = media.get("container", "")
    # Seasons for TV shows
    if item.get("type") == "show":
        children_data, _ = await plex_request(f"/library/metadata/{rating_key}/children")
        if children_data:
            seasons = children_data.get("MediaContainer", {}).get("Metadata", [])
            detail["seasons"] = [{"key": s.get("ratingKey"), "title": s.get("title", ""), "index": s.get("index", 0),
                                  "episode_count": s.get("leafCount", 0), "thumb": _thumb_url(s.get("thumb"), url, token)} for s in seasons]
    # Episodes for a season
    if item.get("type") == "season":
        children_data, _ = await plex_request(f"/library/metadata/{rating_key}/children")
        if children_data:
            episodes = children_data.get("MediaContainer", {}).get("Metadata", [])
            detail["episodes"] = [_format_item(ep, url, token) for ep in episodes]
    return detail


@router.get("/children/{rating_key}")
async def get_children(request: Request, rating_key: str):
    """Get children (seasons of show, episodes of season)."""
    await get_current_user(request)
    data, err = await plex_request(f"/library/metadata/{rating_key}/children")
    if not data:
        return []
    url, token = await get_plex_settings()
    items = data.get("MediaContainer", {}).get("Metadata", [])
    return [_format_item(item, url, token) for item in items]


@router.get("/recently-added")
async def recently_added(request: Request, limit: int = 20):
    """Get recently added media."""
    await get_current_user(request)
    data, err = await plex_request("/library/recentlyAdded", {"X-Plex-Container-Size": limit})
    if not data:
        return []
    url, token = await get_plex_settings()
    items = data.get("MediaContainer", {}).get("Metadata", [])
    return [_format_item(item, url, token) for item in items]


@router.get("/on-deck")
async def on_deck(request: Request):
    """Get on-deck (continue watching) items."""
    await get_current_user(request)
    data, err = await plex_request("/library/onDeck")
    if not data:
        return []
    url, token = await get_plex_settings()
    items = data.get("MediaContainer", {}).get("Metadata", [])
    return [_format_item(item, url, token) for item in items]


def _thumb_url(thumb_path, base_url, token):
    if not thumb_path:
        return ""
    from urllib.parse import quote
    return f"/api/plex/image?path={quote(thumb_path, safe='')}"


def _format_item(item, base_url, token):
    """Format a Plex metadata item for the frontend."""
    from urllib.parse import quote
    rating_key = item.get("ratingKey", "")
    # Use actual thumb path from Plex (includes timestamp hash)
    thumb_path = item.get("thumb", "")
    art_path = item.get("art", "")
    return {
        "rating_key": rating_key,
        "title": item.get("title", ""),
        "type": item.get("type", ""),
        "year": item.get("year", ""),
        "thumb": f"/api/plex/image?path={quote(thumb_path, safe='')}" if thumb_path else "",
        "art": f"/api/plex/image?path={quote(art_path, safe='')}" if art_path else "",
        "rating": item.get("rating", 0),
        "view_count": item.get("viewCount", 0),
        "added_at": item.get("addedAt", 0),
        "duration": item.get("duration", 0),
        "index": item.get("index"),
        "parent_title": item.get("parentTitle", ""),
        "grandparent_title": item.get("grandparentTitle", ""),
        "originally_available": item.get("originallyAvailableAt", ""),
    }


@router.get("/image")
async def proxy_image(request: Request, path: str = "", w: int = 0, h: int = 0):
    """Image proxy for Plex.

    Uses Plex's `/photo/:/transcode` endpoint which reliably handles:
      - Internal paths (/library/metadata/.../thumb/...)
      - External URLs (https://metadata-static.plex.tv/people/...jpg for actor thumbs)
      - Paths with query strings
      - Redirects (Plex 301/302 to actual image location)

    Falls back to direct fetch if transcode returns non-image (e.g. 404).
    """
    url, token = await get_plex_settings()
    if not url or not token or not path:
        raise HTTPException(404)

    client = _get_image_client()
    # Step 1: Try transcode (best approach — handles external URLs and redirects)
    transcode_params = {
        "url": path,
        "width": w if w > 0 else 400,
        "height": h if h > 0 else 600,
        "minSize": 1,
        "upscale": 1,
        "X-Plex-Token": token,
    }
    try:
        resp = await client.get(f"{url}/photo/:/transcode", params=transcode_params)
        content_type = resp.headers.get("content-type", "")
        if resp.status_code == 200 and resp.content and content_type.startswith("image/"):
            return Response(
                content=resp.content,
                media_type=content_type,
                headers={"Cache-Control": "public, max-age=86400"},
            )
        logger.debug(f"Plex transcode fallback ({resp.status_code}, {content_type}) for {path[:120]}")
    except Exception as e:
        logger.debug(f"Plex transcode error: {e} for {path[:120]}")

    # Step 2: Fallback — direct fetch (only for internal paths starting with /)
    if path.startswith("/"):
        try:
            resp = await client.get(f"{url}{path}", params={"X-Plex-Token": token})
            content_type = resp.headers.get("content-type", "")
            if resp.status_code == 200 and resp.content and content_type.startswith("image/"):
                return Response(
                    content=resp.content,
                    media_type=content_type,
                    headers={"Cache-Control": "public, max-age=86400"},
                )
            logger.warning(f"Plex image direct fetch failed ({resp.status_code}) for {path[:120]}")
        except Exception as e:
            logger.warning(f"Plex image direct fetch error: {e} for {path[:120]}")

    # Step 3: Fallback — external URL (e.g. metadata-static.plex.tv for actor thumbs)
    if path.startswith("http://") or path.startswith("https://"):
        try:
            resp = await client.get(path)
            content_type = resp.headers.get("content-type", "")
            if resp.status_code == 200 and resp.content and content_type.startswith("image/"):
                return Response(
                    content=resp.content,
                    media_type=content_type,
                    headers={"Cache-Control": "public, max-age=86400"},
                )
            logger.warning(f"Plex external image failed ({resp.status_code}) for {path[:120]}")
        except Exception as e:
            logger.warning(f"Plex external image error: {e} for {path[:120]}")

    raise HTTPException(404)


@router.get("/thumb/{rating_key}")
async def get_thumb_proxy(request: Request, rating_key: str, w: int = 300, h: int = 450):
    """Proxy thumbnail from Plex via transcode (kept for explicit rating_key lookups)."""
    url, token = await get_plex_settings()
    if not url or not token:
        raise HTTPException(404)
    try:
        client = _get_image_client()
        resp = await client.get(f"{url}/photo/:/transcode", params={
            "width": w, "height": h, "minSize": 1, "upscale": 1,
            "url": f"/library/metadata/{rating_key}/thumb", "X-Plex-Token": token,
        })
        content_type = resp.headers.get("content-type", "")
        if resp.status_code == 200 and resp.content and content_type.startswith("image/"):
            return Response(
                content=resp.content,
                media_type=content_type,
                headers={"Cache-Control": "public, max-age=86400"},
            )
    except Exception as e:
        logger.warning(f"Plex thumb proxy error: {e}")
    raise HTTPException(404)


# ==================== CHAT CONTEXT ====================

_STOPWORDS_DE = {
    "der", "die", "das", "den", "dem", "ein", "eine", "einen", "einer",
    "hast", "hat", "ist", "sind", "war", "gibt", "es", "auf", "mit", "von",
    "zu", "im", "in", "an", "bei", "und", "oder", "nicht", "wie", "was",
    "welche", "welcher", "wer", "wo", "zeig", "mir", "uns", "dir", "ich",
    "du", "wir", "ihr", "sie", "kannst", "kann", "könntest", "möchte",
    "plex", "film", "filme", "serie", "serien", "musik", "titel", "bitte",
    "mal", "auch", "noch", "schon", "etwa", "ein", "paar", "wieviele",
    "wieviel", "viele", "anzahl", "für", "über", "schauen", "anschauen",
    "stream", "streamen", "nach", "einem", "einen", "einer", "doch",
}


def _extract_search_terms(message: str) -> list[str]:
    """Extract meaningful search words, preserving title casing hints."""
    # Keep quoted substrings as one token
    import re as _re
    quoted = _re.findall(r'"([^"]+)"|«([^»]+)»|„([^"]+)"', message)
    quoted_terms = [t for grp in quoted for t in grp if t]
    stripped = _re.sub(r'"[^"]*"|«[^»]*»|„[^"]*"', " ", message)
    tokens = [t.strip(",.!?:;()[]{}\"'") for t in stripped.split()]
    terms = [t for t in tokens if len(t) >= 3 and t.lower() not in _STOPWORDS_DE]
    # Preserve quoted full-strings first (most specific)
    return quoted_terms + terms


async def build_chat_context(message: str) -> str:
    """Build rich Plex context for Aria chat based on user question.

    Provides:
    - Library summary (counts per section) for count-questions or always as baseline
    - Search results when user asks about specific titles
    - Recently added when user asks for 'neu/zuletzt'
    """
    url, token = await get_plex_settings()
    if not url or not token:
        return ""

    msg_lower = message.lower()
    parts: list[str] = []

    # ---- 1) Library summary (always useful, cheap call) ----
    libs_data, _ = await plex_request("/library/sections")
    lib_summary_lines: list[str] = []
    section_info: list[dict] = []
    if libs_data:
        dirs = libs_data.get("MediaContainer", {}).get("Directory", [])
        for d in dirs:
            # Fetch total count for this section — Plex returns totalSize in container
            sec_data, _ = await plex_request(
                f"/library/sections/{d['key']}/all",
                {"X-Plex-Container-Start": 0, "X-Plex-Container-Size": 0},
            )
            total = 0
            if sec_data:
                total = sec_data.get("MediaContainer", {}).get("totalSize", 0) or 0
            section_info.append({"key": d["key"], "title": d["title"], "type": d["type"], "count": total})
            lib_summary_lines.append(f"  - {d['title']} ({d['type']}): {total} Titel")

    if lib_summary_lines:
        parts.append("PLEX BIBLIOTHEKS-ÜBERSICHT (autoritative Zahlen):\n" + "\n".join(lib_summary_lines))

    # ---- 2) Count-Intent? ("wieviele / anzahl") — summary above already covers this ----

    # ---- 3) Search Intent ----
    search_terms = _extract_search_terms(message)
    search_results_text: list[str] = []
    if search_terms:
        # Try full-query search first (most specific)
        for query in [" ".join(search_terms[:6]), " ".join(search_terms[:3]), search_terms[0]]:
            if not query:
                continue
            data, err = await plex_request("/hubs/search", {"query": query, "limit": 15})
            if data and not err:
                hits: list[str] = []
                for hub in data.get("MediaContainer", {}).get("Hub", []) or []:
                    hub_type = hub.get("type", "")
                    # Only keep movie/show/episode/artist/album/track hubs
                    if hub_type not in ("movie", "show", "episode", "artist", "album", "track"):
                        continue
                    for item in hub.get("Metadata", []) or []:
                        title = item.get("title", "")
                        year = item.get("year", "")
                        itype = item.get("type", hub_type)
                        parent = item.get("parentTitle", "")
                        grand = item.get("grandparentTitle", "")
                        lib_title = item.get("librarySectionTitle", "")
                        extra = []
                        if grand:
                            extra.append(grand)
                        if parent and parent != grand:
                            extra.append(parent)
                        extra_str = f" [{' · '.join(extra)}]" if extra else ""
                        year_str = f" ({year})" if year else ""
                        lib_str = f" — {lib_title}" if lib_title else ""
                        hits.append(f"  - {title}{year_str} [{itype}]{extra_str}{lib_str}")
                if hits:
                    search_results_text.append(f"PLEX SUCHE nach '{query}':\n" + "\n".join(hits[:15]))
                    break  # Got results, no need to try broader
        if not search_results_text:
            # Explicit "nicht gefunden" signal so GPT answers honestly
            search_results_text.append(f"PLEX SUCHE nach '{' '.join(search_terms[:4])}': KEINE TREFFER (Titel existiert nicht in der Bibliothek).")

    if search_results_text:
        parts.append("\n\n".join(search_results_text))

    # ---- 4) Recently Added ----
    if any(w in msg_lower for w in ["neu", "neues", "zuletzt", "hinzugefügt", "empfehlung", "empfiehl", "was gibt"]):
        recent_data, _ = await plex_request("/library/recentlyAdded", {"X-Plex-Container-Size": "10"})
        if recent_data:
            items = recent_data.get("MediaContainer", {}).get("Metadata", []) or []
            if items:
                lines = []
                for i in items[:10]:
                    t = i.get("title", "")
                    y = i.get("year", "")
                    tt = i.get("type", "")
                    gp = i.get("grandparentTitle", "")
                    prefix = f"{gp} - " if gp else ""
                    lines.append(f"  - {prefix}{t} ({y}) [{tt}]")
                parts.append("PLEX ZULETZT HINZUGEFÜGT:\n" + "\n".join(lines))

    return "\n\n".join(parts) if parts else ""


# ==================== CACHE-BUST + WARM-UP ====================

@router.get("/cache-version")
async def get_cache_version():
    """Returns the current cache-bust version.
    Frontend appends this to image URLs so admin-triggered cache invalidation
    forces the browser to re-fetch all thumbnails."""
    return {"version": _cache_bust_version}


@router.post("/cache-clear")
async def clear_cache(request: Request):
    """Admin-only: bump cache version → all browsers will re-fetch images."""
    global _cache_bust_version
    # Simple admin gate (reuses get_current_user injected at init)
    if get_current_user:
        try:
            user = await get_current_user(request)
            if user.get("role") not in ("admin", "superadmin"):
                raise HTTPException(403, "Admin only")
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(401, "Auth required")
    _cache_bust_version = int(time.time())
    return {"success": True, "version": _cache_bust_version}


@router.get("/warmup")
async def warmup_thumbnails(request: Request, limit: int = 100):
    """Return a list of thumbnail URLs to preload in the browser on login.
    Browser creates <img> tags from these → populates HTTP cache → grid loads instantly next time.
    """
    if get_current_user:
        try:
            await get_current_user(request)
        except Exception:
            raise HTTPException(401)
    url, token = await get_plex_settings()
    if not url or not token:
        return {"urls": [], "count": 0}

    limit = max(1, min(200, int(limit)))
    urls: list[str] = []

    # Strategy: pull recently-added (most likely to be viewed) + on-deck (in-progress)
    try:
        recent, _ = await plex_request("/library/recentlyAdded", {"X-Plex-Container-Size": str(limit)})
        if recent:
            for item in recent.get("MediaContainer", {}).get("Metadata", []) or []:
                formatted = _format_item(item, url, token)
                if formatted.get("thumb"):
                    urls.append(f"{formatted['thumb']}&v={_cache_bust_version}")
    except Exception as e:
        logger.warning(f"Warmup recentlyAdded failed: {e}")

    if len(urls) < limit:
        try:
            on_deck, _ = await plex_request("/library/onDeck")
            if on_deck:
                for item in on_deck.get("MediaContainer", {}).get("Metadata", []) or []:
                    formatted = _format_item(item, url, token)
                    if formatted.get("thumb"):
                        thumb_url = f"{formatted['thumb']}&v={_cache_bust_version}"
                        if thumb_url not in urls:
                            urls.append(thumb_url)
                        if len(urls) >= limit:
                            break
        except Exception as e:
            logger.warning(f"Warmup onDeck failed: {e}")

    return {"urls": urls[:limit], "count": len(urls[:limit]), "cache_version": _cache_bust_version}

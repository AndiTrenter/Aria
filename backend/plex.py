"""
Aria Plex Integration Module
Connects to local Plex Media Server for browsing and playing media.
"""
from fastapi import APIRouter, HTTPException, Request, Response
import httpx
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/plex")

db = None
get_current_user = None

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
async def proxy_image(request: Request, path: str = ""):
    """Generic image proxy for Plex. No auth required for images (token in Plex request)."""
    url, token = await get_plex_settings()
    if not url or not token or not path:
        raise HTTPException(404)
    try:
        full_url = f"{url}{path}" if path.startswith("/") else f"{url}/{path}"
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(full_url, params={"X-Plex-Token": token})
            if resp.status_code == 200:
                return Response(content=resp.content, media_type=resp.headers.get("content-type", "image/jpeg"),
                    headers={"Cache-Control": "public, max-age=86400"})
    except Exception:
        pass
    raise HTTPException(404)


@router.get("/thumb/{rating_key}")
async def get_thumb_proxy(request: Request, rating_key: str, w: int = 300, h: int = 450):
    """Proxy thumbnail from Plex via transcode."""
    url, token = await get_plex_settings()
    if not url or not token:
        raise HTTPException(404)
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{url}/photo/:/transcode",
                params={"width": w, "height": h, "minSize": 1, "upscale": 1,
                         "url": f"/library/metadata/{rating_key}/thumb", "X-Plex-Token": token})
            if resp.status_code == 200:
                return Response(content=resp.content, media_type=resp.headers.get("content-type", "image/jpeg"),
                    headers={"Cache-Control": "public, max-age=86400"})
    except Exception:
        pass
    raise HTTPException(404)

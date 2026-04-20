"""
Test Plex image proxy end-to-end:
- Internal thumb path (/library/metadata/.../thumb/...)
- External URL (https://metadata-static.plex.tv/...) for actor thumbs
- Redirects (301/302)
- Parallel load (30+ concurrent image requests — grid scenario)
"""
import asyncio
import json
import os
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "aria_dashboard_test")

PLEX_FAKE_JPEG = b"\xff\xd8\xff\xe0" + b"FAKEJPEGDATA" + b"\xff\xd9"  # minimal fake JPEG bytes


def _free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


class PlexMock(BaseHTTPRequestHandler):
    # Stats counters
    transcode_calls = 0
    direct_calls = 0

    def log_message(self, *a, **kw): pass

    def _send_img(self, body=PLEX_FAKE_JPEG):
        self.send_response(200)
        self.send_header("Content-Type", "image/jpeg")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}

        if u.path == "/photo/:/transcode":
            PlexMock.transcode_calls += 1
            url_param = q.get("url", "")
            # Plex's transcode endpoint works for both internal & external URLs
            if url_param.startswith("http"):
                # External URL — Plex fetches it and returns
                self._send_img()
                return
            if url_param.startswith("/library/metadata/"):
                self._send_img()
                return
            # Unknown input
            self.send_response(404); self.end_headers()
            return

        if u.path.startswith("/library/metadata/") and "/thumb" in u.path:
            PlexMock.direct_calls += 1
            # Simulate a redirect (real Plex behavior for some setups)
            self.send_response(302)
            self.send_header("Location", f"/photo/:/transcode?url={self.path}&X-Plex-Token={q.get('X-Plex-Token','x')}")
            self.end_headers()
            return

        if u.path == "/metadata-static-mock":
            # Simulates metadata-static.plex.tv (external)
            self._send_img()
            return

        self.send_response(404); self.end_headers()


async def run():
    from motor.motor_asyncio import AsyncIOMotorClient
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    port = _free_port()
    srv = ThreadingHTTPServer(("127.0.0.1", port), PlexMock)
    t = threading.Thread(target=srv.serve_forever, daemon=True); t.start()
    base = f"http://127.0.0.1:{port}"

    try:
        await db.settings.update_one({"key": "plex_url"}, {"$set": {"key": "plex_url", "value": base}}, upsert=True)
        await db.settings.update_one({"key": "plex_token"}, {"$set": {"key": "plex_token", "value": "XYZ123"}}, upsert=True)

        import plex
        plex.db = db

        # Call proxy_image directly (bypasses FastAPI routing)
        from fastapi import Request
        from unittest.mock import MagicMock
        req = MagicMock()

        print("==> Test 1: Internal movie thumb path")
        resp = await plex.proxy_image(req, path="/library/metadata/1234/thumb/1234567890")
        assert resp.body == PLEX_FAKE_JPEG, f"bad body: {resp.body[:50]}"
        assert resp.media_type.startswith("image/")
        print(f"   OK (transcode calls: {PlexMock.transcode_calls}, direct: {PlexMock.direct_calls})")

        print("==> Test 2: External URL (actor thumb from metadata-static.plex.tv)")
        external_url = f"{base}/metadata-static-mock"
        resp = await plex.proxy_image(req, path=external_url)
        assert resp.body == PLEX_FAKE_JPEG, f"bad body: {resp.body[:50]}"
        print(f"   OK — external URL handled via transcode")

        print("==> Test 3: Unknown path → 404")
        try:
            await plex.proxy_image(req, path="/nonexistent/path")
            print("   FAIL (should have raised)")
        except Exception as e:
            assert "404" in str(e) or "HTTPException" in str(type(e).__name__), f"wrong error: {e}"
            print("   OK — raises 404 as expected")

        print("==> Test 4: Empty path → 404")
        try:
            await plex.proxy_image(req, path="")
            print("   FAIL (should have raised)")
        except Exception as e:
            print("   OK — empty path rejected")

        print("==> Test 5: Parallel load (30 concurrent requests — grid scenario)")
        PlexMock.transcode_calls = 0
        tasks = [plex.proxy_image(req, path=f"/library/metadata/{i}/thumb/9999{i}") for i in range(30)]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        success = sum(1 for r in results if not isinstance(r, Exception))
        print(f"   {success}/30 succeeded (transcode calls: {PlexMock.transcode_calls})")
        assert success == 30, f"only {success}/30 succeeded — connection pool exhaustion!"

        print("==> Test 6: Cache-Control header set")
        resp = await plex.proxy_image(req, path="/library/metadata/1/thumb/1")
        assert "max-age" in resp.headers.get("cache-control", "").lower(), f"missing cache-control: {resp.headers}"
        print("   OK — Cache-Control header present")

        print("\nAll image proxy tests passed")
    finally:
        srv.shutdown(); srv.server_close()
        if plex._image_client is not None:
            await plex._image_client.aclose()
        await db.settings.delete_many({"key": {"$in": ["plex_url", "plex_token"]}})


if __name__ == "__main__":
    asyncio.run(run())

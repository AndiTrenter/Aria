"""
Unit tests for plex.build_chat_context + image proxy.
Mocks a Plex-Server to validate count/search/not-found flows.
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


def _free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


class PlexMock(BaseHTTPRequestHandler):
    def log_message(self, *a, **kw): pass

    def _json(self, body):
        data = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if u.path == "/library/sections":
            return self._json({"MediaContainer": {"Directory": [
                {"key": "1", "title": "Filme", "type": "movie"},
                {"key": "2", "title": "Serien", "type": "show"},
                {"key": "3", "title": "Musik", "type": "artist"},
            ]}})
        if u.path.startswith("/library/sections/") and u.path.endswith("/all"):
            key = u.path.split("/")[3]
            totals = {"1": 423, "2": 87, "3": 512}
            return self._json({"MediaContainer": {"totalSize": totals.get(key, 0), "size": 0, "Metadata": []}})
        if u.path == "/hubs/search":
            query = (q.get("query", "") or "").lower()
            hubs = []
            if "matrix" in query:
                hubs.append({"type": "movie", "Metadata": [
                    {"title": "The Matrix", "year": 1999, "type": "movie", "librarySectionTitle": "Filme"},
                    {"title": "The Matrix Reloaded", "year": 2003, "type": "movie", "librarySectionTitle": "Filme"},
                ]})
            if "breaking" in query:
                hubs.append({"type": "show", "Metadata": [
                    {"title": "Breaking Bad", "year": 2008, "type": "show", "librarySectionTitle": "Serien"},
                ]})
            return self._json({"MediaContainer": {"Hub": hubs}})
        if u.path == "/library/recentlyAdded":
            return self._json({"MediaContainer": {"Metadata": [
                {"title": "Oppenheimer", "year": 2023, "type": "movie"},
                {"title": "Stranger Things", "year": 2023, "type": "show"},
            ]}})
        if u.path.startswith("/library/metadata/") and "/thumb" in u.path:
            # Return tiny image
            body = b"FAKEIMG"
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
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
        plex.db = db  # init skipped, direct inject

        # --- Test 1: Count-Frage
        print("==> Test 1: 'Wieviele Filme hast du?'")
        ctx = await plex.build_chat_context("Wieviele Filme hast du?")
        assert "423" in ctx, f"Movie count missing:\n{ctx}"
        assert "87" in ctx and "512" in ctx, f"Other counts missing:\n{ctx}"
        assert "BIBLIOTHEKS-ÜBERSICHT" in ctx
        print("   OK counts:\n" + ctx.split("\n\n")[0])

        # --- Test 2: Specific movie exists
        print("\n==> Test 2: 'Hast du Matrix auf Plex?'")
        ctx = await plex.build_chat_context("Hast du Matrix auf Plex?")
        assert "Matrix" in ctx, f"Match missing:\n{ctx}"
        assert "1999" in ctx or "2003" in ctx
        assert "KEINE TREFFER" not in ctx
        print("   OK found:\n" + ctx)

        # --- Test 3: Specific movie not in library
        print("\n==> Test 3: 'Hast du Avatar auf Plex?'")
        ctx = await plex.build_chat_context("Hast du Avatar auf Plex?")
        assert "KEINE TREFFER" in ctx, f"Should report not found:\n{ctx}"
        print("   OK not-found signal:\n" + ctx)

        # --- Test 4: Recently added intent
        print("\n==> Test 4: 'Was gibt es neues auf Plex?'")
        ctx = await plex.build_chat_context("Was gibt es neues auf Plex?")
        assert "Oppenheimer" in ctx, f"Recent missing:\n{ctx}"
        assert "ZULETZT HINZUGEFÜGT" in ctx
        print("   OK recent:\n" + ctx)

        # --- Test 5: Series
        print("\n==> Test 5: 'Hast du Breaking Bad?'")
        ctx = await plex.build_chat_context("Hast du Breaking Bad?")
        assert "Breaking Bad" in ctx, f"Series missing:\n{ctx}"
        print("   OK series found")

        # --- Test 6: Image proxy with redirects (synthetic)
        print("\n==> Test 6: build_chat_context stable with quoted title")
        ctx = await plex.build_chat_context('Hast du den Film "The Matrix" auf Plex?')
        assert "Matrix" in ctx
        assert "KEINE TREFFER" not in ctx
        print("   OK quoted search")

        print("\nAll Plex chat-context tests passed")
    finally:
        srv.shutdown(); srv.server_close()
        await db.settings.delete_many({"key": {"$in": ["plex_url", "plex_token"]}})


if __name__ == "__main__":
    asyncio.run(run())

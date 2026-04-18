"""
Integration test for ForgePilot module using a mock SSE server.
Run from /app/backend: python3 -m tests.test_forgepilot_integration
"""
import asyncio
import json
import os
import socket
import threading
import uuid
from contextlib import contextmanager

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "aria_dashboard_test")

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def _free_port() -> int:
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


class MockForgePilotHandler(BaseHTTPRequestHandler):
    project_store = {}
    next_response_mode = "normal"  # normal | ask_user | still_running

    def log_message(self, *a, **kw):  # silence
        pass

    def _send_json(self, code, body):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        data = json.dumps(body).encode()
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/api/health":
            self._send_json(200, {"status": "healthy"})
            return
        if self.path.startswith("/api/projects/"):
            pid = self.path.split("/")[-1]
            proj = MockForgePilotHandler.project_store.get(pid)
            if proj:
                self._send_json(200, proj)
            else:
                self._send_json(404, {"detail": "not found"})
            return
        self._send_json(404, {"detail": "unknown"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length).decode() if length else "{}"
        payload = json.loads(body) if body else {}

        if self.path == "/api/projects":
            pid = str(uuid.uuid4())
            proj = {"id": pid, "name": payload.get("name", "mock"), "status": "active"}
            MockForgePilotHandler.project_store[pid] = proj
            self._send_json(200, proj)
            return

        if self.path.endswith("/chat"):
            mode = MockForgePilotHandler.next_response_mode
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()

            def write_event(obj):
                line = f"data: {json.dumps(obj)}\n\n".encode()
                self.wfile.write(line)
                self.wfile.flush()

            if mode == "ask_user":
                write_event({"content": "Ich brauche mehr Infos. ", "iteration": 1})
                write_event({"tool": "ask_user", "args": {"question": "x"}})
                write_event({"ask_user": True, "question": "Welche Sprache soll ich nutzen – Python oder JavaScript?", "critical": True})
                return

            if mode == "still_running":
                write_event({"content": "Analysiere Repo... ", "iteration": 1})
                write_event({"tool": "read_file", "args": {}})
                write_event({"content": "Plane Struktur... ", "iteration": 2})
                # Halte die Verbindung offen bis der Client durch Timeout abbricht
                try:
                    import time
                    for _ in range(120):
                        time.sleep(0.5)
                        try:
                            self.wfile.write(b": keep-alive\n\n")
                            self.wfile.flush()
                        except Exception:
                            break
                except Exception:
                    pass
                return

            # normal
            write_event({"content": "Ich habe einen Python-Crawler gebaut, der 404 Fehler ignoriert. ", "iteration": 1})
            write_event({"tool": "create_file", "args": {}})
            write_event({"content": "Datei crawler.py wurde erstellt.", "iteration": 2})
            write_event({"complete": True})
            write_event({"done": True, "iterations": 2, "status": "completed"})
            return

        self._send_json(404, {"detail": "unknown"})


@contextmanager
def run_mock_server():
    port = _free_port()
    server = ThreadingHTTPServer(("127.0.0.1", port), MockForgePilotHandler)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.shutdown()
        server.server_close()


async def main():
    from motor.motor_asyncio import AsyncIOMotorClient
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    # Cleanup
    await db.services.delete_many({"id": "forgepilot"})
    await db.forgepilot_sessions.delete_many({})
    await db.chat_messages.delete_many({"session_id": {"$regex": "^TEST-"}})

    import forgepilot

    async def _dummy_key():
        return ""  # Simuliert "kein LLM-Key" → fallback Umformulierung

    forgepilot.init(db, _dummy_key)

    with run_mock_server() as base_url:
        # Register mock URL in services collection
        await db.services.update_one(
            {"id": "forgepilot"},
            {"$set": {"id": "forgepilot", "name": "ForgePilot", "url": base_url, "enabled": True}},
            upsert=True,
        )

        print("==> TEST 1: is_available()")
        avail = await forgepilot.is_available()
        assert avail is True, f"expected available, got {avail}"
        print("   OK: reachable")

        print("==> TEST 2: normal response flow")
        MockForgePilotHandler.next_response_mode = "normal"
        session = "TEST-" + uuid.uuid4().hex[:8]
        result = await forgepilot.query_forgepilot("Schreibe einen Python Crawler", session, "user-1")
        assert result["success"], f"expected success, got {result}"
        assert "crawler" in result["response"].lower(), f"unexpected: {result['response']}"
        assert result["is_complete"], "should be complete"
        assert not result["ask_user"], "should not ask user"
        assert "create_file" in result.get("tools_used", []), f"tool missing: {result.get('tools_used')}"
        pid = result["project_id"]
        print(f"   OK: response='{result['response'][:80]}...' complete=True tools={result['tools_used']}")

        print("==> TEST 3: session reuse -> same project")
        result2 = await forgepilot.query_forgepilot("Und jetzt die Tests", session, "user-1")
        assert result2["project_id"] == pid, f"expected same project, got {result2['project_id']} vs {pid}"
        print(f"   OK: reused project_id={pid}")

        print("==> TEST 4: ask_user flow")
        MockForgePilotHandler.next_response_mode = "ask_user"
        session_q = "TEST-" + uuid.uuid4().hex[:8]
        result = await forgepilot.query_forgepilot("Bau mir eine App", session_q, "user-1")
        assert result["success"], f"expected success, got {result}"
        assert result["ask_user"] is True, "should be ask_user"
        assert "Python oder JavaScript" in result["question"], f"bad question: {result['question']}"
        print(f"   OK: ask_user=True question='{result['question']}'")

        print("==> TEST 5: friendly_rephrase (ohne LLM-Key = Fallback)")
        rephrased = await forgepilot.friendly_rephrase(result, "Bau mir eine App")
        assert "rückfrage" in rephrased.lower() or "frage" in rephrased.lower(), f"bad rephrase: {rephrased}"
        assert "Python oder JavaScript" in rephrased, "question must be preserved"
        print(f"   OK: fallback rephrase='{rephrased[:120]}...'")

        print("==> TEST 6: still_running timeout (reduced for test)")
        MockForgePilotHandler.next_response_mode = "still_running"
        forgepilot.STREAM_TIMEOUT_SECONDS = 3
        session_r = "TEST-" + uuid.uuid4().hex[:8]
        result = await forgepilot.query_forgepilot("Mach langsam", session_r, "user-1")
        assert result["success"], f"expected success, got {result}"
        assert result["still_running"] is True, f"should be still_running: {result}"
        assert "Analysiere" in result["response"] or "Plane" in result["response"], f"no partial: {result['response']}"
        print(f"   OK: still_running=True partial='{result['response'][:80]}...'")

        print("\nAll tests passed")

        # Cleanup
        await db.services.delete_one({"id": "forgepilot"})
        await db.forgepilot_sessions.delete_many({"session_id": {"$regex": "^TEST-"}})
        await db.chat_messages.delete_many({"session_id": {"$regex": "^TEST-"}})


if __name__ == "__main__":
    asyncio.run(main())

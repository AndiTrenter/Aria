/**
 * Streaming client for the A.R.I.A. backend SSE endpoint.
 * Uses POST + fetch+ReadableStream because EventSource is GET-only.
 *
 * Usage:
 *   const ctrl = streamAriaChat(message, {
 *     sessionId: "...",
 *     onThought: (data) => {...},     // {id, label, status, detail?}
 *     onPanel:   ({kind, payload}) => {...}, // kind: "open"|"update"
 *     onResultChunk: (data) => {...}, // {delta, text}  — streamed live tokens
 *     onResult:  (data) => {...},     // {text, session_id}
 *     onError:   (err)  => {...},
 *     onDone:    ()     => {...},
 *   });
 *   // To abort: ctrl.abort();
 */
import { API } from "@/App";

export function streamAriaChat(message, opts = {}) {
  const ctrl = new AbortController();
  const sessionId = opts.sessionId || `aria_${Date.now()}`;

  (async () => {
    try {
      const token = (typeof localStorage !== "undefined" && localStorage.getItem("aria_token")) || null;
      const headers = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const resp = await fetch(`${API}/aria/stream`, {
        method: "POST",
        headers,
        credentials: "include",
        signal: ctrl.signal,
        body: JSON.stringify({ message, session_id: sessionId }),
      });

      if (!resp.ok || !resp.body) {
        const errText = await (async () => { try { return await resp.text(); } catch { return ""; } })();
        opts.onError?.(new Error(`stream HTTP ${resp.status}: ${errText.slice(0, 200)}`));
        opts.onDone?.();
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      const dispatch = (rawBlock) => {
        // Parse a single SSE event block
        let event = "message";
        let data = "";
        for (const line of rawBlock.split("\n")) {
          if (!line || line.startsWith(":")) continue;
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (!data) return;
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = { raw: data }; }
        if (event === "thought") opts.onThought?.(parsed);
        else if (event === "panel_open") opts.onPanel?.({ kind: "open", payload: parsed });
        else if (event === "panel_update") opts.onPanel?.({ kind: "update", payload: parsed });
        else if (event === "result_chunk") opts.onResultChunk?.(parsed);
        else if (event === "result") opts.onResult?.(parsed);
        else if (event === "error")  opts.onError?.(new Error(parsed.message || "stream error"));
        else if (event === "done")   { /* handled below */ }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // SSE separates events by blank lines (\n\n)
        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          if (block.trim()) dispatch(block);
        }
      }
      // flush any trailing block
      if (buf.trim()) dispatch(buf);
      opts.onDone?.();
    } catch (e) {
      if (e?.name === "AbortError") {
        opts.onDone?.();
        return;
      }
      opts.onError?.(e);
      opts.onDone?.();
    }
  })();

  return {
    abort: () => { try { ctrl.abort(); } catch {} },
  };
}

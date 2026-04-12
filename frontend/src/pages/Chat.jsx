import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useAuth, useTheme, API } from "@/App";
import axios from "axios";
import { ArrowLeft, PaperPlaneRight, Trash, Plus, Circle } from "@phosphor-icons/react";

const Chat = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [target, setTarget] = useState(null);
  const messagesEndRef = useRef(null);
  const isLcars = theme === "startrek";

  useEffect(() => {
    axios.get(`${API}/chat/sessions`).then(r => setSessions(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loadSession = async (sid) => {
    setSessionId(sid);
    try {
      const { data } = await axios.get(`${API}/chat/history/${sid}`);
      setMessages(data);
    } catch { setMessages([]); }
  };

  const startNewSession = () => {
    setSessionId(null);
    setMessages([]);
  };

  const deleteSession = async (sid) => {
    await axios.delete(`${API}/chat/sessions/${sid}`).catch(() => {});
    setSessions(prev => prev.filter(s => s.session_id !== sid));
    if (sessionId === sid) startNewSession();
  };

  const sendMessage = async () => {
    if (!input.trim() || sending) return;
    const text = input.trim();
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: text, timestamp: new Date().toISOString() }]);
    setSending(true);
    try {
      const { data } = await axios.post(`${API}/chat`, {
        message: text,
        target_service: target,
        session_id: sessionId,
      });
      setMessages(prev => [...prev, { role: "assistant", content: data.response, timestamp: new Date().toISOString(), routed_to: data.routed_to }]);
      if (data.session_id) setSessionId(data.session_id);
      setSessions(prev => {
        const exists = prev.find(s => s.session_id === data.session_id);
        if (exists) return prev;
        return [{ session_id: data.session_id, preview: text.substring(0, 80), timestamp: new Date().toISOString(), messages: 2 }, ...prev];
      });
    } catch (e) {
      setMessages(prev => [...prev, { role: "assistant", content: "Fehler: " + (e.response?.data?.detail || e.message), timestamp: new Date().toISOString() }]);
    } finally {
      setSending(false);
    }
  };

  const cardClass = isLcars ? "lcars-card" : "disney-card";

  return (
    <div className="flex flex-col h-[calc(100vh-50px)]">
      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sessions Sidebar */}
        <div className={`w-64 min-w-[200px] flex flex-col border-r ${isLcars ? "border-[var(--lcars-purple)]/30 bg-[#050510]" : "border-purple-800/30 bg-purple-950/30"}`}>
          <button onClick={startNewSession} className={`m-3 ${isLcars ? "lcars-button" : "disney-button"} flex items-center justify-center gap-2 text-sm`} data-testid="new-chat-button">
            <Plus size={14} /> NEUER CHAT
          </button>

          {/* Routing target */}
          <div className="px-3 mb-2">
            <select value={target || ""} onChange={(e) => setTarget(e.target.value || null)}
              className={`w-full text-xs ${isLcars ? "lcars-input" : "disney-input"}`} data-testid="chat-target-select">
              <option value="">Aria AI (Standard)</option>
              <option value="casedesk">CaseDesk AI</option>
              <option value="forgepilot">ForgePilot</option>
            </select>
          </div>

          <div className="flex-1 overflow-auto px-2 space-y-1">
            {sessions.map((s) => (
              <div key={s.session_id}
                onClick={() => loadSession(s.session_id)}
                className={`flex items-center gap-2 p-2 rounded cursor-pointer text-xs group transition-colors ${
                  sessionId === s.session_id
                    ? isLcars ? "bg-[var(--lcars-orange)]/10 text-[var(--lcars-orange)]" : "bg-purple-700/30 text-purple-200"
                    : isLcars ? "text-gray-500 hover:bg-gray-900" : "text-purple-400 hover:bg-purple-900/30"
                }`}
                data-testid={`chat-session-${s.session_id}`}
              >
                <div className="flex-1 truncate">{s.preview}</div>
                <button onClick={(e) => { e.stopPropagation(); deleteSession(s.session_id); }}
                  className="opacity-0 group-hover:opacity-100 text-red-400 p-1" data-testid={`delete-session-${s.session_id}`}>
                  <Trash size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 flex flex-col">
          <div className="flex-1 overflow-auto p-4 space-y-4" data-testid="chat-messages">
            {messages.length === 0 && (
              <div className="flex-1 flex items-center justify-center h-full">
                <div className="text-center">
                  <div className={`text-4xl mb-4 ${isLcars ? "text-[var(--lcars-orange)]" : "text-purple-400"}`}>
                    {isLcars ? ">" : ""}
                  </div>
                  <p className={`text-sm ${isLcars ? "text-gray-500 tracking-wider" : "text-purple-400"}`}>
                    {isLcars ? "BEREIT FÜR KOMMUNIKATION" : "Starte eine Konversation..."}
                  </p>
                  <p className={`text-xs mt-2 ${isLcars ? "text-gray-600" : "text-purple-500"}`}>
                    Aria nutzt automatisch Wetter, System-Health, Docker und Home Assistant Daten für ihre Antworten.
                  </p>
                </div>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`} data-testid={`chat-message-${i}`}>
                <div className={`max-w-[75%] rounded-xl p-3 text-sm ${
                  msg.role === "user"
                    ? isLcars ? "bg-[var(--lcars-orange)]/15 border border-[var(--lcars-orange)]/30 text-[var(--lcars-orange)]" : "bg-purple-700/50 text-purple-100"
                    : isLcars ? "bg-[#0a0a14] border border-[var(--lcars-purple)]/30 text-gray-300" : "bg-purple-900/30 text-purple-200"
                }`} style={{ textTransform: "none", letterSpacing: "normal" }}>
                  {msg.routed_to && (
                    <div className={`text-[10px] mb-1 flex items-center gap-1 ${isLcars ? "text-[var(--lcars-mauve)]" : "text-purple-400"}`}>
                      <Circle size={6} weight="fill" className={msg.routed_to.includes("live-data") ? "text-cyan-400" : msg.routed_to === "home-assistant" ? "text-green-400" : "text-green-400"} />
                      {msg.routed_to === "casedesk" ? "CaseDesk AI" 
                        : msg.routed_to === "forgepilot" ? "ForgePilot" 
                        : msg.routed_to === "home-assistant" ? "Home Assistant"
                        : msg.routed_to.includes("live-data") ? "Aria AI + Live-Daten" 
                        : "Aria AI"}
                    </div>
                  )}
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className={`rounded-xl p-3 text-sm ${isLcars ? "bg-[#0a0a14] border border-[var(--lcars-purple)]/30" : "bg-purple-900/30"}`}>
                  <div className={`flex gap-1 ${isLcars ? "text-[var(--lcars-orange)]" : "text-purple-400"}`}>
                    <span className="animate-pulse">.</span><span className="animate-pulse" style={{ animationDelay: "0.2s" }}>.</span><span className="animate-pulse" style={{ animationDelay: "0.4s" }}>.</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className={`p-3 border-t ${isLcars ? "border-[var(--lcars-purple)]/30" : "border-purple-800/30"}`}>
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
                placeholder={isLcars ? "NACHRICHT EINGEBEN..." : "Nachricht eingeben..."}
                className={`flex-1 ${isLcars ? "lcars-input" : "disney-input"}`}
                style={{ textTransform: "none" }}
                data-testid="chat-input"
              />
              <button onClick={sendMessage} disabled={sending || !input.trim()}
                className={`${isLcars ? "lcars-button" : "disney-button"} px-4`}
                data-testid="chat-send-button">
                <PaperPlaneRight size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Chat;

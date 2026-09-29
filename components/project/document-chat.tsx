"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  FileText,
  LoaderCircle,
  MessageSquareText,
  Send,
  List,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { api, specLabel } from "@/lib/api-client";
export default function DocumentChat({
  documents,
  pid,
  legacy,
  onSource,
}: {
  documents: any[];
  pid: string;
  legacy: any[];
  onSource: (s: any) => void;
}) {
  const [docId, setDocId] = useState(documents[0]?.id || ""),
    [messages, setMessages] = useState<any[]>([]),
    [question, setQuestion] = useState(""),
    [pending, setPending] = useState(""),
    [asking, setAsking] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null),
    shouldScroll = useRef(false),
    active = useRef(docId);
  const doc = documents.find((d) => d.id === docId);
  useEffect(() => {
    active.current = docId;
    shouldScroll.current = false;
    setMessages([]);
    setLoading(false);
    setError("");
    setQuestion("");
    if (docId === "legacy") {
      setMessages(legacy);
      return;
    }
    if (!docId) return;
    setLoading(true);
    api(`documents/${docId}/messages`)
      .then((d) => {
        if (active.current === docId) setMessages(d.messages);
      })
      .catch((e) => {
        if (active.current === docId) setError(e.message);
      })
      .finally(() => {
        if (active.current === docId) setLoading(false);
      });
  }, [docId]);
  useEffect(() => {
    if (shouldScroll.current)
      end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending, asking]);
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || asking) return;
    const q = question.trim(),
      target = docId;
    shouldScroll.current = true;
    setPending(q);
    setQuestion("");
    setAsking(true);
    setError("");
    try {
      await api(`projects/${pid}/chat`, "POST", { question: q, docId: target });
      const d = await api(`documents/${target}/messages`);
      if (active.current === target) setMessages(d.messages);
    } catch (e) {
      setError((e as Error).message);
      setQuestion(q);
    } finally {
      setPending("");
      setAsking(false);
    }
  }
  return (
    <div className="document-chat">
      <div className="chat-spec-select">
        <div>
          <h1>Chat with a specification</h1>
        </div>
        <Select value={docId} onValueChange={setDocId} disabled={asking}>
          <SelectTrigger aria-label="Chat specification">
            <SelectValue placeholder="Select specification" />
          </SelectTrigger>
          <SelectContent>
            {documents.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {specLabel(d)}
              </SelectItem>
            ))}
            {legacy.length > 0 && (
              <SelectItem value="legacy">
                Previous project conversation (read only)
              </SelectItem>
            )}
          </SelectContent>
        </Select>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="button secondary chat-history-trigger"
              aria-label="Jump to a question"
            >
              <List size={19} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="chat-question-menu">
            {messages.filter((m) => m.role === "user").length ? (
              messages
                .filter((m) => m.role === "user")
                .map((m, i) => (
                  <DropdownMenuItem
                    key={m.id}
                    onSelect={() => {
                      shouldScroll.current = false;
                      requestAnimationFrame(() =>
                        document
                          .getElementById(`chat-message-${m.id}`)
                          ?.scrollIntoView({
                            behavior: "smooth",
                            block: "start",
                          }),
                      );
                    }}
                  >
                    {i + 1}. {m.content}
                  </DropdownMenuItem>
                ))
            ) : (
              <DropdownMenuItem disabled>No questions yet</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="chat-layout">
        <div
          className="chat-body"
          role="log"
          aria-label="Specification conversation"
          aria-live="polite"
        >
          {loading ? (
            <p className="row">
              <LoaderCircle className="spin" />
              Loading conversation…
            </p>
          ) : !messages.length && !pending ? (
            <div className="chat-welcome">
              <span className="empty-icon">
                <MessageSquareText size={29} />
              </span>
              <h2>One specification. A focused conversation.</h2>
              <p>{doc ? specLabel(doc) : "Choose a specification to begin."}</p>
              <div className="question-chips">
                {[
                  "Which shop drawings must be submitted?",
                  "What product data is required?",
                  "What testing and certifications are required?",
                ].map((q) => (
                  <button key={q} onClick={() => setQuestion(q)}>
                    {q}
                    <ArrowUpRight size={15} />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => (
              <article
                className={"chat-message " + m.role}
                key={m.id}
                id={`chat-message-${m.id}`}
              >
                <span className="message-label">
                  {m.role === "user" ? "You" : "BuildERP"}
                </span>
                {m.role === "assistant" ? (
                  <div className="chat-markdown">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      skipHtml
                      components={{ img: () => null }}
                    >
                      {m.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p>{m.content}</p>
                )}
                {JSON.parse(m.citations || "[]").length > 0 && (
                  <div className="citation-list">
                    {JSON.parse(m.citations).map((c: any) => (
                      <button key={c.label} onClick={() => onSource(c)}>
                        <FileText size={14} />
                        {c.label} · p. {c.page}
                      </button>
                    ))}
                  </div>
                )}
              </article>
            ))
          )}
          {pending && (
            <article className="chat-message user">
              <span className="message-label">You</span>
              <p>{pending}</p>
            </article>
          )}
          {asking && (
            <div className="chat-thinking">
              <LoaderCircle className="spin" size={18} />
              BuildERP is checking this specification…
            </div>
          )}
          <div ref={end} className="chat-end" />
        </div>
        {error && (
          <div role="alert" className="error-box">
            {error}
          </div>
        )}
        {doc && !doc.indexed && (
          <div className="warning-box">
            This specification is being prepared. Chat will become available
            automatically.
          </div>
        )}
        <div className="chat-composer-dock">
          <form className="chat-compose" onSubmit={send}>
            <textarea
              rows={2}
              aria-label="Question"
              placeholder="Ask about the selected specification…"
              value={question}
              maxLength={2000}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (doc?.indexed && !asking && question.trim())
                    e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <button
              className="button orange"
              aria-label="Send question"
              disabled={asking || !question.trim() || !doc?.indexed}
            >
              <Send size={19} />
            </button>
          </form>
          <small className="chat-footnote">
            Enter to send · Shift + Enter for a new line · Verify cited source
            text.
          </small>
        </div>
      </div>
    </div>
  );
}

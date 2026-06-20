import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  getConversations,
  getConversation,
  updateConversationMode,
  updateConversationStatus,
  sendOperatorMessage,
  BOOKING_STATUSES,
  type BookingStatus,
  type ConversationRow,
} from "@/lib/conversations.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Send, Phone, MapPin, Calendar, Clock, Users, MessageSquare, Bot, UserRound, Inbox, Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "DashCook — Operator Dashboard" },
      { name: "description", content: "Live customer support inbox for DashCook bookings." },
    ],
  }),
  component: OperatorDashboard,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="p-8 space-y-3">
        <h1 className="text-xl font-semibold">Dashboard failed to load</h1>
        <pre className="rounded bg-muted p-3 text-sm whitespace-pre-wrap">{error.message}</pre>
        <Button onClick={() => { reset(); router.invalidate(); }}>Retry</Button>
      </div>
    );
  },
  notFoundComponent: () => <div className="p-8">Not found</div>,
});

type ParsedMessage = { role: "customer" | "bot" | "operator" | "system"; text: string };

function parseHistory(history: string | null): ParsedMessage[] {
  if (!history) return [];
  const lines = history.split(/\r?\n/);
  const msgs: ParsedMessage[] = [];
  const speakerRe = /^\s*(Customer|User|Client|Bot|Assistant|Operator|Human|System)\s*[:\-]\s*(.*)$/i;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const m = line.match(speakerRe);
    if (m) {
      const speaker = m[1].toLowerCase();
      let role: ParsedMessage["role"] = "system";
      if (speaker === "customer" || speaker === "user" || speaker === "client") role = "customer";
      else if (speaker === "bot" || speaker === "assistant") role = "bot";
      else if (speaker === "operator" || speaker === "human") role = "operator";
      msgs.push({ role, text: m[2] });
    } else if (msgs.length > 0) {
      msgs[msgs.length - 1].text += "\n" + line;
    } else {
      msgs.push({ role: "system", text: line });
    }
  }
  return msgs;
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function OperatorDashboard() {
  const qc = useQueryClient();
  const listFn = useServerFn(getConversations);
  const detailFn = useServerFn(getConversation);
  const updateModeFn = useServerFn(updateConversationMode);
  const sendFn = useServerFn(sendOperatorMessage);

  const [selectedId, setSelectedId] = useState<string | number | null>(null);
  const [draft, setDraft] = useState("");

  const listQuery = useQuery({
    queryKey: ["conversations"],
    queryFn: () => listFn(),
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
  });

  // Auto-select first conversation
  useEffect(() => {
    if (selectedId === null && listQuery.data?.rows?.length) {
      setSelectedId(listQuery.data.rows[0].id);
    }
  }, [listQuery.data, selectedId]);

  const detailQuery = useQuery({
    queryKey: ["conversation", selectedId],
    queryFn: () => detailFn({ data: { id: selectedId! } }),
    enabled: selectedId !== null,
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
  });

  const selected = detailQuery.data?.row ?? null;
  const messages = useMemo(() => parseHistory(selected?.history ?? null), [selected?.history]);

  const sendMutation = useMutation({
    mutationFn: async (text: string) => {
      if (!selected) throw new Error("No conversation selected");
      const res = await sendFn({
        data: {
          conversation_id: selected.id,
          phone: selected.phone,
          message: text,
        },
      });
      if (!res.ok) throw new Error(res.error ?? "Failed to send");
      return res;
    },
    onSuccess: () => {
      setDraft("");
      toast.success("Message sent to operator webhook");
      qc.invalidateQueries({ queryKey: ["conversation", selectedId] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Send failed");
    },
  });

  const modeMutation = useMutation({
    mutationFn: async (mode: "bot" | "human") => {
      if (!selected) throw new Error("No conversation selected");
      const res = await updateModeFn({ data: { id: selected.id, mode } });
      if (!res.ok) throw new Error(res.error ?? "Failed to update mode");
      return mode;
    },
    onSuccess: (mode) => {
      toast.success(`Mode set to ${mode}`);
      qc.invalidateQueries({ queryKey: ["conversation", selectedId] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Mode change failed");
    },
  });

  const rows = listQuery.data?.rows ?? [];
  const listError = listQuery.data?.error;

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      {/* LEFT — Queue */}
      <aside className="flex w-80 shrink-0 flex-col border-r">
        <header className="flex items-center gap-2 border-b px-4 py-3">
          <Inbox className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-sm font-semibold leading-tight">DashCook Inbox</h1>
            <p className="text-xs text-muted-foreground">
              {listQuery.isFetching ? "Refreshing…" : `${rows.length} conversations`}
            </p>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto">
          {listError && (
            <div className="m-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
              {listError}
            </div>
          )}
          {!listError && rows.length === 0 && !listQuery.isLoading && (
            <div className="m-3 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
              No conversations yet.
            </div>
          )}
          <ul>
            {rows.map((c) => (
              <ConversationListItem
                key={String(c.id)}
                row={c}
                active={selectedId === c.id}
                onClick={() => setSelectedId(c.id)}
              />
            ))}
          </ul>
        </div>
      </aside>

      {/* CENTER — Conversation */}
      <section className="flex min-w-0 flex-1 flex-col">
        {!selected ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Select a conversation to view its history.
          </div>
        ) : (
          <>
            <header className="flex items-center justify-between border-b px-6 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span className="truncate">{selected.phone ?? "Unknown"}</span>
                  <ModeBadge mode={selected.mode} />
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Last activity {formatDateTime(selected.last_message_at)}
                </p>
              </div>
              <ModeToggle
                mode={(selected.mode === "human" ? "human" : "bot") as "bot" | "human"}
                pending={modeMutation.isPending}
                onChange={(m) => modeMutation.mutate(m)}
              />
            </header>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {messages.length === 0 ? (
                <div className="text-sm text-muted-foreground">No messages in history yet.</div>
              ) : (
                <ul className="space-y-3">
                  {messages.map((m, i) => (
                    <MessageBubble key={i} msg={m} />
                  ))}
                </ul>
              )}
            </div>

            <Composer
              value={draft}
              onChange={setDraft}
              onSend={() => sendMutation.mutate(draft)}
              sending={sendMutation.isPending}
            />
          </>
        )}
      </section>

      {/* RIGHT — Booking details */}
      <aside className="hidden w-80 shrink-0 flex-col border-l lg:flex">
        <header className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Booking details</h2>
          <p className="text-xs text-muted-foreground">From the selected conversation</p>
        </header>
        <div className="flex-1 overflow-y-auto p-4">
          {!selected ? (
            <p className="text-sm text-muted-foreground">No conversation selected.</p>
          ) : (
            <dl className="space-y-3 text-sm">
              <DetailRow icon={<MapPin className="h-4 w-4" />} label="Area" value={selected.area} />
              <DetailRow icon={<Calendar className="h-4 w-4" />} label="Date" value={selected.booking_date} />
              <DetailRow icon={<Clock className="h-4 w-4" />} label="Time" value={selected.booking_time} />
              <DetailRow icon={<Users className="h-4 w-4" />} label="People" value={selected.people != null ? String(selected.people) : null} />
              <DetailRow icon={<MessageSquare className="h-4 w-4" />} label="Status" value={selected.status} />
              <DetailRow icon={<Bot className="h-4 w-4" />} label="Mode" value={selected.mode} />
              <DetailRow icon={<Phone className="h-4 w-4" />} label="Phone" value={selected.phone} />
            </dl>
          )}
        </div>
      </aside>
    </div>
  );
}

function ConversationListItem({
  row,
  active,
  onClick,
}: {
  row: ConversationRow;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className={cn(
          "flex w-full flex-col gap-1 border-b px-4 py-3 text-left transition-colors hover:bg-muted/50",
          active && "bg-muted",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium">{row.phone ?? "Unknown"}</span>
          <ModeBadge mode={row.mode} small />
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="h-3 w-3" />
          <span className="truncate">{row.area ?? "—"}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {row.booking_date ?? "—"}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {row.booking_time ?? "—"}
          </span>
        </div>
        <div className="text-[11px] text-muted-foreground">
          Updated {formatDateTime(row.last_message_at)}
        </div>
      </button>
    </li>
  );
}

function ModeBadge({ mode, small }: { mode: string | null; small?: boolean }) {
  const isHuman = mode === "human";
  return (
    <Badge
      variant={isHuman ? "default" : "secondary"}
      className={cn(small && "px-1.5 py-0 text-[10px]")}
    >
      {isHuman ? <UserRound className="mr-1 h-3 w-3" /> : <Bot className="mr-1 h-3 w-3" />}
      {mode ?? "—"}
    </Badge>
  );
}

function ModeToggle({
  mode,
  pending,
  onChange,
}: {
  mode: "bot" | "human";
  pending: boolean;
  onChange: (m: "bot" | "human") => void;
}) {
  const isHuman = mode === "human";
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="mode-toggle" className="flex items-center gap-1 text-xs text-muted-foreground">
        <Bot className="h-3.5 w-3.5" />
        Bot
      </Label>
      <Switch
        id="mode-toggle"
        checked={isHuman}
        disabled={pending}
        onCheckedChange={(v) => onChange(v ? "human" : "bot")}
      />
      <Label htmlFor="mode-toggle" className="flex items-center gap-1 text-xs text-muted-foreground">
        <UserRound className="h-3.5 w-3.5" />
        Human
      </Label>
    </div>
  );
}

function MessageBubble({ msg }: { msg: ParsedMessage }) {
  const isCustomer = msg.role === "customer";
  const isBot = msg.role === "bot";
  const isOperator = msg.role === "operator";
  const isSystem = msg.role === "system";

  if (isSystem) {
    return (
      <li className="text-center text-xs text-muted-foreground">{msg.text}</li>
    );
  }

  return (
    <li className={cn("flex", isCustomer ? "justify-start" : "justify-end")}>
      <div className="flex max-w-[75%] flex-col gap-1">
        <span className={cn("text-[11px] text-muted-foreground", isCustomer ? "text-left" : "text-right")}>
          {isCustomer ? "Customer" : isBot ? "Bot" : "Operator"}
        </span>
        <div
          className={cn(
            "rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap",
            isCustomer && "rounded-tl-sm bg-muted text-foreground",
            isBot && "rounded-tr-sm border bg-background text-foreground",
            isOperator && "rounded-tr-sm bg-primary text-primary-foreground",
          )}
        >
          {msg.text}
        </div>
      </div>
    </li>
  );
}

function Composer({
  value,
  onChange,
  onSend,
  sending,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  sending: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (value.trim() && !sending) onSend();
    }
  }

  return (
    <div className="border-t bg-background px-6 py-4">
      <div className="flex items-end gap-3">
        <Textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Type a message to send via WhatsApp (handled by Make.com webhook)…  ⌘/Ctrl+Enter to send"
          rows={3}
          className="resize-none"
        />
        <Button
          onClick={onSend}
          disabled={sending || value.trim().length === 0}
          className="h-10 shrink-0"
        >
          <Send className="mr-2 h-4 w-4" />
          {sending ? "Sending…" : "Send"}
        </Button>
      </div>
    </div>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b pb-2 last:border-0">
      <dt className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        {label}
      </dt>
      <dd className="text-right text-sm font-medium">{value ?? "—"}</dd>
    </div>
  );
}

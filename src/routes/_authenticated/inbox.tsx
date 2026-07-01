import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  getConversations,
  getConversation,
  updateConversationMode,
  updateConversationFields,
  updateOrderCookAssigned,
  saveBookingStatus,
  sendOperatorMessage,
  parseStatuses,
  BOOKING_STATUSES,
  type BookingStatus,
  type ConversationRow,
} from "@/lib/conversations.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Send, Phone, MapPin, Calendar, Clock, Users, MessageSquare, Bot, UserRound, Inbox, Loader2, Check, ExternalLink, ChevronDown, ChefHat, Repeat } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/inbox")({
  validateSearch: (search: Record<string, unknown>) => ({
    id:
      typeof search.id === "string" || typeof search.id === "number"
        ? (search.id as string | number)
        : undefined,
  }),
  head: () => ({
    meta: [
      { title: "DashCook — Inbox" },
      { name: "description", content: "Live customer support inbox for DashCook bookings." },
    ],
  }),
  component: OperatorDashboard,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="p-8 space-y-3">
        <h1 className="text-xl font-semibold">Dashboard failed to load</h1>
        <p className="text-sm text-muted-foreground">Something went wrong. Please try again.</p>
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
  const saveStatusFn = useServerFn(saveBookingStatus);
  const sendFn = useServerFn(sendOperatorMessage);
  const updateFieldsFn = useServerFn(updateConversationFields);
  const updateCookFn = useServerFn(updateOrderCookAssigned);

  const search = Route.useSearch();
  const [selectedId, setSelectedId] = useState<string | number | null>(search.id ?? null);
  const [draft, setDraft] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | BookingStatus>("all");
  const [statusSaveState, setStatusSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  // Pending-cancel UX: when operator picks "Cancelled" in the dropdown, we hold off
  // saving until they pick a reason and click Save.
  const [pendingCancel, setPendingCancel] = useState(false);
  const [reasonChoice, setReasonChoice] = useState<string>("");
  const [otherText, setOtherText] = useState<string>("");

  // Sync URL ?id= -> selection
  useEffect(() => {
    if (search.id !== undefined && search.id !== selectedId) {
      setSelectedId(search.id);
    }
  }, [search.id]);

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

  // Auto-scroll chat container to newest message.
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const handleChatScroll = () => {
    const el = chatScrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };
  // Force jump to bottom whenever a different conversation is opened.
  useEffect(() => {
    atBottomRef.current = true;
    const el = chatScrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      const c = chatScrollRef.current;
      if (c) c.scrollTop = c.scrollHeight;
    });
  }, [selectedId]);
  // Stick to bottom on new messages unless the user scrolled up.
  useEffect(() => {
    if (!atBottomRef.current) return;
    const el = chatScrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      const c = chatScrollRef.current;
      if (c) c.scrollTo({ top: c.scrollHeight, behavior: "smooth" });
    });
  }, [messages]);

  // Preload cancellation reason whenever the selected conversation (or its server-side
  // reason / status) changes. Also resets pending-cancel UI when a different
  // conversation is opened.
  const lastSyncedRef = useRef<{ id: string | number | null; reason: string | null }>({
    id: null,
    reason: null,
  });
  useEffect(() => {
    if (!selected) {
      setPendingCancel(false);
      setReasonChoice("");
      setOtherText("");
      lastSyncedRef.current = { id: null, reason: null };
      return;
    }
    const serverReason = (selected.cancellation_reason ?? null) as string | null;
    const sameRow = lastSyncedRef.current.id === selected.id;
    if (!sameRow || lastSyncedRef.current.reason !== serverReason) {
      lastSyncedRef.current = { id: selected.id, reason: serverReason };
      if (serverReason && CANCELLATION_REASONS.includes(serverReason)) {
        setReasonChoice(serverReason);
        setOtherText("");
      } else if (serverReason) {
        setReasonChoice("Other");
        setOtherText(serverReason);
      } else {
        setReasonChoice("");
        setOtherText("");
      }
    }
    if (!sameRow) {
      setPendingCancel(false);
    }
  }, [selected]);


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

  const statusMutation = useMutation({
    mutationFn: async (args: { statuses: BookingStatus[]; cancellation_reason?: string | null }) => {
      if (!selected) throw new Error("No conversation selected");
      setStatusSaveState("saving");
      const res = await saveStatusFn({
        data: {
          id: selected.id,
          statuses: args.statuses,
          cancellation_reason: args.cancellation_reason ?? null,
        },
      });
      if (!res.ok) throw new Error(res.error ?? "Failed to update status");
      return args.statuses;
    },
    onSuccess: (statuses) => {
      setStatusSaveState("saved");
      const labels = statuses.map((s) => STATUS_META[s].label).join(", ");
      toast.success(`Status set to ${labels}`);
      qc.invalidateQueries({ queryKey: ["conversation", selectedId] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      setTimeout(() => setStatusSaveState("idle"), 1500);
    },
    onError: (err) => {
      setStatusSaveState("error");
      toast.error(err instanceof Error ? err.message : "Status change failed");
      qc.invalidateQueries({ queryKey: ["conversation", selectedId] });
      setTimeout(() => setStatusSaveState("idle"), 2000);
    },
  });

  const allRows = listQuery.data?.rows ?? [];
  const rows =
    statusFilter === "all"
      ? allRows
      : allRows.filter((r) => parseStatuses(r.status).includes(statusFilter));
  const listError = listQuery.data?.error;

  // Current server-side selected statuses
  const selectedStatuses: BookingStatus[] = useMemo(
    () => parseStatuses(selected?.status ?? null),
    [selected?.status],
  );
  const showCancellationBar = pendingCancel || selectedStatuses.includes("cancelled");

  useTabNotifications(allRows, selectedId);

  return (
    <div className="flex h-[calc(100vh-3rem)] w-full overflow-hidden bg-background text-foreground">
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
        <div className="border-b p-2">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as "all" | BookingStatus)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {BOOKING_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_META[s].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Last activity {formatDateTime(selected.last_message_at)}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <StatusMultiSelect
                  statuses={
                    pendingCancel
                      ? Array.from(new Set([...selectedStatuses, "cancelled"])) as BookingStatus[]
                      : selectedStatuses
                  }
                  saveState={statusSaveState}
                  onChange={(next) => {
                    const wasCancelled = selectedStatuses.includes("cancelled");
                    const nowCancelled = next.includes("cancelled");
                    if (nowCancelled && !wasCancelled) {
                      // Defer save until reason chosen
                      setPendingCancel(true);
                      return;
                    }
                    setPendingCancel(false);
                    if (next.length === 0) {
                      toast.error("Select at least one status");
                      return;
                    }
                    statusMutation.mutate({ statuses: next });
                  }}
                />
                <ModeToggle
                  mode={(selected.mode === "human" ? "human" : "bot") as "bot" | "human"}
                  pending={modeMutation.isPending}
                  onChange={(m) => modeMutation.mutate(m)}
                />
              </div>
            </header>

            {showCancellationBar && (
              <CancellationReasonBar
                reasonChoice={reasonChoice}
                otherText={otherText}
                onChoiceChange={setReasonChoice}
                onOtherChange={setOtherText}
                saving={statusSaveState === "saving"}
                onSave={() => {
                  const finalReason =
                    reasonChoice === "Other" ? otherText.trim() : reasonChoice.trim();
                  if (!finalReason) {
                    toast.error("Please select a cancellation reason");
                    return;
                  }
                  const nextStatuses = Array.from(
                    new Set<BookingStatus>([...selectedStatuses, "cancelled"]),
                  );
                  statusMutation.mutate(
                    { statuses: nextStatuses, cancellation_reason: finalReason },
                    { onSuccess: () => setPendingCancel(false) },
                  );
                }}
                onCancel={
                  pendingCancel
                    ? () => {
                        setPendingCancel(false);
                        const serverReason = (selected.cancellation_reason ?? null) as string | null;
                        if (serverReason && CANCELLATION_REASONS.includes(serverReason)) {
                          setReasonChoice(serverReason);
                          setOtherText("");
                        } else if (serverReason) {
                          setReasonChoice("Other");
                          setOtherText(serverReason);
                        } else {
                          setReasonChoice("");
                          setOtherText("");
                        }
                      }
                    : null
                }
              />
            )}

            <div ref={chatScrollRef} onScroll={handleChatScroll} className="flex-1 overflow-y-auto px-6 py-4">
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
            <BookingDetailsPanel
              key={String(selected.id)}
              row={selected}
              onSaveFields={(fields) =>
                updateFieldsFn({ data: { id: selected.id, fields } }).then((res) => {
                  if (!res.ok) throw new Error(res.error ?? "Save failed");
                  qc.invalidateQueries({ queryKey: ["conversation", selectedId] });
                  qc.invalidateQueries({ queryKey: ["conversations"] });
                })
              }
              onSaveCook={(cook_assigned) =>
                updateCookFn({
                  data: { conversation_id: selected.id, cook_assigned },
                }).then((res) => {
                  if (!res.ok) throw new Error(res.error ?? "Save failed");
                  qc.invalidateQueries({ queryKey: ["conversation", selectedId] });
                })
              }
            />
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
        <div className="flex flex-wrap gap-1">
          <StatusBadges status={row.status} small />
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

function CustomerLocation({
  lat,
  lng,
}: {
  lat: number | string | null | undefined;
  lng: number | string | null | undefined;
}) {
  if (lat == null || lng == null) return null;
  const latNum = typeof lat === "string" ? parseFloat(lat) : lat;
  const lngNum = typeof lng === "string" ? parseFloat(lng) : lng;
  if (Number.isNaN(latNum) || Number.isNaN(lngNum)) return null;
  const url = `https://maps.google.com/?q=${latNum},${lngNum}`;
  return (
    <div className="space-y-2 border-t pt-3">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        <MapPin className="h-4 w-4 text-primary" />
        Customer Location
      </h3>
      <div className="space-y-1 text-sm">
        <div className="flex justify-between gap-3">
          <span className="text-xs text-muted-foreground">Latitude</span>
          <span className="font-medium">{latNum}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-xs text-muted-foreground">Longitude</span>
          <span className="font-medium">{lngNum}</span>
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        asChild
      >
        <a href={url} target="_blank" rel="noreferrer noopener">
          <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
          Open in Google Maps
        </a>
      </Button>
    </div>
  );
}

const CANCELLATION_REASONS: readonly string[] = [
  "Customer no longer required the service",
  "Customer unreachable",
  "No cook available",
  "Cook unavailable",
  "Outside service area",
  "Requested time unavailable",
  "Duplicate booking",
  "Fake / spam enquiry",
  "Other",
];

function CancellationReasonBar({
  reasonChoice,
  otherText,
  onChoiceChange,
  onOtherChange,
  onSave,
  onCancel,
  saving,
}: {
  reasonChoice: string;
  otherText: string;
  onChoiceChange: (v: string) => void;
  onOtherChange: (v: string) => void;
  onSave: () => void;
  onCancel: (() => void) | null;
  saving: boolean;
}) {
  const isOther = reasonChoice === "Other";
  const canSave = isOther ? otherText.trim().length > 0 : reasonChoice.trim().length > 0;
  return (
    <div className="border-b bg-muted/30 px-6 py-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-[260px] flex-1 items-center gap-2">
          <Label className="shrink-0 text-xs text-muted-foreground">
            Cancellation Reason <span className="text-destructive">*</span>
          </Label>
          <Select value={reasonChoice} onValueChange={onChoiceChange} disabled={saving}>
            <SelectTrigger className="h-8 flex-1 text-xs">
              <SelectValue placeholder="Select a reason…" />
            </SelectTrigger>
            <SelectContent>
              {CANCELLATION_REASONS.map((r) => (
                <SelectItem key={r} value={r} className="text-xs">
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          {onCancel && (
            <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
          )}
          <Button size="sm" onClick={onSave} disabled={!canSave || saving}>
            {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Save
          </Button>
        </div>
      </div>
      {isOther && (
        <div className="mt-2 space-y-1">
          <Label className="text-xs text-muted-foreground">Please specify</Label>
          <Textarea
            value={otherText}
            onChange={(e) => onOtherChange(e.target.value)}
            placeholder="Describe the cancellation reason…"
            rows={2}
            disabled={saving}
            className="resize-none text-sm"
          />
        </div>
      )}
    </div>
  );
}


const STATUS_META: Record<
  BookingStatus,
  { label: string; badgeClass: string; dotClass: string }
> = {
  new: {
    label: "New",
    badgeClass: "bg-muted text-muted-foreground border-transparent",
    dotClass: "bg-muted-foreground",
  },
  booking_pending: {
    label: "Booking Pending",
    badgeClass: "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/30",
    dotClass: "bg-orange-500",
  },
  cooking_confirmed: {
    label: "Cooking Confirmed",
    badgeClass: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30",
    dotClass: "bg-blue-500",
  },
  completed: {
    label: "Completed",
    badgeClass: "bg-green-100 text-green-800 border-green-200 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/30",
    dotClass: "bg-green-500",
  },
  cancelled: {
    label: "Cancelled",
    badgeClass: "bg-red-100 text-red-800 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30",
    dotClass: "bg-red-500",
  },
  repeat_booking: {
    label: "Repeat Booking",
    badgeClass: "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-500/15 dark:text-purple-300 dark:border-purple-500/30",
    dotClass: "bg-purple-500",
  },
};

function isBookingStatus(v: string | null | undefined): v is BookingStatus {
  return !!v && (BOOKING_STATUSES as readonly string[]).includes(v);
}

function StatusBadge({ status, small }: { status: BookingStatus | string | null; small?: boolean }) {
  if (!isBookingStatus(status)) {
    return (
      <Badge variant="outline" className={cn(small && "px-1.5 py-0 text-[10px]")}>
        {status ?? "—"}
      </Badge>
    );
  }
  const meta = STATUS_META[status];
  return (
    <Badge className={cn("border", meta.badgeClass, small && "px-1.5 py-0 text-[10px]")}>
      <span className={cn("mr-1.5 inline-block h-1.5 w-1.5 rounded-full", meta.dotClass)} />
      {meta.label}
    </Badge>
  );
}

function StatusBadges({ status, small }: { status: string | null; small?: boolean }) {
  const list = parseStatuses(status);
  if (list.length === 0) {
    return (
      <Badge variant="outline" className={cn(small && "px-1.5 py-0 text-[10px]")}>
        {status ?? "—"}
      </Badge>
    );
  }
  return (
    <>
      {list.map((s) => (
        <StatusBadge key={s} status={s} small={small} />
      ))}
    </>
  );
}

function StatusMultiSelect({
  statuses,
  saveState,
  onChange,
}: {
  statuses: BookingStatus[];
  saveState: "idle" | "saving" | "saved" | "error";
  onChange: (s: BookingStatus[]) => void;
}) {
  const summary =
    statuses.length === 0
      ? "Select status"
      : statuses.length === 1
        ? STATUS_META[statuses[0]].label
        : `${statuses.length} selected`;
  const set = new Set(statuses);
  return (
    <div className="flex items-center gap-2">
      <Label className="text-xs text-muted-foreground">Status</Label>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={saveState === "saving"}>
          <Button variant="outline" size="sm" className="h-8 w-[220px] justify-between text-xs font-normal">
            <span className="flex items-center gap-1.5 truncate">
              {statuses.length > 0 && (
                <span className={cn("inline-block h-2 w-2 rounded-full", STATUS_META[statuses[0]].dotClass)} />
              )}
              <span className="truncate">{summary}</span>
            </span>
            <ChevronDown className="h-3.5 w-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="text-xs">Statuses</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {BOOKING_STATUSES.map((s) => (
            <DropdownMenuCheckboxItem
              key={s}
              checked={set.has(s)}
              onCheckedChange={(checked) => {
                const next = new Set(statuses);
                if (checked) next.add(s);
                else next.delete(s);
                const ordered = (BOOKING_STATUSES as readonly BookingStatus[]).filter((x) => next.has(x));
                onChange(ordered);
              }}
              onSelect={(e) => e.preventDefault()}
            >
              <span className="flex items-center gap-2 text-xs">
                <span className={cn("inline-block h-2 w-2 rounded-full", STATUS_META[s].dotClass)} />
                {STATUS_META[s].label}
              </span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="w-4 text-muted-foreground">
        {saveState === "saving" && <Loader2 className="h-4 w-4 animate-spin" />}
        {saveState === "saved" && <Check className="h-4 w-4 text-green-600" />}
      </span>
    </div>
  );
}

// ---------- Booking details panel (editable) ----------

function BookingDetailsPanel({
  row,
  onSaveFields,
  onSaveCook,
}: {
  row: ConversationRow;
  onSaveFields: (fields: Record<string, string | number | null>) => Promise<void>;
  onSaveCook: (cook_assigned: string | null) => Promise<void>;
}) {
  const [area, setArea] = useState(row.area ?? "");
  const [date, setDate] = useState(row.booking_date ?? "");
  const [time, setTime] = useState(row.booking_time ?? "");
  const [people, setPeople] = useState(row.people != null ? String(row.people) : "");
  const [cook, setCook] = useState(row.cook_assigned ?? "");
  const [subEnq, setSubEnq] = useState(row.subscription_enquiry ?? "");

  // Sync when incoming row changes (polling)
  useEffect(() => {
    setArea(row.area ?? "");
    setDate(row.booking_date ?? "");
    setTime(row.booking_time ?? "");
    setPeople(row.people != null ? String(row.people) : "");
    setCook(row.cook_assigned ?? "");
    setSubEnq(row.subscription_enquiry ?? "");
  }, [row.id]);

  async function saveField(field: string, value: string, original: string) {
    if (value === original) return;
    try {
      await onSaveFields({ [field]: value === "" ? null : value });
      toast.success("Saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  }

  async function savePeople() {
    const original = row.people != null ? String(row.people) : "";
    if (people === original) return;
    try {
      const val = people.trim() === "" ? null : Number(people);
      if (val !== null && Number.isNaN(val)) {
        toast.error("People must be a number");
        return;
      }
      await onSaveFields({ people: val });
      toast.success("Saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  }

  async function saveCookField() {
    const original = row.cook_assigned ?? "";
    if (cook === original) return;
    try {
      await onSaveCook(cook.trim() === "" ? null : cook.trim());
      toast.success("Saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  }

  async function saveSubEnqField() {
    await saveField("subscription_enquiry", subEnq, row.subscription_enquiry ?? "");
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <EditableField
          icon={<MapPin className="h-4 w-4" />}
          label="Area"
          value={area}
          onChange={setArea}
          onCommit={() => saveField("area", area, row.area ?? "")}
          placeholder="e.g. HSR Layout"
        />
        <EditableField
          icon={<Calendar className="h-4 w-4" />}
          label="Date"
          type="date"
          value={date}
          onChange={setDate}
          onCommit={() => saveField("booking_date", date, row.booking_date ?? "")}
        />
        <EditableField
          icon={<Clock className="h-4 w-4" />}
          label="Time"
          type="time"
          value={time}
          onChange={setTime}
          onCommit={() => saveField("booking_time", time, row.booking_time ?? "")}
        />
        <EditableField
          icon={<Users className="h-4 w-4" />}
          label="People"
          type="number"
          value={people}
          onChange={setPeople}
          onCommit={savePeople}
          placeholder="0"
        />
        <EditableField
          icon={<ChefHat className="h-4 w-4" />}
          label="Cook Assigned"
          value={cook}
          onChange={setCook}
          onCommit={saveCookField}
          placeholder="Assign a cook"
        />
        <EditableField
          icon={<Repeat className="h-4 w-4" />}
          label="Subscription Enquiry"
          value={subEnq}
          onChange={setSubEnq}
          onCommit={saveSubEnqField}
          placeholder="Details of subscription enquiry"
          multiline
        />
      </div>

      <dl className="space-y-3 border-t pt-4 text-sm">
        <DetailRow icon={<MessageSquare className="h-4 w-4" />} label="Status" value={row.status} />
        <DetailRow icon={<Bot className="h-4 w-4" />} label="Mode" value={row.mode} />
        <DetailRow icon={<Phone className="h-4 w-4" />} label="Phone" value={row.phone} />
      </dl>

      <CustomerLocation lat={row.location_lat} lng={row.location_lng} />
    </div>
  );
}

function EditableField({
  icon,
  label,
  value,
  onChange,
  onCommit,
  type = "text",
  placeholder,
  multiline,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void | Promise<void>;
  type?: string;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </Label>
      {multiline ? (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => onCommit()}
          placeholder={placeholder}
          rows={2}
          className="resize-none text-sm"
        />
      ) : (
        <Input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => onCommit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder={placeholder}
          className="h-8 text-sm"
        />
      )}
    </div>
  );
}


// ---------- Tab notifications ----------

const BASE_TITLE = "DashCook — Inbox";

function playBeep() {
  try {
    const AC = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    const ctx = new AC();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.05;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
    setTimeout(() => ctx.close(), 300);
  } catch {
    // ignore
  }
}

function useTabNotifications(rows: ConversationRow[], selectedId: string | number | null) {
  const lastSeenRef = useRef<Map<string, string> | null>(null);
  const initializedRef = useRef(false);
  const [unread, setUnread] = useState(0);

  // Ask for browser notification permission once on mount
  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // Clear unread when tab regains focus
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = () => {
      if (!document.hidden) setUnread(0);
    };
    const onFocus = () => setUnread(0);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // Detect new customer activity (last_message_at advanced)
  useEffect(() => {
    if (!rows.length) return;
    const prev = lastSeenRef.current;
    const next = new Map<string, string>();
    let newCount = 0;
    let latestPhone: string | null = null;

    for (const r of rows) {
      const key = String(r.id);
      const ts = r.last_message_at ?? "";
      next.set(key, ts);
      if (prev && ts) {
        const prevTs = prev.get(key);
        const isNewer = !prevTs || ts > prevTs;
        const isHidden = typeof document !== "undefined" && document.hidden;
        const notActive = r.id !== selectedId;
        if (isNewer && (isHidden || notActive)) {
          newCount++;
          latestPhone = r.phone ?? latestPhone;
        }
      }
    }

    lastSeenRef.current = next;

    if (!initializedRef.current) {
      initializedRef.current = true;
      return; // skip first run
    }

    if (newCount > 0) {
      setUnread((u) => u + newCount);
      playBeep();
      if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
        try {
          const n = new Notification("New message — DashCook", {
            body: latestPhone ? `From ${latestPhone}` : `${newCount} new message${newCount > 1 ? "s" : ""}`,
            tag: "dashcook-inbox",
          });
          n.onclick = () => {
            window.focus();
            n.close();
          };
        } catch {
          // ignore
        }
      }
    }
  }, [rows, selectedId]);

  // Update tab title
  useEffect(() => {
    if (typeof document === "undefined") return;
    const prev = document.title;
    document.title = unread > 0 ? `(${unread}) ${BASE_TITLE}` : BASE_TITLE;
    return () => {
      document.title = prev;
    };
  }, [unread]);
}


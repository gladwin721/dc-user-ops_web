import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  getConversations,
  getConversation,
  updateConversationMode,
  saveBookingStatus,
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
import { Send, Phone, MapPin, Calendar, Clock, Users, MessageSquare, Bot, UserRound, Inbox, Loader2, Check, ExternalLink } from "lucide-react";
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
    mutationFn: async (args: { status: BookingStatus; cancellation_reason?: string | null }) => {
      if (!selected) throw new Error("No conversation selected");
      setStatusSaveState("saving");
      const res = await saveStatusFn({
        data: {
          id: selected.id,
          status: args.status,
          cancellation_reason: args.cancellation_reason ?? null,
        },
      });
      if (!res.ok) throw new Error(res.error ?? "Failed to update status");
      return args.status;
    },
    onSuccess: (status) => {
      setStatusSaveState("saved");
      toast.success(`Status set to ${STATUS_META[status].label}`);
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
  const rows = statusFilter === "all" ? allRows : allRows.filter((r) => r.status === statusFilter);
  const listError = listQuery.data?.error;

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
                <StatusSelect
                  status={
                    pendingCancel
                      ? "cancelled"
                      : ((selected.status as BookingStatus | null) ?? null)
                  }
                  saveState={statusSaveState}
                  onChange={(s) => {
                    if (s === "cancelled") {
                      // Defer save until reason is picked
                      setPendingCancel(true);
                    } else {
                      setPendingCancel(false);
                      statusMutation.mutate({ status: s });
                    }
                  }}
                />
                <ModeToggle
                  mode={(selected.mode === "human" ? "human" : "bot") as "bot" | "human"}
                  pending={modeMutation.isPending}
                  onChange={(m) => modeMutation.mutate(m)}
                />
              </div>
            </header>

            {(pendingCancel || selected.status === "cancelled") && (
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
                  statusMutation.mutate(
                    { status: "cancelled", cancellation_reason: finalReason },
                    { onSuccess: () => setPendingCancel(false) },
                  );
                }}
                onCancel={
                  pendingCancel
                    ? () => {
                        setPendingCancel(false);
                        // Restore reason fields from server value
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
            <div className="space-y-5">
              <dl className="space-y-3 text-sm">
                <DetailRow icon={<MapPin className="h-4 w-4" />} label="Area" value={selected.area} />
                <DetailRow icon={<Calendar className="h-4 w-4" />} label="Date" value={selected.booking_date} />
                <DetailRow icon={<Clock className="h-4 w-4" />} label="Time" value={selected.booking_time} />
                <DetailRow icon={<Users className="h-4 w-4" />} label="People" value={selected.people != null ? String(selected.people) : null} />
                <DetailRow icon={<MessageSquare className="h-4 w-4" />} label="Status" value={selected.status} />
                <DetailRow icon={<Bot className="h-4 w-4" />} label="Mode" value={selected.mode} />
                <DetailRow icon={<Phone className="h-4 w-4" />} label="Phone" value={selected.phone} />
              </dl>
              <CustomerLocation lat={selected.location_lat} lng={selected.location_lng} />
            </div>


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
        <div>
          <StatusBadge status={row.status} small />
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

function StatusBadge({ status, small }: { status: string | null; small?: boolean }) {
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

function StatusSelect({
  status,
  saveState,
  onChange,
}: {
  status: BookingStatus | null;
  saveState: "idle" | "saving" | "saved" | "error";
  onChange: (s: BookingStatus) => void;
}) {
  const value = isBookingStatus(status) ? status : "new";
  return (
    <div className="flex items-center gap-2">
      <Label className="text-xs text-muted-foreground">Status</Label>
      <Select
        value={value}
        disabled={saveState === "saving"}
        onValueChange={(v) => onChange(v as BookingStatus)}
      >
        <SelectTrigger className="h-8 w-[180px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {BOOKING_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              <span className="flex items-center gap-2">
                <span className={cn("inline-block h-2 w-2 rounded-full", STATUS_META[s].dotClass)} />
                {STATUS_META[s].label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="w-4 text-muted-foreground">
        {saveState === "saving" && <Loader2 className="h-4 w-4 animate-spin" />}
        {saveState === "saved" && <Check className="h-4 w-4 text-green-600" />}
      </span>
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


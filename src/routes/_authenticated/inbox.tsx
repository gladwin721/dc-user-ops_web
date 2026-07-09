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
  saveBookingStatus,
  sendOperatorMessage,
  parseStatuses,
  BOOKING_STATUSES,
  getOrdersForConversation,
  updateOrderFields,
  createOrderForConversation,
  type BookingStatus,
  type ConversationRow,
  type OrderRow,
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
import { Send, Phone, MapPin, Calendar, Clock, Users, MessageSquare, Bot, UserRound, Inbox, Loader2, Check, ExternalLink, ChevronDown, ChefHat, Repeat, ArrowLeft, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Info, Plus, Star, Truck, Timer, IndianRupee, Utensils, FileText, XCircle } from "lucide-react";
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
  void saveBookingStatus;
  const sendFn = useServerFn(sendOperatorMessage);
  const updateFieldsFn = useServerFn(updateConversationFields);
  const listOrdersFn = useServerFn(getOrdersForConversation);
  const updateOrderFn = useServerFn(updateOrderFields);
  const createOrderFn = useServerFn(createOrderForConversation);


  const search = Route.useSearch();
  const [selectedId, setSelectedId] = useState<string | number | null>(search.id ?? null);
  const [draft, setDraft] = useState("");
  const [statusFilter, setStatusFilter] = useState<BookingStatus[]>([]);
  const [statusSaveState, setStatusSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  // Pending-cancel UX: when operator picks "Cancelled" in the dropdown, we hold off
  // saving until they pick a reason and click Save.
  const [pendingCancel, setPendingCancel] = useState(false);
  const [reasonChoice, setReasonChoice] = useState<string>("");
  const [otherText, setOtherText] = useState<string>("");
  // Collapsible panels (desktop) and single-pane navigation (mobile)
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [mobileView, setMobileView] = useState<"list" | "chat" | "details">(
    search.id !== undefined ? "chat" : "list",
  );

  // Sync URL ?id= -> selection
  useEffect(() => {
    if (search.id !== undefined && search.id !== selectedId) {
      setSelectedId(search.id);
      setMobileView("chat");
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
    mutationFn: async (args: { statuses: BookingStatus[]; cancellation_reason?: string | null; orderId: string }) => {
      if (!selected) throw new Error("No conversation selected");
      if (!args.orderId) throw new Error("No order selected");
      setStatusSaveState("saving");
      const ordered = (BOOKING_STATUSES as readonly BookingStatus[]).filter((s) => args.statuses.includes(s));
      const fields: Record<string, string | number | null> = { status: ordered.join(",") };
      if (ordered.includes("cancelled")) {
        fields.cancellation_reason = (args.cancellation_reason ?? "").trim() || null;
      }
      const res = await updateOrderFn({ data: { id: args.orderId, fields } });
      if (!res.ok) throw new Error(res.error ?? "Failed to update status");
      return args.statuses;
    },
    onSuccess: (statuses) => {
      setStatusSaveState("saved");
      const labels = statuses.map((s) => STATUS_META[s].label).join(", ");
      toast.success(`Status set to ${labels}`);
      qc.invalidateQueries({ queryKey: ["orders", selectedId] });
      setTimeout(() => setStatusSaveState("idle"), 1500);
    },
    onError: (err) => {
      setStatusSaveState("error");
      toast.error(err instanceof Error ? err.message : "Status change failed");
      qc.invalidateQueries({ queryKey: ["orders", selectedId] });
      setTimeout(() => setStatusSaveState("idle"), 2000);
    },
  });

  const allRows = listQuery.data?.rows ?? [];
  const rows =
    statusFilter.length === 0
      ? allRows
      : allRows.filter((r) => {
          const rs = parseStatuses(r.status);
          return statusFilter.some((s) => rs.includes(s));
        });
  const listError = listQuery.data?.error;

  // Orders for the selected customer (multiple orders per conversation/phone)
  const ordersQuery = useQuery({
    queryKey: ["orders", selectedId, selected?.phone ?? null],
    queryFn: () => listOrdersFn({ data: { conversation_id: selectedId!, phone: selected?.phone ?? null } }),
    enabled: selectedId !== null && !!selected,
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  });
  const orders: OrderRow[] = ordersQuery.data?.rows ?? [];
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  // When orders change (new conversation selected or list refresh), auto-select the newest if none valid
  useEffect(() => {
    if (orders.length === 0) {
      if (selectedOrderId !== null) setSelectedOrderId(null);
      return;
    }
    const exists = selectedOrderId && orders.some((o) => o.id === selectedOrderId);
    if (!exists) setSelectedOrderId(orders[0].id);
  }, [orders, selectedOrderId]);
  // Reset selected order when switching conversations
  useEffect(() => {
    setSelectedOrderId(null);
  }, [selectedId]);
  const selectedOrder: OrderRow | null = useMemo(
    () => orders.find((o) => o.id === selectedOrderId) ?? null,
    [orders, selectedOrderId],
  );

  // Status display: prefer selected order's status; fallback to conversation
  const effectiveStatusRaw = selectedOrder?.status ?? selected?.status ?? null;
  const selectedStatuses: BookingStatus[] = useMemo(
    () => parseStatuses(effectiveStatusRaw),
    [effectiveStatusRaw],
  );
  const showCancellationBar = pendingCancel || selectedStatuses.includes("cancelled");

  useTabNotifications(allRows, selectedId);



  return (
    <div className="flex h-[calc(100vh-3rem)] w-full overflow-hidden bg-background text-foreground">
      {/* LEFT — Queue */}
      <aside
        className={cn(
          "flex-col border-r bg-background",
          mobileView === "list" ? "flex w-full" : "hidden",
          leftOpen ? "md:flex md:w-80 md:shrink-0" : "md:hidden",
        )}
      >
        <header className="flex items-center gap-2 border-b px-4 py-3">
          <Inbox className="h-5 w-5 text-primary" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold leading-tight">DashCook Inbox</h1>
            <p className="truncate text-xs text-muted-foreground">
              {listQuery.isFetching ? "Refreshing…" : `${rows.length} conversations`}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="hidden h-7 w-7 md:inline-flex"
            onClick={() => setLeftOpen(false)}
            title="Collapse conversations"
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        </header>
        <div className="border-b p-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 w-full justify-between text-xs font-normal">
                <span className="truncate">
                  {statusFilter.length === 0
                    ? "All statuses"
                    : statusFilter.length === 1
                      ? STATUS_META[statusFilter[0]].label
                      : `${statusFilter.length} statuses`}
                </span>
                <ChevronDown className="h-3.5 w-3.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel className="text-xs">Filter by status</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {statusFilter.length > 0 && (
                <>
                  <DropdownMenuCheckboxItem
                    checked={false}
                    onCheckedChange={() => setStatusFilter([])}
                    onSelect={(e) => e.preventDefault()}
                  >
                    <span className="text-xs">Clear all</span>
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuSeparator />
                </>
              )}
              {BOOKING_STATUSES.map((s) => {
                const checked = statusFilter.includes(s);
                return (
                  <DropdownMenuCheckboxItem
                    key={s}
                    checked={checked}
                    onCheckedChange={(c) => {
                      setStatusFilter((prev) => {
                        const set = new Set(prev);
                        if (c) set.add(s);
                        else set.delete(s);
                        return (BOOKING_STATUSES as readonly BookingStatus[]).filter((x) => set.has(x));
                      });
                    }}
                    onSelect={(e) => e.preventDefault()}
                  >
                    <span className="flex items-center gap-2 text-xs">
                      <span className={cn("inline-block h-2 w-2 rounded-full", STATUS_META[s].dotClass)} />
                      {STATUS_META[s].label}
                    </span>
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
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
                onClick={() => {
                  setSelectedId(c.id);
                  setMobileView("chat");
                }}
              />
            ))}
          </ul>
        </div>
      </aside>

      {/* CENTER — Conversation */}
      <section
        className={cn(
          "min-w-0 flex-col md:flex md:flex-1",
          mobileView === "chat" ? "flex flex-1" : "hidden",
        )}
      >
        {!selected ? (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
            Select a conversation to view its history.
          </div>
        ) : (
          <>
            <header className="flex flex-col gap-2 border-b px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6">
              <div className="flex min-w-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="-ml-1 h-8 w-8 shrink-0 md:hidden"
                  onClick={() => setMobileView("list")}
                  title="Back to conversations"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                {!leftOpen && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="hidden h-8 w-8 shrink-0 md:inline-flex"
                    onClick={() => setLeftOpen(true)}
                    title="Show conversations"
                  >
                    <PanelLeftOpen className="h-4 w-4" />
                  </Button>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{selected.phone ?? "Unknown"}</span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    Last activity {formatDateTime(selected.last_message_at)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto h-8 w-8 shrink-0 md:hidden"
                  onClick={() => setMobileView("details")}
                  title="Booking details"
                >
                  <Info className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                <StatusSelect
                  status={
                    pendingCancel ? "cancelled" : (selectedStatuses[0] ?? null)
                  }
                  saveState={statusSaveState}
                  onChange={(status) => {
                    if (!selectedOrder) {
                      toast.error("Create an order first to set status");
                      return;
                    }
                    const wasCancelled = selectedStatuses.includes("cancelled");
                    if (status === "cancelled" && !wasCancelled) {
                      setPendingCancel(true);
                      return;
                    }
                    setPendingCancel(false);
                    statusMutation.mutate({ statuses: [status], orderId: selectedOrder.id });
                  }}
                />
                <ModeToggle
                  mode={(selected.mode === "human" ? "human" : "bot") as "bot" | "human"}
                  pending={modeMutation.isPending}
                  onChange={(m) => modeMutation.mutate(m)}
                />
                {!rightOpen && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="hidden h-8 w-8 shrink-0 md:inline-flex"
                    onClick={() => setRightOpen(true)}
                    title="Show booking details"
                  >
                    <PanelRightOpen className="h-4 w-4" />
                  </Button>
                )}
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
                  if (!selectedOrder) {
                    toast.error("Create an order first to set status");
                    return;
                  }
                  statusMutation.mutate(
                    { statuses: ["cancelled"], cancellation_reason: finalReason, orderId: selectedOrder.id },
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

            <div ref={chatScrollRef} onScroll={handleChatScroll} className="flex-1 overflow-y-auto px-3 py-4 sm:px-6">
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
      <aside
        className={cn(
          "flex-col border-l bg-background",
          mobileView === "details" ? "flex w-full" : "hidden",
          rightOpen ? "md:flex md:w-80 md:shrink-0" : "md:hidden",
        )}
      >
        <header className="flex items-center gap-2 border-b px-4 py-3">
          <Button
            variant="ghost"
            size="icon"
            className="-ml-1 h-8 w-8 shrink-0 md:hidden"
            onClick={() => setMobileView("chat")}
            title="Back to conversation"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold">Order details</h2>
            <p className="truncate text-xs text-muted-foreground">Orders for this customer</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="hidden h-7 w-7 md:inline-flex"
            onClick={() => setRightOpen(false)}
            title="Collapse order details"
          >
            <PanelRightClose className="h-4 w-4" />
          </Button>
        </header>
        <div className="flex-1 overflow-y-auto p-4">
          {!selected ? (
            <p className="text-sm text-muted-foreground">No conversation selected.</p>
          ) : (
            <OrderDetailsPanel
              conversation={selected}
              orders={orders}
              ordersLoading={ordersQuery.isLoading}
              selectedOrderId={selectedOrderId}
              onSelectOrder={setSelectedOrderId}
              onSaveConversationFields={(fields) =>
                updateFieldsFn({ data: { id: selected.id, fields } }).then((res) => {
                  if (!res.ok) throw new Error(res.error ?? "Save failed");
                  qc.invalidateQueries({ queryKey: ["conversation", selectedId] });
                  qc.invalidateQueries({ queryKey: ["conversations"] });
                })
              }
              onSaveOrderFields={(orderId, fields) =>
                updateOrderFn({ data: { id: orderId, fields } }).then((res) => {
                  if (!res.ok) throw new Error(res.error ?? "Save failed");
                  qc.invalidateQueries({ queryKey: ["orders", selectedId, selected.phone ?? null] });
                })
              }
              onCreateOrder={async (fields) => {
                const res = await createOrderFn({
                  data: {
                    conversation_id: selected.id,
                    phone: selected.phone,
                    fields,
                  },
                });
                if (!res.ok || !res.row) throw new Error(res.error ?? "Create failed");
                await qc.invalidateQueries({ queryKey: ["orders", selectedId, selected.phone ?? null] });
                setSelectedOrderId(res.row.id);
                return res.row;
              }}
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
    <div className="border-t bg-background px-3 py-3 sm:px-6 sm:py-4">
      <div className="flex items-end gap-2 sm:gap-3">
        <Textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Type a message… ⌘/Ctrl+Enter to send"
          rows={2}
          className="resize-none text-sm sm:rows-3"
        />
        <Button
          onClick={onSend}
          disabled={sending || value.trim().length === 0}
          className="h-10 shrink-0 px-3 sm:px-4"
          title="Send"
        >
          <Send className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">{sending ? "Sending…" : "Send"}</span>
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
  "Outside service area",
  "Requested time unavailable",
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
    <div className="border-b bg-muted/30 px-3 py-3 sm:px-6">
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


import { STATUS_META, isBookingStatus } from "@/lib/booking-status";

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

function StatusSelect({
  status,
  saveState,
  onChange,
}: {
  status: BookingStatus | null;
  saveState: "idle" | "saving" | "saved" | "error";
  onChange: (s: BookingStatus) => void;
}) {
  const label = status ? STATUS_META[status].label : "Select status";
  return (
    <div className="flex items-center gap-2">
      <Label className="text-xs text-muted-foreground">Status</Label>
      <Select
        value={status ?? ""}
        onValueChange={(v) => {
          if (isBookingStatus(v)) onChange(v);
        }}
        disabled={saveState === "saving"}
      >
        <SelectTrigger className="h-8 w-[170px] text-xs font-normal sm:w-[220px]">
          <span className="flex items-center gap-1.5 truncate">
            {status && (
              <span className={cn("inline-block h-2 w-2 rounded-full", STATUS_META[status].dotClass)} />
            )}
            <span className="truncate">{label}</span>
          </span>
        </SelectTrigger>
        <SelectContent>
          {BOOKING_STATUSES.map((s) => (
            <SelectItem key={s} value={s} className="text-xs">
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

// ---------- Order details panel (editable, per-order) ----------

const ORDER_TYPES = ["first_order", "repeat", "subscription"] as const;
type OrderTypeValue = (typeof ORDER_TYPES)[number];
const ORDER_TYPE_LABELS: Record<OrderTypeValue, string> = {
  first_order: "First Order",
  repeat: "Repeat",
  subscription: "Subscription",
};

const ORDER_CANCELLATION_REASONS: readonly string[] = [
  "Customer unavailable",
  "Customer cancelled",
  "No cook available",
  "Outside service area",
  "Duplicate booking",
  "No response",
  "Subscription enquiry only",
  "Other",
];

function formatOrderCreatedAt(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  const day = d.getDate().toString().padStart(2, "0");
  const month = d.toLocaleString("en-US", { month: "short" });
  const year = d.getFullYear();
  let hours = d.getHours();
  const mins = d.getMinutes().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${day} ${month} ${year} · ${hours}:${mins} ${ampm}`;
}

type OrderDraft = Partial<Record<
  | "area"
  | "booking_date"
  | "booking_time"
  | "people"
  | "status"
  | "order_type"
  | "cook_assigned"
  | "travel_charges"
  | "cook_time_taken_in_mins"
  | "cooking_amount_paid"
  | "items_cooked"
  | "notes"
  | "rating"
  | "cancellation_reason"
  | "pre_booking_payment_link"
  | "full_payment_link",
  string | number | null
>>;

function OrderDetailsPanel({
  conversation,
  orders,
  ordersLoading,
  selectedOrderId,
  onSelectOrder,
  onSaveConversationFields,
  onSaveOrderFields,
  onCreateOrder,
}: {
  conversation: ConversationRow;
  orders: OrderRow[];
  ordersLoading: boolean;
  selectedOrderId: string | null;
  onSelectOrder: (id: string) => void;
  onSaveConversationFields: (fields: Record<string, string | number | null>) => Promise<void>;
  onSaveOrderFields: (orderId: string, fields: OrderDraft) => Promise<void>;
  onCreateOrder: (fields: OrderDraft) => Promise<OrderRow>;
}) {
  const order = orders.find((o) => o.id === selectedOrderId) ?? null;
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-5">
      {/* Order selector header */}
      <div className="space-y-3 rounded-md border bg-muted/30 p-3">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs text-muted-foreground">Order ID</Label>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setCreating(true)}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Create Order
          </Button>
        </div>
        {ordersLoading && orders.length === 0 ? (
          <p className="text-xs text-muted-foreground">Loading orders…</p>
        ) : orders.length === 0 ? (
          <p className="text-xs text-muted-foreground">No orders yet for this customer.</p>
        ) : (
          <Select value={selectedOrderId ?? ""} onValueChange={onSelectOrder}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select order…" />
            </SelectTrigger>
            <SelectContent>
              {orders.map((o) => (
                <SelectItem key={o.id} value={o.id} className="text-xs">
                  {o.order_id ?? o.id.slice(0, 8)}
                  {o.created_at ? ` · ${formatOrderCreatedAt(o.created_at)}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {order && (
          <>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Order Type</Label>
              <Select
                value={(order.order_type as string) ?? ""}
                onValueChange={(v) => onSaveOrderFields(order.id, { order_type: v }).then(() => toast.success("Saved")).catch((e) => toast.error(e instanceof Error ? e.message : "Save failed"))}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select order type…" />
                </SelectTrigger>
                <SelectContent>
                  {ORDER_TYPES.map((t) => (
                    <SelectItem key={t} value={t} className="text-xs">
                      {ORDER_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-3 border-t pt-2">
              <span className="text-xs text-muted-foreground">Created</span>
              <span className="text-xs font-medium">{formatOrderCreatedAt(order.created_at)}</span>
            </div>
          </>
        )}
      </div>

      {order && (
        <OrderEditableFields
          key={order.id}
          order={order}
          onSave={(fields) => onSaveOrderFields(order.id, fields)}
        />
      )}

      {/* Customer information (conversation-level) */}
      <div className="space-y-3 border-t pt-4">
        <h3 className="text-sm font-semibold">Customer Information</h3>
        <ConversationFields
          conversation={conversation}
          onSave={onSaveConversationFields}
        />
      </div>

      <CustomerLocation lat={conversation.location_lat} lng={conversation.location_lng} />

      {creating && (
        <CreateOrderDialog
          onClose={() => setCreating(false)}
          onCreate={async (fields) => {
            try {
              await onCreateOrder(fields);
              toast.success("Order created");
              setCreating(false);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Create failed");
            }
          }}
        />
      )}
    </div>
  );
}

function OrderEditableFields({
  order,
  onSave,
}: {
  order: OrderRow;
  onSave: (fields: OrderDraft) => Promise<void>;
}) {
  const s = (v: unknown) => (v == null ? "" : String(v));
  const [area, setArea] = useState(s(order.area));
  const [date, setDate] = useState(s(order.booking_date));
  const [time, setTime] = useState(s(order.booking_time));
  const [people, setPeople] = useState(s(order.people));
  const [cook, setCook] = useState(s(order.cook_assigned));
  const [travel, setTravel] = useState(s(order.travel_charges));
  const [cookTime, setCookTime] = useState(s(order.cook_time_taken_in_mins));
  const [amount, setAmount] = useState(s(order.cooking_amount_paid));
  const [items, setItems] = useState(s(order.items_cooked));
  const [notes, setNotes] = useState(s(order.notes));
  const [rating, setRating] = useState(s(order.rating));
  const [cxReason, setCxReason] = useState(s(order.cancellation_reason));
  const [prepay, setPrepay] = useState(s(order.pre_booking_payment_link));
  const [fullpay, setFullpay] = useState(s(order.full_payment_link));

  useEffect(() => {
    setArea(s(order.area));
    setDate(s(order.booking_date));
    setTime(s(order.booking_time));
    setPeople(s(order.people));
    setCook(s(order.cook_assigned));
    setTravel(s(order.travel_charges));
    setCookTime(s(order.cook_time_taken_in_mins));
    setAmount(s(order.cooking_amount_paid));
    setItems(s(order.items_cooked));
    setNotes(s(order.notes));
    setRating(s(order.rating));
    setCxReason(s(order.cancellation_reason));
    setPrepay(s(order.pre_booking_payment_link));
    setFullpay(s(order.full_payment_link));
  }, [order.id]);

  async function commit(field: keyof OrderDraft, value: string, original: string) {
    if (value === original) return;
    try {
      await onSave({ [field]: value === "" ? null : value } as OrderDraft);
      toast.success("Saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  }

  return (
    <div className="space-y-3">
      <EditableField icon={<MapPin className="h-4 w-4" />} label="Area" value={area} onChange={setArea} onCommit={() => commit("area", area, s(order.area))} placeholder="e.g. HSR Layout" />
      <EditableField icon={<Calendar className="h-4 w-4" />} label="Date" type="date" value={date} onChange={setDate} onCommit={() => commit("booking_date", date, s(order.booking_date))} />
      <EditableField icon={<Clock className="h-4 w-4" />} label="Time" type="time" value={time} onChange={setTime} onCommit={() => commit("booking_time", time, s(order.booking_time))} />
      <EditableField icon={<Users className="h-4 w-4" />} label="People" type="number" value={people} onChange={setPeople} onCommit={() => commit("people", people, s(order.people))} placeholder="0" />
      <EditableField icon={<ChefHat className="h-4 w-4" />} label="Cook Assigned" value={cook} onChange={setCook} onCommit={() => commit("cook_assigned", cook, s(order.cook_assigned))} placeholder="Assign a cook" />
      <EditableField icon={<Truck className="h-4 w-4" />} label="Travel Charges" type="number" value={travel} onChange={setTravel} onCommit={() => commit("travel_charges", travel, s(order.travel_charges))} placeholder="0" />
      <EditableField icon={<Timer className="h-4 w-4" />} label="Cook Time Taken (mins)" type="number" value={cookTime} onChange={setCookTime} onCommit={() => commit("cook_time_taken_in_mins", cookTime, s(order.cook_time_taken_in_mins))} placeholder="0" />
      <EditableField icon={<IndianRupee className="h-4 w-4" />} label="Amount Paid" type="number" value={amount} onChange={setAmount} onCommit={() => commit("cooking_amount_paid", amount, s(order.cooking_amount_paid))} placeholder="0" />
      <EditableField icon={<Utensils className="h-4 w-4" />} label="Items Cooked" value={items} onChange={setItems} onCommit={() => commit("items_cooked", items, s(order.items_cooked))} placeholder="List items…" multiline />
      <EditableField icon={<FileText className="h-4 w-4" />} label="Notes" value={notes} onChange={setNotes} onCommit={() => commit("notes", notes, s(order.notes))} placeholder="Notes…" multiline />

      <div className="space-y-1">
        <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Star className="h-4 w-4" /> Rating
        </Label>
        <Select
          value={rating}
          onValueChange={(v) => {
            setRating(v);
            commit("rating", v, s(order.rating));
          }}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Select rating…" />
          </SelectTrigger>
          <SelectContent>
            {[1, 2, 3, 4, 5].map((n) => (
              <SelectItem key={n} value={String(n)} className="text-xs">
                {n} ★
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <XCircle className="h-4 w-4" /> Cancellation Reason
        </Label>
        <Select
          value={cxReason}
          onValueChange={(v) => {
            setCxReason(v);
            commit("cancellation_reason", v, s(order.cancellation_reason));
          }}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Select reason…" />
          </SelectTrigger>
          <SelectContent>
            {ORDER_CANCELLATION_REASONS.map((r) => (
              <SelectItem key={r} value={r} className="text-xs">
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <EditableField icon={<ExternalLink className="h-4 w-4" />} label="Prepayment Link" value={prepay} onChange={setPrepay} onCommit={() => commit("pre_booking_payment_link", prepay, s(order.pre_booking_payment_link))} placeholder="https://…" />
      <EditableField icon={<ExternalLink className="h-4 w-4" />} label="Full Payment Link" value={fullpay} onChange={setFullpay} onCommit={() => commit("full_payment_link", fullpay, s(order.full_payment_link))} placeholder="https://…" />
    </div>
  );
}

function ConversationFields({
  conversation,
  onSave,
}: {
  conversation: ConversationRow;
  onSave: (fields: Record<string, string | number | null>) => Promise<void>;
}) {
  const [subEnq, setSubEnq] = useState(conversation.subscription_enquiry ?? "");
  const [source, setSource] = useState(conversation.conversation_source ?? "");

  useEffect(() => {
    setSubEnq(conversation.subscription_enquiry ?? "");
    setSource(conversation.conversation_source ?? "");
  }, [conversation.id]);

  async function save(field: string, value: string, original: string) {
    if (value === original) return;
    try {
      await onSave({ [field]: value === "" ? null : value });
      toast.success("Saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  }

  return (
    <div className="space-y-3">
      <EditableField
        icon={<Repeat className="h-4 w-4" />}
        label="Subscription Enquiry"
        value={subEnq}
        onChange={setSubEnq}
        onCommit={() => save("subscription_enquiry", subEnq, conversation.subscription_enquiry ?? "")}
        placeholder="Details of subscription enquiry"
        multiline
      />
      <EditableField
        icon={<MessageSquare className="h-4 w-4" />}
        label="Conversation Source"
        value={source}
        onChange={setSource}
        onCommit={() => save("conversation_source", source, conversation.conversation_source ?? "")}
        placeholder="e.g. WhatsApp, Instagram"
      />
    </div>
  );
}

function CreateOrderDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (fields: OrderDraft) => Promise<void>;
}) {
  const [area, setArea] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [people, setPeople] = useState("");
  const [status, setStatus] = useState<string>("");
  const [orderType, setOrderType] = useState<string>("");
  const [travel, setTravel] = useState("");
  const [cookTime, setCookTime] = useState("");
  const [amount, setAmount] = useState("");
  const [items, setItems] = useState("");
  const [notes, setNotes] = useState("");
  const [rating, setRating] = useState("");
  const [cxReason, setCxReason] = useState("");
  const [prepay, setPrepay] = useState("");
  const [fullpay, setFullpay] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    setSaving(true);
    const fields: OrderDraft = {};
    if (area.trim()) fields.area = area.trim();
    if (date.trim()) fields.booking_date = date.trim();
    if (time.trim()) fields.booking_time = time.trim();
    if (people.trim()) fields.people = people.trim();
    if (status.trim()) fields.status = status.trim();
    if (orderType.trim()) fields.order_type = orderType.trim();
    if (travel.trim()) fields.travel_charges = travel.trim();
    if (cookTime.trim()) fields.cook_time_taken_in_mins = cookTime.trim();
    if (amount.trim()) fields.cooking_amount_paid = amount.trim();
    if (items.trim()) fields.items_cooked = items.trim();
    if (notes.trim()) fields.notes = notes.trim();
    if (rating.trim()) fields.rating = rating.trim();
    if (cxReason.trim()) fields.cancellation_reason = cxReason.trim();
    if (prepay.trim()) fields.pre_booking_payment_link = prepay.trim();
    if (fullpay.trim()) fields.full_payment_link = fullpay.trim();
    try {
      await onCreate(fields);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border bg-background p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Create Order</h3>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
        <div className="space-y-3">
          <EditableField icon={<MapPin className="h-4 w-4" />} label="Area" value={area} onChange={setArea} onCommit={() => {}} placeholder="e.g. HSR Layout" />
          <EditableField icon={<Calendar className="h-4 w-4" />} label="Date" type="date" value={date} onChange={setDate} onCommit={() => {}} />
          <EditableField icon={<Clock className="h-4 w-4" />} label="Time" type="time" value={time} onChange={setTime} onCommit={() => {}} />
          <EditableField icon={<Users className="h-4 w-4" />} label="People" type="number" value={people} onChange={setPeople} onCommit={() => {}} placeholder="0" />
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select status…" /></SelectTrigger>
              <SelectContent>
                {BOOKING_STATUSES.map((s) => (
                  <SelectItem key={s} value={s} className="text-xs">{STATUS_META[s].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Order Type</Label>
            <Select value={orderType} onValueChange={setOrderType}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Auto (first / repeat)" /></SelectTrigger>
              <SelectContent>
                {ORDER_TYPES.map((t) => (
                  <SelectItem key={t} value={t} className="text-xs">{ORDER_TYPE_LABELS[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <EditableField icon={<Truck className="h-4 w-4" />} label="Travel Charges" type="number" value={travel} onChange={setTravel} onCommit={() => {}} />
          <EditableField icon={<Timer className="h-4 w-4" />} label="Cook Time Taken (mins)" type="number" value={cookTime} onChange={setCookTime} onCommit={() => {}} />
          <EditableField icon={<IndianRupee className="h-4 w-4" />} label="Amount Paid" type="number" value={amount} onChange={setAmount} onCommit={() => {}} />
          <EditableField icon={<Utensils className="h-4 w-4" />} label="Items Cooked" value={items} onChange={setItems} onCommit={() => {}} multiline />
          <EditableField icon={<FileText className="h-4 w-4" />} label="Notes" value={notes} onChange={setNotes} onCommit={() => {}} multiline />
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Rating</Label>
            <Select value={rating} onValueChange={setRating}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select rating…" /></SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5].map((n) => (
                  <SelectItem key={n} value={String(n)} className="text-xs">{n} ★</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Cancellation Reason</Label>
            <Select value={cxReason} onValueChange={setCxReason}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select reason…" /></SelectTrigger>
              <SelectContent>
                {ORDER_CANCELLATION_REASONS.map((r) => (
                  <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <EditableField icon={<ExternalLink className="h-4 w-4" />} label="Prepayment Link" value={prepay} onChange={setPrepay} onCommit={() => {}} placeholder="https://…" />
          <EditableField icon={<ExternalLink className="h-4 w-4" />} label="Full Payment Link" value={fullpay} onChange={setFullpay} onCommit={() => {}} placeholder="https://…" />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={handleCreate} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Create Order
          </Button>
        </div>
      </div>
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


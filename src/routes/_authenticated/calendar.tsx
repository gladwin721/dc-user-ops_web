import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  addDays,
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
} from "date-fns";
import {
  getConversations,
  type ConversationRow,
} from "@/lib/conversations.functions";
import { STATUS_META, isBookingStatus, statusLabel } from "@/lib/booking-status";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { ChevronLeft, ChevronRight, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

type View = "month" | "week" | "day";

export const Route = createFileRoute("/_authenticated/calendar")({
  head: () => ({
    meta: [
      { title: "DashCook — Calendar" },
      { name: "description", content: "Booking calendar view for DashCook." },
    ],
  }),
  component: CalendarPage,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="p-8 space-y-3">
        <h1 className="text-xl font-semibold">Calendar failed to load</h1>
        <p className="text-sm text-muted-foreground">Something went wrong. Please try again.</p>
        <Button onClick={() => { reset(); router.invalidate(); }}>Retry</Button>
      </div>
    );
  },
  notFoundComponent: () => <div className="p-8">Not found</div>,
});

function parseBookingDate(d: string | null): Date | null {
  if (!d) return null;
  try {
    const dt = parseISO(d);
    if (isNaN(dt.getTime())) return null;
    return dt;
  } catch {
    return null;
  }
}

function CalendarPage() {
  const navigate = useNavigate();
  const listFn = useServerFn(getConversations);
  const listQuery = useQuery({
    queryKey: ["conversations"],
    queryFn: () => listFn(),
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
  });
  const rows = listQuery.data?.rows ?? [];

  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState<Date>(new Date());
  const [selected, setSelected] = useState<ConversationRow | null>(null);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, ConversationRow[]>();
    for (const r of rows) {
      const d = parseBookingDate(r.booking_date);
      if (!d) continue;
      const k = format(d, "yyyy-MM-dd");
      const arr = map.get(k) ?? [];
      arr.push(r);
      map.set(k, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (a.booking_time ?? "").localeCompare(b.booking_time ?? ""));
    }
    return map;
  }, [rows]);

  function shift(dir: -1 | 1) {
    if (view === "month") setCursor((c) => (dir === 1 ? addMonths(c, 1) : subMonths(c, 1)));
    else if (view === "week") setCursor((c) => (dir === 1 ? addWeeks(c, 1) : subWeeks(c, 1)));
    else setCursor((c) => addDays(c, dir));
  }

  const title =
    view === "month"
      ? format(cursor, "MMMM yyyy")
      : view === "week"
        ? `${format(startOfWeek(cursor, { weekStartsOn: 1 }), "MMM d")} – ${format(endOfWeek(cursor, { weekStartsOn: 1 }), "MMM d, yyyy")}`
        : format(cursor, "EEEE, MMMM d, yyyy");

  return (
    <div className="mx-auto flex h-[calc(100vh-3rem)] w-full max-w-7xl flex-col gap-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
          <p className="text-sm text-muted-foreground">
            {listQuery.isFetching ? "Syncing…" : "Live bookings from Supabase"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={view} onValueChange={(v) => setView(v as View)}>
            <TabsList>
              <TabsTrigger value="month">Month</TabsTrigger>
              <TabsTrigger value="week">Week</TabsTrigger>
              <TabsTrigger value="day">Day</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" onClick={() => shift(-1)}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" onClick={() => setCursor(new Date())}>Today</Button>
            <Button variant="outline" size="icon" onClick={() => shift(1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      </header>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">{title}</h2>
        <Legend />
      </div>

      <Card className="flex-1 min-h-0 overflow-hidden">
        <CardContent className="h-full p-0">
          {view === "month" && <MonthView cursor={cursor} eventsByDay={eventsByDay} onSelect={setSelected} />}
          {view === "week" && <WeekView cursor={cursor} eventsByDay={eventsByDay} onSelect={setSelected} />}
          {view === "day" && <DayView cursor={cursor} eventsByDay={eventsByDay} onSelect={setSelected} />}
        </CardContent>
      </Card>

      <EventDialog
        row={selected}
        onClose={() => setSelected(null)}
        onOpenInbox={(id) => {
          setSelected(null);
          navigate({ to: "/inbox", search: { id } });
        }}
      />
    </div>
  );
}

function eventClass(status: string | null) {
  if (isBookingStatus(status)) return STATUS_META[status].calendarClass;
  return "bg-gray-100 text-gray-800 border-gray-300";
}

function EventChip({ row, onClick }: { row: ConversationRow; onClick: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={cn(
        "w-full truncate rounded-md border px-1.5 py-0.5 text-left text-[11px] leading-tight transition-opacity hover:opacity-80",
        eventClass(row.status),
      )}
      title={`${row.booking_time ?? ""} ${row.area ?? ""} • ${row.people ?? "?"} people`}
    >
      <span className="font-medium">{row.booking_time?.slice(0, 5) ?? "—"}</span>{" "}
      {row.area ?? "—"} • {row.people ?? "?"}
    </button>
  );
}

function MonthView({
  cursor,
  eventsByDay,
  onSelect,
}: {
  cursor: Date;
  eventsByDay: Map<string, ConversationRow[]>;
  onSelect: (r: ConversationRow) => void;
}) {
  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });

  const days: Date[] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d);

  const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const today = new Date();

  return (
    <div className="flex h-full flex-col">
      <div className="grid grid-cols-7 border-b bg-muted/30 text-xs font-medium text-muted-foreground">
        {weekdayLabels.map((w) => (
          <div key={w} className="px-2 py-2">{w}</div>
        ))}
      </div>
      <div className="grid flex-1 grid-cols-7 grid-rows-6">
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const items = eventsByDay.get(key) ?? [];
          const inMonth = isSameMonth(day, cursor);
          const isToday = isSameDay(day, today);
          return (
            <div
              key={key}
              className={cn(
                "flex min-h-0 flex-col gap-1 border-b border-r p-1.5 overflow-hidden",
                !inMonth && "bg-muted/20 text-muted-foreground",
              )}
            >
              <div className="flex items-center justify-between">
                <span className={cn("text-xs", isToday && "inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground font-semibold")}>
                  {format(day, "d")}
                </span>
                {items.length > 3 && <span className="text-[10px] text-muted-foreground">+{items.length - 3}</span>}
              </div>
              <div className="flex flex-col gap-0.5 overflow-hidden">
                {items.slice(0, 3).map((r) => (
                  <EventChip key={String(r.id)} row={r} onClick={() => onSelect(r)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({
  cursor,
  eventsByDay,
  onSelect,
}: {
  cursor: Date;
  eventsByDay: Map<string, ConversationRow[]>;
  onSelect: (r: ConversationRow) => void;
}) {
  const start = startOfWeek(cursor, { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const today = new Date();

  return (
    <div className="grid h-full grid-cols-7 overflow-auto">
      {days.map((day) => {
        const key = format(day, "yyyy-MM-dd");
        const items = eventsByDay.get(key) ?? [];
        const isToday = isSameDay(day, today);
        return (
          <div key={key} className="flex min-h-0 flex-col border-r last:border-r-0">
            <div className={cn("border-b px-2 py-2 text-xs font-medium", isToday && "bg-primary/10 text-primary")}>
              <div>{format(day, "EEE")}</div>
              <div className="text-lg font-semibold text-foreground">{format(day, "d")}</div>
            </div>
            <div className="flex-1 space-y-1 overflow-y-auto p-2">
              {items.length === 0 && <p className="text-xs text-muted-foreground">No bookings</p>}
              {items.map((r) => <EventChip key={String(r.id)} row={r} onClick={() => onSelect(r)} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DayView({
  cursor,
  eventsByDay,
  onSelect,
}: {
  cursor: Date;
  eventsByDay: Map<string, ConversationRow[]>;
  onSelect: (r: ConversationRow) => void;
}) {
  const key = format(cursor, "yyyy-MM-dd");
  const items = eventsByDay.get(key) ?? [];
  const hours = Array.from({ length: 24 }, (_, i) => i);

  const byHour = new Map<number, ConversationRow[]>();
  for (const r of items) {
    const h = r.booking_time ? parseInt(r.booking_time.slice(0, 2), 10) : NaN;
    const bucket = isNaN(h) ? 0 : h;
    const arr = byHour.get(bucket) ?? [];
    arr.push(r);
    byHour.set(bucket, arr);
  }

  return (
    <div className="h-full overflow-y-auto">
      {hours.map((h) => {
        const arr = byHour.get(h) ?? [];
        return (
          <div key={h} className="flex border-b">
            <div className="w-16 shrink-0 border-r p-2 text-xs text-muted-foreground">
              {String(h).padStart(2, "0")}:00
            </div>
            <div className="flex-1 space-y-1 p-2">
              {arr.length === 0 ? (
                <div className="h-6" />
              ) : (
                arr.map((r) => (
                  <button
                    key={String(r.id)}
                    onClick={() => onSelect(r)}
                    className={cn(
                      "block w-full rounded-md border px-2 py-1.5 text-left text-sm hover:opacity-80",
                      eventClass(r.status),
                    )}
                  >
                    <span className="font-medium">{r.booking_time?.slice(0, 5) ?? "—"}</span>{" "}
                    {r.area ?? "—"} • {r.people ?? "?"} people
                  </button>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {(Object.keys(STATUS_META) as Array<keyof typeof STATUS_META>).map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span className={cn("inline-block h-2.5 w-2.5 rounded-full", STATUS_META[k].dotClass)} />
          <span className="text-muted-foreground">{STATUS_META[k].label}</span>
        </span>
      ))}
    </div>
  );
}

function EventDialog({
  row,
  onClose,
  onOpenInbox,
}: {
  row: ConversationRow | null;
  onClose: () => void;
  onOpenInbox: (id: string | number) => void;
}) {
  return (
    <Dialog open={!!row} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        {row && (
          <>
            <DialogHeader>
              <DialogTitle>{row.area ?? "Booking"} • {row.people ?? "?"} people</DialogTitle>
            </DialogHeader>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Field label="Phone" value={row.phone} />
              <Field label="Area" value={row.area} />
              <Field label="Date" value={row.booking_date} />
              <Field label="Time" value={row.booking_time} />
              <Field label="People" value={row.people != null ? String(row.people) : null} />
              <Field label="Status" value={statusLabel(row.status)} />
              <Field label="Mode" value={row.mode} />
            </dl>
            <div className="flex justify-end">
              <Button onClick={() => onOpenInbox(row.id)}>
                <MessageSquare className="mr-2 h-4 w-4" />
                Open in Inbox
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="rounded-md border p-2">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{value ?? "—"}</dd>
    </div>
  );
}

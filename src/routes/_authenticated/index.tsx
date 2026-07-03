import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  getConversations,
  BOOKING_STATUSES,
  type BookingStatus,
  type ConversationRow,
} from "@/lib/conversations.functions";
import { STATUS_META, isBookingStatus } from "@/lib/booking-status";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Inbox as InboxIcon,
  Clock3,
  ChefHat,
  CalendarCheck,
  CalendarClock,
  XCircle,
  Search,
  Bot,
  UserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "DashCook — Operations Dashboard" },
      { name: "description", content: "Operations dashboard for DashCook bookings." },
    ],
  }),
  component: DashboardPage,
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

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function DashboardPage() {
  const navigate = useNavigate();
  const listFn = useServerFn(getConversations);

  const listQuery = useQuery({
    queryKey: ["conversations"],
    queryFn: () => listFn(),
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
  });

  const rows: ConversationRow[] = listQuery.data?.rows ?? [];
  const today = todayStr();

  const kpis = useMemo(() => {
    const c = {
      new: 0,
      booking_pending: 0,
      cooking_confirmed: 0,
      today: 0,
      upcoming: 0,
      cancelled: 0,
    };
    for (const r of rows) {
      if (r.status === "new") c.new++;
      if (r.status === "booking_pending") c.booking_pending++;
      if (r.status === "cooking_confirmed") c.cooking_confirmed++;
      if (r.status === "cancelled") c.cancelled++;
      if (r.booking_date === today && r.status !== "cancelled") c.today++;
      if (
        r.booking_date &&
        r.booking_date >= today &&
        (r.status === "booking_pending" || r.status === "cooking_confirmed")
      ) {
        c.upcoming++;
      }
    }
    return c;
  }, [rows, today]);

  // Filters
  const [statusFilter, setStatusFilter] = useState<"all" | BookingStatus>("all");
  const [areaFilter, setAreaFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [search, setSearch] = useState("");

  const areas = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => r.area && set.add(r.area));
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (statusFilter !== "all" && r.status !== statusFilter) return false;
        if (areaFilter !== "all" && r.area !== areaFilter) return false;
        if (dateFrom && (!r.booking_date || r.booking_date < dateFrom)) return false;
        if (dateTo && (!r.booking_date || r.booking_date > dateTo)) return false;
        if (s) {
          const hay = `${r.phone ?? ""} ${r.area ?? ""}`.toLowerCase();
          if (!hay.includes(s)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const da = a.booking_date ?? "9999-99-99";
        const db = b.booking_date ?? "9999-99-99";
        if (da !== db) return da < db ? -1 : 1;
        const ta = a.booking_time ?? "99:99";
        const tb = b.booking_time ?? "99:99";
        return ta < tb ? -1 : ta > tb ? 1 : 0;
      });
  }, [rows, statusFilter, areaFilter, dateFrom, dateTo, search]);

  function openInInbox(id: string | number) {
    navigate({ to: "/inbox", search: { id } });
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-3 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Operations Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {listQuery.isFetching ? "Syncing…" : `Live from Supabase • ${rows.length} conversations`}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Kpi label="New Requests" value={kpis.new} icon={<InboxIcon className="h-4 w-4" />} tone="bg-muted text-muted-foreground" />
        <Kpi label="Booking Pending" value={kpis.booking_pending} icon={<Clock3 className="h-4 w-4" />} tone="bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-200" />
        <Kpi label="Cooking Confirmed" value={kpis.cooking_confirmed} icon={<ChefHat className="h-4 w-4" />} tone="bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-200" />
        <Kpi label="Today's Jobs" value={kpis.today} icon={<CalendarCheck className="h-4 w-4" />} tone="bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-200" />
        <Kpi label="Upcoming Jobs" value={kpis.upcoming} icon={<CalendarClock className="h-4 w-4" />} tone="bg-purple-100 text-purple-800 dark:bg-purple-500/20 dark:text-purple-200" />
        <Kpi label="Cancelled" value={kpis.cancelled} icon={<XCircle className="h-4 w-4" />} tone="bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200" />
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-muted-foreground">Search phone or area</label>
              <div className="relative mt-1">
                <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="e.g. +351… or Lisbon"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Status</label>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as "all" | BookingStatus)}>
                <SelectTrigger className="mt-1 w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {BOOKING_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Area</label>
              <Select value={areaFilter} onValueChange={setAreaFilter}>
                <SelectTrigger className="mt-1 w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All areas</SelectItem>
                  {areas.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">From</label>
              <Input type="date" className="mt-1 w-[160px]" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">To</label>
              <Input type="date" className="mt-1 w-[160px]" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            {(statusFilter !== "all" || areaFilter !== "all" || dateFrom || dateTo || search) && (
              <Button variant="ghost" size="sm" onClick={() => { setStatusFilter("all"); setAreaFilter("all"); setDateFrom(""); setDateTo(""); setSearch(""); }}>
                Clear
              </Button>
            )}
          </div>

          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Area</TableHead>
                  <TableHead className="text-right">People</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Mode</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      No bookings match the current filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((r) => (
                    <TableRow
                      key={String(r.id)}
                      className="cursor-pointer"
                      onClick={() => openInInbox(r.id)}
                    >
                      <TableCell className="font-medium">{r.booking_date ?? "—"}</TableCell>
                      <TableCell>{r.booking_time ?? "—"}</TableCell>
                      <TableCell>{r.area ?? "—"}</TableCell>
                      <TableCell className="text-right">{r.people ?? "—"}</TableCell>
                      <TableCell>{r.phone ?? "—"}</TableCell>
                      <TableCell><StatusBadge status={r.status} /></TableCell>
                      <TableCell><ModeBadge mode={r.mode} /></TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ label, value, icon, tone }: { label: string; value: number; icon: React.ReactNode; tone: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          <span className={cn("inline-flex h-7 w-7 items-center justify-center rounded-md", tone)}>{icon}</span>
        </div>
        <div className="mt-2 text-3xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (!isBookingStatus(status)) {
    return <Badge variant="outline">{status ?? "—"}</Badge>;
  }
  const m = STATUS_META[status];
  return (
    <Badge className={cn("border", m.badgeClass)}>
      <span className={cn("mr-1.5 inline-block h-1.5 w-1.5 rounded-full", m.dotClass)} />
      {m.label}
    </Badge>
  );
}

function ModeBadge({ mode }: { mode: string | null }) {
  const isHuman = mode === "human";
  return (
    <Badge variant={isHuman ? "default" : "secondary"} className="capitalize">
      {isHuman ? <UserRound className="mr-1 h-3 w-3" /> : <Bot className="mr-1 h-3 w-3" />}
      {mode ?? "—"}
    </Badge>
  );
}

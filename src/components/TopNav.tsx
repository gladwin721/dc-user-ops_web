import { Link } from "@tanstack/react-router";
import { LayoutDashboard, CalendarDays, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/inbox", label: "Inbox", icon: Inbox },
] as const;

export function TopNav() {
  return (
    <nav className="flex h-12 shrink-0 items-center gap-1 border-b bg-background px-4">
      <div className="mr-4 flex items-center gap-2 text-sm font-semibold">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground text-[11px] font-bold">
          DC
        </span>
        DashCook Ops
      </div>
      {items.map((it) => {
        const Icon = it.icon;
        return (
          <Link
            key={it.to}
            to={it.to}
            activeOptions={{ exact: it.to === "/" }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors",
            )}
            activeProps={{ className: "bg-muted text-foreground font-medium" }}
          >
            <Icon className="h-4 w-4" />
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}

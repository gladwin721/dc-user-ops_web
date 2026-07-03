import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard, CalendarDays, Inbox, LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const items = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/inbox", label: "Inbox", icon: Inbox },
] as const;

export function TopNav() {
  const navigate = useNavigate();
  const router = useRouter();
  const qc = useQueryClient();
  const [email, setEmail] = useState<string | null>(null);
  const [hasUser, setHasUser] = useState(false);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!mounted) return;
      setEmail(data.user?.email ?? null);
      setHasUser(!!data.user);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setEmail(session?.user?.email ?? null);
      setHasUser(!!session?.user);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    await router.invalidate();
    navigate({ to: "/auth", replace: true });
  }

  if (!hasUser) return null;

  return (
    <nav className="flex h-12 shrink-0 items-center gap-1 border-b bg-background px-2 sm:px-4">
      <div className="mr-1 flex items-center gap-2 text-sm font-semibold sm:mr-4">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground text-[11px] font-bold">
          DC
        </span>
        <span className="hidden sm:inline">DashCook Ops</span>
      </div>
      {items.map((it) => {
        const Icon = it.icon;
        return (
          <Link
            key={it.to}
            to={it.to}
            activeOptions={{ exact: it.to === "/" }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors sm:px-3",
            )}
            activeProps={{ className: "bg-muted text-foreground font-medium" }}
          >
            <Icon className="h-4 w-4" />
            <span className="hidden sm:inline">{it.label}</span>
          </Link>
        );
      })}
      <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
        {email && <span className="hidden md:inline">{email}</span>}
        <Button size="sm" variant="ghost" onClick={signOut} className="px-2 sm:px-3">
          <LogOut className="h-3.5 w-3.5 sm:mr-1" />
          <span className="hidden sm:inline">Sign out</span>
        </Button>
      </div>
    </nav>
  );
}

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
      <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
        {email && <span className="hidden sm:inline">{email}</span>}
        <Button size="sm" variant="ghost" onClick={signOut}>
          <LogOut className="mr-1 h-3.5 w-3.5" />
          Sign out
        </Button>
      </div>
    </nav>
  );
}

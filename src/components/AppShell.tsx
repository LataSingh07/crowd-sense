import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, Camera, Bell, Settings, LogOut, Activity, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

const nav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, adminOnly: false },
  { to: "/cameras", label: "Cameras", icon: Camera, adminOnly: false },
  { to: "/alerts", label: "Alerts", icon: Bell, adminOnly: false },
  { to: "/analytics", label: "Analytics", icon: Activity, adminOnly: false },
  { to: "/users", label: "Users", icon: Users, adminOnly: true },
  { to: "/settings", label: "Settings", icon: Settings, adminOnly: false },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut, isAdmin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/login" });
  };

  return (
    <div className="flex min-h-screen w-full bg-background">
      <aside className="hidden md:flex w-64 flex-col border-r bg-sidebar text-sidebar-foreground">
        <div className="flex h-16 items-center gap-2 border-b px-5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">SmartCrowd</p>
            <p className="text-[11px] text-muted-foreground">AI Crowd Monitoring</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {nav
            .filter((n) => !n.adminOnly || isAdmin)
            .map((n) => {
              const active = location.pathname.startsWith(n.to);
              const Icon = n.icon;
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-sidebar-foreground hover:bg-sidebar-accent",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {n.label}
                </Link>
              );
            })}
        </nav>
        <div className="border-t p-3">
          <div className="mb-2 rounded-lg bg-secondary px-3 py-2">
            <p className="truncate text-xs font-medium">{user?.email}</p>
            <p className="text-[11px] text-muted-foreground">{isAdmin ? "Admin" : "Authority"}</p>
          </div>
          <Button onClick={handleSignOut} variant="outline" size="sm" className="w-full">
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-x-hidden">
        {/* Mobile top bar */}
        <header className="md:hidden sticky top-0 z-10 flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground">
              <Activity className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold">SmartCrowd</span>
          </div>
          <Button onClick={handleSignOut} variant="ghost" size="sm">
            <LogOut className="h-4 w-4" />
          </Button>
        </header>
        {/* Mobile nav */}
        <nav className="md:hidden flex gap-1 overflow-x-auto border-b bg-card px-3 py-2">
          {nav.filter((n) => !n.adminOnly || isAdmin).map((n) => {
            const active = location.pathname.startsWith(n.to);
            const Icon = n.icon;
            return (
              <Link
                key={n.to}
                to={n.to}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {n.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 md:p-8">{children}</div>
      </main>
    </div>
  );
}

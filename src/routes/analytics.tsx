import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppShell } from "@/components/AppShell";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { useMemo } from "react";

export const Route = createFileRoute("/analytics")({
  component: () => (
    <ProtectedRoute>
      <AppShell>
        <AnalyticsPage />
      </AppShell>
    </ProtectedRoute>
  ),
});

function AnalyticsPage() {
  const readingsQ = useQuery({
    queryKey: ["readings-all-7d"],
    queryFn: async () => {
      const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const { data, error } = await supabase
        .from("crowd_readings")
        .select("people_count, recorded_at, camera_id, cameras(name)")
        .gt("recorded_at", since)
        .order("recorded_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const alertsQ = useQuery({
    queryKey: ["alerts-7d"],
    queryFn: async () => {
      const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const { data, error } = await supabase
        .from("alerts")
        .select("severity, created_at")
        .gt("created_at", since);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Group readings by day -> avg + max
  const dailyData = useMemo(() => {
    const buckets = new Map<string, { day: string; avg: number; max: number; n: number; sum: number }>();
    for (const r of readingsQ.data ?? []) {
      const day = new Date(r.recorded_at).toLocaleDateString([], { month: "short", day: "numeric" });
      const b = buckets.get(day) ?? { day, avg: 0, max: 0, n: 0, sum: 0 };
      b.n += 1;
      b.sum += r.people_count;
      b.max = Math.max(b.max, r.people_count);
      b.avg = Math.round(b.sum / b.n);
      buckets.set(day, b);
    }
    return [...buckets.values()];
  }, [readingsQ.data]);

  const alertCounts = useMemo(() => {
    const buckets = new Map<string, { day: string; moderate: number; danger: number }>();
    for (const a of alertsQ.data ?? []) {
      const day = new Date(a.created_at).toLocaleDateString([], { month: "short", day: "numeric" });
      const b = buckets.get(day) ?? { day, moderate: 0, danger: 0 };
      if (a.severity === "danger") b.danger += 1;
      else b.moderate += 1;
      buckets.set(day, b);
    }
    return [...buckets.values()];
  }, [alertsQ.data]);

  const totalReadings = readingsQ.data?.length ?? 0;
  const totalAlerts = alertsQ.data?.length ?? 0;
  const peak = dailyData.reduce((m, d) => Math.max(m, d.max), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Analytics</h1>
        <p className="text-sm text-muted-foreground">7-day historical trends across all cameras.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Readings (7d)</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">{totalReadings}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Alerts (7d)</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">{totalAlerts}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Peak count</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">{peak}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle>Daily crowd: average vs peak</CardTitle></CardHeader>
        <CardContent>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="day" stroke="var(--color-muted-foreground)" fontSize={11} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={11} />
                <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8 }} />
                <Legend />
                <Bar dataKey="avg" fill="var(--color-primary)" radius={[4, 4, 0, 0]} name="Average" />
                <Bar dataKey="max" fill="var(--color-chart-5)" radius={[4, 4, 0, 0]} name="Peak" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle>Alerts by day & severity</CardTitle></CardHeader>
        <CardContent>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={alertCounts}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="day" stroke="var(--color-muted-foreground)" fontSize={11} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={11} />
                <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8 }} />
                <Legend />
                <Bar dataKey="moderate" stackId="a" fill="var(--color-moderate)" name="Moderate" />
                <Bar dataKey="danger" stackId="a" fill="var(--color-danger)" name="Danger" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

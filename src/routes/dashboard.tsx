import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppShell } from "@/components/AppShell";
import { LiveDetection } from "@/components/LiveDetection";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { classifyStatus, statusClass, statusLabel, type CrowdStatus, linearForecast } from "@/lib/density";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip as ReTooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { Users, Gauge, AlertTriangle, MapPin, Smartphone, Copy } from "lucide-react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { QRCodeSVG } from "qrcode.react";

export const Route = createFileRoute("/dashboard")({
  component: () => (
    <ProtectedRoute>
      <AppShell>
        <DashboardPage />
      </AppShell>
    </ProtectedRoute>
  ),
});

interface Camera {
  id: string;
  name: string;
  location: string;
  area_sqm: number;
  threshold_moderate: number;
  threshold_danger: number;
  active: boolean;
}

function DashboardPage() {
  const qc = useQueryClient();

  const camerasQ = useQuery({
    queryKey: ["cameras"],
    queryFn: async () => {
      const { data, error } = await supabase.from("cameras").select("*").eq("active", true).order("created_at");
      if (error) throw error;
      return (data ?? []) as Camera[];
    },
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedId && camerasQ.data && camerasQ.data.length > 0) setSelectedId(camerasQ.data[0].id);
  }, [camerasQ.data, selectedId]);

  const camera = camerasQ.data?.find((c) => c.id === selectedId);

  // Recent readings for trend
  const readingsQ = useQuery({
    queryKey: ["readings", selectedId],
    enabled: !!selectedId,
    refetchInterval: 5000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crowd_readings")
        .select("people_count, recorded_at")
        .eq("camera_id", selectedId!)
        .order("recorded_at", { ascending: false })
        .limit(40);
      if (error) throw error;
      return (data ?? []).reverse();
    },
  });

  // Recent alerts
  const alertsQ = useQuery({
    queryKey: ["alerts-recent"],
    refetchInterval: 5000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alerts")
        .select("id, severity, message, people_count, created_at, camera_id, cameras(name)")
        .order("created_at", { ascending: false })
        .limit(8);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Realtime subscribe to new alerts
  useEffect(() => {
    const channel = supabase
      .channel("alerts-feed")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "alerts" }, (payload) => {
        const a = payload.new as { severity: string; message: string };
        if (a.severity === "danger") toast.error(a.message);
        else toast.warning(a.message);
        qc.invalidateQueries({ queryKey: ["alerts-recent"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);

  // Persist a reading every ~3 seconds via the backend (which also auto-creates alerts)
  const lastSavedRef = useRef(0);
  const lastStatusRef = useRef<CrowdStatus>("safe");

  const handleReading = async (r: { count: number; status: CrowdStatus; density: number }) => {
    if (!camera) return;
    const now = Date.now();
    const statusChanged = lastStatusRef.current !== r.status;
    // Send immediately on status change, otherwise throttle to every 3s
    if (!statusChanged && now - lastSavedRef.current < 3000) return;
    lastSavedRef.current = now;
    const previousStatus = lastStatusRef.current;
    lastStatusRef.current = r.status;

    try {
      const supabaseUrl = (import.meta as { env: Record<string, string> }).env.VITE_SUPABASE_URL;
      const publishable = (import.meta as { env: Record<string, string> }).env.VITE_SUPABASE_PUBLISHABLE_KEY;
      // Use apikey only (no session JWT) — function is verify_jwt=false and the
      // gateway rejects ES256 user JWTs.
      const res = await fetch(`${supabaseUrl}/functions/v1/record-reading`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: publishable },
        body: JSON.stringify({
          cameraId: camera.id,
          count: r.count,
          density: r.density,
          status: r.status,
          previousStatus,
        }),
      });
      if (!res.ok) console.error("record-reading error", res.status, await res.text());
      qc.invalidateQueries({ queryKey: ["readings", camera.id] });
    } catch (e) {
      console.error("record-reading failed", e);
    }
  };

  const chartData = useMemo(() => {
    const rows = readingsQ.data ?? [];
    const base = rows.map((r) => ({
      t: new Date(r.recorded_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      count: r.people_count,
      forecast: undefined as number | undefined,
    }));
    if (base.length >= 2) {
      const fc = linearForecast(base.map((b) => b.count), 5);
      const last = base[base.length - 1];
      base[base.length - 1] = { ...last, forecast: last.count };
      fc.forEach((v, i) => base.push({ t: `+${i + 1}`, count: NaN as unknown as number, forecast: v }));
    }
    return base;
  }, [readingsQ.data]);

  const currentCount = (readingsQ.data ?? []).at(-1)?.people_count ?? 0;
  const currentStatus: CrowdStatus = camera
    ? classifyStatus(currentCount, camera.threshold_moderate, camera.threshold_danger)
    : "safe";

  if (camerasQ.isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>;

  if (!camerasQ.data || camerasQ.data.length === 0) {
    return (
      <div className="rounded-2xl border bg-card p-10 text-center">
        <h2 className="text-xl font-semibold">No cameras yet</h2>
        <p className="mt-2 text-sm text-muted-foreground">Add your first camera to start monitoring.</p>
        <Link to="/cameras"><Button className="mt-4">Manage cameras</Button></Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Live monitoring</h1>
          <p className="text-sm text-muted-foreground">Real-time crowd detection and alerts.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Camera:</span>
          <Select value={selectedId ?? ""} onValueChange={setSelectedId}>
            <SelectTrigger className="w-[240px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {camerasQ.data.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name} — {c.location}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard icon={Users} label="People detected" value={String(currentCount)} hint="Latest reading" />
        <StatCard
          icon={Gauge}
          label="Density"
          value={camera ? `${(currentCount / camera.area_sqm).toFixed(2)}` : "—"}
          hint="people / m²"
        />
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Status</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="outline" className={`${statusClass(currentStatus)} px-3 py-1 text-sm`}>
              ● {statusLabel(currentStatus)}
            </Badge>
            <p className="mt-2 text-xs text-muted-foreground">
              Mod ≥ {camera?.threshold_moderate} • Danger ≥ {camera?.threshold_danger}
            </p>
          </CardContent>
        </Card>
        <StatCard
          icon={MapPin}
          label="Location"
          value={camera?.location ?? "—"}
          hint={camera ? `${camera.area_sqm} m² area` : ""}
        />
      </div>

      {/* Live + chart */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3"><CardTitle>Live feed — {camera?.name}</CardTitle></CardHeader>
          <CardContent>
            {camera && <LiveDetection camera={camera} onReading={handleReading} />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Recent alerts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(alertsQ.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">No alerts yet.</p>
            )}
            {(alertsQ.data ?? []).map((a) => (
              <div key={a.id} className="flex items-start gap-2 rounded-lg border p-2.5">
                <AlertTriangle
                  className={`h-4 w-4 mt-0.5 ${a.severity === "danger" ? "text-danger" : "text-moderate"}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{a.message}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {new Date(a.created_at).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
            <Link to="/alerts"><Button variant="ghost" size="sm" className="w-full">View all</Button></Link>
          </CardContent>
        </Card>
      </div>

      {/* Trend */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>People-count trend & forecast</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="cnt" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="t" stroke="var(--color-muted-foreground)" fontSize={11} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={11} />
                <ReTooltip
                  contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }}
                />
                {camera && (
                  <>
                    <ReferenceLine y={camera.threshold_moderate} stroke="var(--color-moderate)" strokeDasharray="4 4" />
                    <ReferenceLine y={camera.threshold_danger} stroke="var(--color-danger)" strokeDasharray="4 4" />
                  </>
                )}
                <Area type="monotone" dataKey="count" stroke="var(--color-primary)" fill="url(#cnt)" strokeWidth={2} />
                <Area type="monotone" dataKey="forecast" stroke="var(--color-chart-5)" strokeDasharray="4 4" fill="none" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, hint }: { icon: typeof Users; label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Icon className="h-3.5 w-3.5" /> {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold">{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

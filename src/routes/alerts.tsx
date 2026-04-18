import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppShell } from "@/components/AppShell";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Check } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/alerts")({
  component: () => (
    <ProtectedRoute>
      <AppShell>
        <AlertsPage />
      </AppShell>
    </ProtectedRoute>
  ),
});

function AlertsPage() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["alerts-all"],
    refetchInterval: 5000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alerts")
        .select("id, severity, message, people_count, acknowledged, created_at, cameras(name, location)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const ack = async (id: string) => {
    const { error } = await supabase.from("alerts").update({ acknowledged: true }).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["alerts-all"] });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Alert history</h1>
        <p className="text-sm text-muted-foreground">All overcrowding events across your cameras.</p>
      </div>
      <Card>
        <CardHeader className="pb-3"><CardTitle>Alerts</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Camera</TableHead>
                <TableHead>People</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>Status</TableHead>
                {isAdmin && <TableHead></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(q.data ?? []).map((a) => {
                const cam = a.cameras as { name: string; location: string } | null;
                return (
                  <TableRow key={a.id}>
                    <TableCell className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString()}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={a.severity === "danger" ? "status-danger" : "status-moderate"}>
                        {a.severity}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{cam?.name ?? "—"}<br/><span className="text-xs text-muted-foreground">{cam?.location}</span></TableCell>
                    <TableCell className="font-semibold">{a.people_count}</TableCell>
                    <TableCell className="text-sm">{a.message}</TableCell>
                    <TableCell>
                      {a.acknowledged ? (
                        <Badge variant="secondary"><Check className="h-3 w-3 mr-1" /> Ack</Badge>
                      ) : (
                        <Badge variant="outline">Open</Badge>
                      )}
                    </TableCell>
                    {isAdmin && (
                      <TableCell>
                        {!a.acknowledged && (
                          <Button size="sm" variant="ghost" onClick={() => ack(a.id)}>Acknowledge</Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
              {(q.data ?? []).length === 0 && (
                <TableRow><TableCell colSpan={isAdmin ? 7 : 6} className="py-8 text-center text-sm text-muted-foreground">No alerts.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

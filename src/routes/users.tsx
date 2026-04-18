import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppShell } from "@/components/AppShell";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/users")({
  component: () => (
    <ProtectedRoute adminOnly>
      <AppShell>
        <UsersPage />
      </AppShell>
    </ProtectedRoute>
  ),
});

interface ProfileRow {
  id: string;
  email: string | null;
  full_name: string | null;
  created_at: string;
}

function UsersPage() {
  const qc = useQueryClient();
  const profilesQ = useQuery({
    queryKey: ["profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").order("created_at");
      if (error) throw error;
      return (data ?? []) as ProfileRow[];
    },
  });
  const rolesQ = useQuery({
    queryKey: ["all-roles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("user_roles").select("user_id, role");
      if (error) throw error;
      return data ?? [];
    },
  });

  const rolesFor = (uid: string) => (rolesQ.data ?? []).filter((r) => r.user_id === uid).map((r) => r.role);

  const promote = async (uid: string) => {
    const { error } = await supabase.from("user_roles").insert({ user_id: uid, role: "admin" });
    if (error) return toast.error(error.message);
    toast.success("Promoted to admin");
    qc.invalidateQueries({ queryKey: ["all-roles"] });
  };

  const demote = async (uid: string) => {
    const { error } = await supabase.from("user_roles").delete().eq("user_id", uid).eq("role", "admin");
    if (error) return toast.error(error.message);
    toast.success("Admin role removed");
    qc.invalidateQueries({ queryKey: ["all-roles"] });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Users</h1>
        <p className="text-sm text-muted-foreground">Manage roles for everyone in the system.</p>
      </div>
      <Card>
        <CardHeader className="pb-3"><CardTitle>All users</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(profilesQ.data ?? []).map((p) => {
                const roles = rolesFor(p.id);
                const isAdmin = roles.includes("admin");
                return (
                  <TableRow key={p.id}>
                    <TableCell>{p.full_name || "—"}</TableCell>
                    <TableCell className="text-sm">{p.email}</TableCell>
                    <TableCell className="space-x-1">
                      {roles.map((r) => <Badge key={r} variant={r === "admin" ? "default" : "secondary"}>{r}</Badge>)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(p.created_at).toLocaleDateString()}</TableCell>
                    <TableCell>
                      {isAdmin ? (
                        <Button size="sm" variant="ghost" onClick={() => demote(p.id)}>Remove admin</Button>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => promote(p.id)}>Make admin</Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

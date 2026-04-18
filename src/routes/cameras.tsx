import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppShell } from "@/components/AppShell";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, MapPin } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/cameras")({
  component: () => (
    <ProtectedRoute>
      <AppShell>
        <CamerasPage />
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

function CamerasPage() {
  const { isAdmin, user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const camsQ = useQuery({
    queryKey: ["cameras-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("cameras").select("*").order("created_at");
      if (error) throw error;
      return (data ?? []) as Camera[];
    },
  });

  const [form, setForm] = useState({
    name: "", location: "", area_sqm: 50, threshold_moderate: 15, threshold_danger: 30,
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from("cameras").insert({
      ...form,
      created_by: user?.id,
    });
    if (error) return toast.error(error.message);
    toast.success("Camera added");
    setOpen(false);
    setForm({ name: "", location: "", area_sqm: 50, threshold_moderate: 15, threshold_danger: 30 });
    qc.invalidateQueries({ queryKey: ["cameras-all"] });
    qc.invalidateQueries({ queryKey: ["cameras"] });
  };

  const toggleActive = async (c: Camera) => {
    const { error } = await supabase.from("cameras").update({ active: !c.active }).eq("id", c.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["cameras-all"] });
    qc.invalidateQueries({ queryKey: ["cameras"] });
  };

  const remove = async (c: Camera) => {
    if (!confirm(`Delete ${c.name}? This removes all readings & alerts.`)) return;
    const { error } = await supabase.from("cameras").delete().eq("id", c.id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    qc.invalidateQueries({ queryKey: ["cameras-all"] });
    qc.invalidateQueries({ queryKey: ["cameras"] });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Cameras</h1>
          <p className="text-sm text-muted-foreground">Manage your monitoring locations and thresholds.</p>
        </div>
        {isAdmin && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-1.5" /> Add camera</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add camera</DialogTitle></DialogHeader>
              <form onSubmit={submit} className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Location</Label>
                  <Input required value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label>Area (m²)</Label>
                    <Input type="number" min={1} value={form.area_sqm} onChange={(e) => setForm({ ...form, area_sqm: Number(e.target.value) })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Moderate ≥</Label>
                    <Input type="number" min={1} value={form.threshold_moderate} onChange={(e) => setForm({ ...form, threshold_moderate: Number(e.target.value) })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Danger ≥</Label>
                    <Input type="number" min={1} value={form.threshold_danger} onChange={(e) => setForm({ ...form, threshold_danger: Number(e.target.value) })} />
                  </div>
                </div>
                <Button type="submit" className="w-full">Create</Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {camsQ.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {camsQ.data && camsQ.data.length === 0 && (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          No cameras yet. {isAdmin ? "Add your first one." : "Ask an admin to add cameras."}
        </CardContent></Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {(camsQ.data ?? []).map((c) => (
          <Card key={c.id}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-base">{c.name}</CardTitle>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3" /> {c.location}
                  </p>
                </div>
                {isAdmin && (
                  <Switch checked={c.active} onCheckedChange={() => toggleActive(c)} />
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-md bg-secondary p-2">
                  <p className="text-muted-foreground">Area</p>
                  <p className="font-semibold">{c.area_sqm} m²</p>
                </div>
                <div className="rounded-md bg-secondary p-2">
                  <p className="text-muted-foreground">Moderate</p>
                  <p className="font-semibold">{c.threshold_moderate}</p>
                </div>
                <div className="rounded-md bg-secondary p-2">
                  <p className="text-muted-foreground">Danger</p>
                  <p className="font-semibold">{c.threshold_danger}</p>
                </div>
              </div>
              {isAdmin && (
                <Button variant="ghost" size="sm" className="mt-3 w-full text-danger hover:text-danger" onClick={() => remove(c)}>
                  <Trash2 className="h-4 w-4 mr-1.5" /> Delete
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

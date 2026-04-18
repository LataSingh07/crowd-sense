import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppShell } from "@/components/AppShell";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getDetectorConfig, setDetectorConfig, type DetectorConfig } from "@/lib/detector";
import { toast } from "sonner";

export const Route = createFileRoute("/settings")({
  component: () => (
    <ProtectedRoute>
      <AppShell>
        <SettingsPage />
      </AppShell>
    </ProtectedRoute>
  ),
});

function SettingsPage() {
  const [cfg, setCfg] = useState<DetectorConfig | null>(null);

  useEffect(() => { setCfg(getDetectorConfig()); }, []);

  if (!cfg) return null;

  const save = () => {
    setDetectorConfig(cfg);
    toast.success("Detector settings saved");
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">Configure the person-detection backend.</p>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle>Detector backend</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Mode</Label>
            <Select value={cfg.mode} onValueChange={(v) => setCfg({ ...cfg, mode: v as DetectorConfig["mode"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="simulator">Simulator (built-in, no backend)</SelectItem>
                <SelectItem value="lovable-ai">Lovable AI vision (server-side, recommended)</SelectItem>
                <SelectItem value="remote">Remote API (your YOLO/FastAPI server)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              <strong>Simulator</strong>: fake boxes for testing.{" "}
              <strong>Lovable AI</strong>: real person detection on the server using Gemini vision — no setup.{" "}
              <strong>Remote</strong>: your own YOLO/FastAPI server.
            </p>
          </div>

          {cfg.mode === "remote" && (
            <>
              <div className="space-y-1.5">
                <Label>Endpoint URL</Label>
                <Input
                  placeholder="https://your-api.example.com/detect"
                  value={cfg.remoteUrl}
                  onChange={(e) => setCfg({ ...cfg, remoteUrl: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Must accept POST multipart/form-data with field <code>image</code> and return JSON
                  <code> {`{ boxes: [{ x, y, w, h, score }] }`} </code> — coords either pixels or 0..1 normalized.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>API key (optional)</Label>
                <Input
                  type="password"
                  placeholder="Sent as Authorization: Bearer …"
                  value={cfg.apiKey ?? ""}
                  onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })}
                />
              </div>
            </>
          )}

          {cfg.mode === "simulator" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Avg. people</Label>
                <Input type="number" min={0} value={cfg.simBaseCount} onChange={(e) => setCfg({ ...cfg, simBaseCount: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label>Variance ±</Label>
                <Input type="number" min={0} value={cfg.simVariance} onChange={(e) => setCfg({ ...cfg, simVariance: Number(e.target.value) })} />
              </div>
            </div>
          )}

          <Button onClick={save}>Save</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle>Hosting your own YOLO backend</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            SmartCrowd's detection layer is pluggable. To use real YOLOv8 + OpenCV, host a tiny FastAPI service
            on any machine with Python and point this app at it via the URL above.
          </p>
          <pre className="overflow-x-auto rounded-md bg-secondary p-3 text-xs text-foreground">{`# /ai-module/server.py
from fastapi import FastAPI, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from ultralytics import YOLO
import cv2, numpy as np

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
model = YOLO("yolov8n.pt")  # downloads first run

@app.post("/detect")
async def detect(image: UploadFile):
    buf = np.frombuffer(await image.read(), np.uint8)
    img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    res = model(img, classes=[0], verbose=False)[0]   # 0 = person
    boxes = []
    for b in res.boxes.xyxy.cpu().numpy():
        x1,y1,x2,y2 = b
        boxes.append({"x": float(x1), "y": float(y1), "w": float(x2-x1), "h": float(y2-y1), "score": 1.0})
    return {"boxes": boxes}
# run:  pip install fastapi uvicorn ultralytics opencv-python python-multipart
#       uvicorn server:app --host 0.0.0.0 --port 8000`}</pre>
          <p>Then set Mode → Remote and paste <code>http://your-host:8000/detect</code>.</p>
        </CardContent>
      </Card>
    </div>
  );
}

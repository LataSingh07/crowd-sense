import { useEffect, useRef, useState } from "react";
import { detectFrame, type DetectionBox, getDetectorConfig } from "@/lib/detector";
import { classifyStatus, statusClass, statusLabel, type CrowdStatus } from "@/lib/density";
import { Button } from "@/components/ui/button";
import { Camera, Upload, Pause, Play, Square, Film } from "lucide-react";
import { cn } from "@/lib/utils";

// Bundled sample video served from the app's own origin (avoids CORS / canvas-taint issues).
const DEMO_VIDEO_URL = "/demo/sample-crowd.mp4";

interface CameraConfig {
  id: string;
  name: string;
  threshold_moderate: number;
  threshold_danger: number;
  area_sqm: number;
}

interface Props {
  camera: CameraConfig;
  onReading?: (r: { count: number; status: CrowdStatus; density: number }) => void;
  showHeatmap?: boolean;
}

const HEATMAP_DECAY = 0.92;

export function LiveDetection({ camera, onReading, showHeatmap = true }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const heatRef = useRef<HTMLCanvasElement>(null);
  const heatBufferRef = useRef<Float32Array | null>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [running, setRunning] = useState(false);
  const [source, setSource] = useState<"webcam" | "upload" | "demo" | null>(null);
  const [demoLoading, setDemoLoading] = useState(false);
  const [count, setCount] = useState(0);
  const [status, setStatus] = useState<CrowdStatus>("safe");
  const [mode] = useState(() => getDetectorConfig().mode);

  const stop = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
      videoRef.current.removeAttribute("src");
      videoRef.current.load();
    }
    setRunning(false);
    setSource(null);
  };

  useEffect(() => () => stop(), []);

  const startWebcam = async () => {
    stop();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setSource("webcam");
      setRunning(true);
    } catch (e) {
      console.error(e);
      // Fallback: still let simulator render onto a black canvas
      setSource("webcam");
      setRunning(true);
    }
  };

  const startDemo = async () => {
    stop();
    setDemoLoading(true);
    try {
      if (videoRef.current) {
        videoRef.current.crossOrigin = "anonymous";
        videoRef.current.src = DEMO_VIDEO_URL;
        videoRef.current.loop = true;
        await videoRef.current.play();
      }
      setSource("demo");
      setRunning(true);
    } catch (e) {
      console.error("demo video failed", e);
    } finally {
      setDemoLoading(false);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    stop();
    if (videoRef.current) {
      videoRef.current.src = URL.createObjectURL(file);
      videoRef.current.loop = true;
      await videoRef.current.play();
    }
    setSource("upload");
    setRunning(true);
  };

  // Detection loop
  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    let lastReport = 0;

    const loop = async () => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      // Draw video frame (or dark backdrop if no video)
      if (video.videoWidth > 0) {
        ctx.drawImage(video, 0, 0, w, h);
      } else {
        ctx.fillStyle = "#0f172a";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.font = "14px sans-serif";
        ctx.fillText("Simulated feed", 16, 28);
      }

      let result;
      try {
        result = await detectFrame(video, w, h);
      } catch (err) {
        console.error("detect error", err);
        result = { boxes: [], count: 0 };
      }

      // Update heatmap buffer (low-res)
      if (showHeatmap) {
        const HW = 64, HH = 36;
        if (!heatBufferRef.current || heatBufferRef.current.length !== HW * HH) {
          heatBufferRef.current = new Float32Array(HW * HH);
        }
        const buf = heatBufferRef.current;
        for (let i = 0; i < buf.length; i++) buf[i] *= HEATMAP_DECAY;
        for (const b of result.boxes) {
          const cx = Math.floor(((b.x + b.w / 2) / w) * HW);
          const cy = Math.floor(((b.y + b.h / 2) / h) * HH);
          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              const x = cx + dx, y = cy + dy;
              if (x < 0 || x >= HW || y < 0 || y >= HH) continue;
              const d = Math.sqrt(dx * dx + dy * dy);
              buf[y * HW + x] += Math.max(0, 1 - d / 3) * 0.5;
            }
          }
        }
        const heat = heatRef.current;
        if (heat) {
          if (heat.width !== HW) heat.width = HW;
          if (heat.height !== HH) heat.height = HH;
          const hctx = heat.getContext("2d");
          if (hctx) {
            const img = hctx.createImageData(HW, HH);
            for (let i = 0; i < buf.length; i++) {
              const v = Math.min(1, buf[i] / 3);
              // gradient: blue -> green -> yellow -> red
              const r = v < 0.5 ? Math.round(v * 2 * 255) : 255;
              const g = v < 0.5 ? 255 : Math.round((1 - (v - 0.5) * 2) * 255);
              const b = v < 0.25 ? 255 : 0;
              img.data[i * 4] = r;
              img.data[i * 4 + 1] = g;
              img.data[i * 4 + 2] = b;
              img.data[i * 4 + 3] = Math.round(v * 160);
            }
            hctx.putImageData(img, 0, 0);
          }
        }
      }

      // Draw boxes
      const newStatus = classifyStatus(result.count, camera.threshold_moderate, camera.threshold_danger);
      const boxColor =
        newStatus === "danger" ? "#ef4444" : newStatus === "moderate" ? "#f59e0b" : "#22c55e";
      ctx.lineWidth = 2;
      ctx.strokeStyle = boxColor;
      ctx.fillStyle = boxColor;
      ctx.font = "11px sans-serif";
      result.boxes.forEach((b: DetectionBox, i) => {
        ctx.strokeRect(b.x, b.y, b.w, b.h);
        ctx.fillRect(b.x, b.y - 14, 38, 12);
        ctx.fillStyle = "#fff";
        ctx.fillText(`p${i + 1}`, b.x + 4, b.y - 4);
        ctx.fillStyle = boxColor;
      });

      setCount(result.count);
      setStatus(newStatus);

      // Report every ~1s
      const now = performance.now();
      if (onReading && now - lastReport > 1000) {
        lastReport = now;
        onReading({
          count: result.count,
          status: newStatus,
          density: camera.area_sqm > 0 ? result.count / camera.area_sqm : 0,
        });
      }

      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [running, camera.threshold_moderate, camera.threshold_danger, camera.area_sqm, onReading, showHeatmap]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={startWebcam} variant={source === "webcam" ? "default" : "outline"} size="sm">
          <Camera className="h-4 w-4 mr-1.5" /> Webcam
        </Button>
        <Button
          onClick={startDemo}
          variant={source === "demo" ? "default" : "outline"}
          size="sm"
          disabled={demoLoading}
        >
          <Film className="h-4 w-4 mr-1.5" />
          {demoLoading ? "Loading…" : "Demo video"}
        </Button>
        <label>
          <input type="file" accept="video/*" hidden onChange={onFile} />
          <Button asChild variant={source === "upload" ? "default" : "outline"} size="sm">
            <span className="cursor-pointer">
              <Upload className="h-4 w-4 mr-1.5" /> Upload video
            </span>
          </Button>
        </label>
        {!source && (
          <Button onClick={() => setRunning(true)} variant="secondary" size="sm">
            <Play className="h-4 w-4 mr-1.5" /> Start simulator
          </Button>
        )}
        {running ? (
          <Button onClick={stop} variant="destructive" size="sm">
            <Square className="h-4 w-4 mr-1.5" /> Stop
          </Button>
        ) : source ? (
          <Button onClick={() => setRunning(true)} variant="secondary" size="sm">
            <Play className="h-4 w-4 mr-1.5" /> Resume
          </Button>
        ) : null}
        <span className="ml-auto text-xs text-muted-foreground">
          Detector: <span className="font-medium">{mode}</span>
        </span>
      </div>

      <div
        className={cn(
          "relative w-full overflow-hidden rounded-xl border bg-slate-950 aspect-video",
          status === "danger" && running && "pulse-danger border-danger",
        )}
      >
        <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover opacity-0 pointer-events-none" muted playsInline autoPlay />
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        {showHeatmap && (
          <canvas
            ref={heatRef}
            className="pointer-events-none absolute inset-0 h-full w-full mix-blend-screen opacity-60"
            style={{ imageRendering: "pixelated" }}
          />
        )}
        {/* HUD */}
        <div className="absolute left-3 top-3 flex items-center gap-2">
          <span className={cn("rounded-full border px-2.5 py-0.5 text-xs font-medium", statusClass(status))}>
            ● {statusLabel(status)}
          </span>
          <span className="rounded-full bg-black/50 px-2.5 py-0.5 text-xs font-medium text-white backdrop-blur">
            {count} people
          </span>
        </div>
        {!running && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70">
            <Pause className="mr-2 h-4 w-4" /> Idle — pick a source above
          </div>
        )}
      </div>
    </div>
  );
}

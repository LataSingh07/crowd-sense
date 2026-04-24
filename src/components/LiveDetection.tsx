import { useEffect, useRef, useState } from "react";
import { detectFrame, type DetectionBox, getDetectorConfig } from "@/lib/detector";
import { classifyStatus, statusClass, statusLabel, type CrowdStatus } from "@/lib/density";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Camera,
  Upload,
  Pause,
  Play,
  Square,
  Film,
  Wifi,
  Plane,
  Cctv,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import Hls from "hls.js";
import demoVideoUrl from "@/assets/sample-crowd.mp4";

const DEMO_VIDEO_URL = demoVideoUrl;

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

type SourceKind = "webcam-front" | "webcam-rear" | "ip" | "cctv" | "drone" | "upload" | "demo" | null;

const HEATMAP_DECAY = 0.92;

// Source-type catalog used by the picker
const SOURCE_TYPES: Array<{
  value: Exclude<SourceKind, null>;
  label: string;
  icon: typeof Camera;
  description: string;
  needsUrl?: boolean;
  needsFile?: boolean;
}> = [
  { value: "webcam-front", label: "Webcam (front)", icon: Camera, description: "Use the device front camera" },
  { value: "webcam-rear", label: "Webcam (rear)", icon: Camera, description: "Use the device rear camera (mobile)" },
  { value: "ip", label: "IP Camera", icon: Wifi, description: "HLS (.m3u8), MJPEG or HTTP MP4 stream URL", needsUrl: true },
  { value: "cctv", label: "CCTV Camera", icon: Cctv, description: "HLS (.m3u8) or HTTP stream URL", needsUrl: true },
  { value: "drone", label: "Drone Camera", icon: Plane, description: "HLS or HTTP stream URL from your drone gateway", needsUrl: true },
  { value: "upload", label: "Video File", icon: Upload, description: "Upload an MP4/WebM file", needsFile: true },
  { value: "demo", label: "Demo Video", icon: Film, description: "Bundled sample crowd footage" },
];

export function LiveDetection({ camera, onReading, showHeatmap = true }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const heatRef = useRef<HTMLCanvasElement>(null);
  const heatBufferRef = useRef<Float32Array | null>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [running, setRunning] = useState(false);
  const [source, setSource] = useState<SourceKind>(null);
  const [sourceLabel, setSourceLabel] = useState<string>("");
  const [demoLoading, setDemoLoading] = useState(false);
  const [count, setCount] = useState(0);
  const [status, setStatus] = useState<CrowdStatus>("safe");
  const [mode] = useState(() => getDetectorConfig().mode);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Picker state
  const [pickerType, setPickerType] = useState<Exclude<SourceKind, null>>("webcam-front");
  const [streamUrl, setStreamUrl] = useState("");

  const storageKey = `liveDetection:source:${camera.id}`;

  const cleanupStream = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (hlsRef.current) {
      try { hlsRef.current.destroy(); } catch { /* noop */ }
      hlsRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
      videoRef.current.removeAttribute("src");
      videoRef.current.load();
    }
  };

  const stop = (clearPersisted = true) => {
    cleanupStream();
    setRunning(false);
    setSource(null);
    setSourceLabel("");
    setErrorMsg(null);
    if (clearPersisted && typeof window !== "undefined") {
      try { localStorage.removeItem(storageKey); } catch { /* noop */ }
    }
  };

  useEffect(() => () => cleanupStream(), []);

  const persist = (s: Exclude<SourceKind, null>, extra: Record<string, unknown> = {}) => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ source: s, ...extra }));
    } catch { /* noop */ }
  };

  // ---------- Source starters ----------

  const startWebcam = async (preferRear: boolean) => {
    cleanupStream();
    setErrorMsg(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera API not available. Use HTTPS and a modern browser.");
      }
      const constraints: MediaStreamConstraints = {
        video: preferRear
          ? { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const kind: SourceKind = preferRear ? "webcam-rear" : "webcam-front";
      setSource(kind);
      setSourceLabel(preferRear ? "Rear webcam" : "Front webcam");
      setRunning(true);
      persist(kind);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not access webcam";
      setErrorMsg(msg);
      toast.error(`Webcam error: ${msg}`);
    }
  };

  const startStreamUrl = async (
    url: string,
    kind: Extract<SourceKind, "ip" | "cctv" | "drone">,
    label: string,
  ) => {
    cleanupStream();
    setErrorMsg(null);

    const trimmed = url.trim();
    if (!trimmed) {
      const m = "Please enter a stream URL";
      setErrorMsg(m); toast.error(m); return;
    }
    if (/^rtsp:\/\//i.test(trimmed)) {
      const m = "Browsers cannot play RTSP directly. Use an RTSP→HLS gateway (e.g. MediaMTX, go2rtc) and paste the .m3u8 URL.";
      setErrorMsg(m); toast.error(m); return;
    }
    if (!/^https?:\/\//i.test(trimmed)) {
      const m = "URL must start with http:// or https://";
      setErrorMsg(m); toast.error(m); return;
    }

    const video = videoRef.current;
    if (!video) return;

    const isHls = /\.m3u8(\?|$)/i.test(trimmed);
    const playPromise = new Promise<void>((resolve, reject) => {
      const onErr = () => {
        cleanup();
        reject(new Error("Stream failed to load. Check URL, CORS and network."));
      };
      const onCanPlay = () => { cleanup(); resolve(); };
      const cleanup = () => {
        video.removeEventListener("error", onErr);
        video.removeEventListener("canplay", onCanPlay);
      };
      video.addEventListener("error", onErr);
      video.addEventListener("canplay", onCanPlay);
      // Safety timeout
      setTimeout(() => { cleanup(); reject(new Error("Stream timed out after 15s")); }, 15000);
    });

    try {
      video.crossOrigin = "anonymous"; // required for canvas drawImage from cross-origin streams
      if (isHls && Hls.isSupported()) {
        const hls = new Hls({ lowLatencyMode: true });
        hlsRef.current = hls;
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) {
            const m = `HLS error: ${data.type} / ${data.details}`;
            setErrorMsg(m); toast.error(m);
          }
        });
        hls.loadSource(trimmed);
        hls.attachMedia(video);
      } else {
        // Native (Safari) HLS, MJPEG over HTTP, or plain MP4
        video.src = trimmed;
      }
      video.loop = false;
      await video.play().catch(() => { /* canplay handler will resolve */ });
      await playPromise;
      setSource(kind);
      setSourceLabel(label);
      setRunning(true);
      persist(kind, { url: trimmed, label });
    } catch (e) {
      cleanupStream();
      const msg = e instanceof Error ? e.message : "Failed to start stream";
      setErrorMsg(msg);
      toast.error(msg);
    }
  };

  const startDemo = async () => {
    cleanupStream();
    setErrorMsg(null);
    setDemoLoading(true);
    try {
      if (videoRef.current) {
        videoRef.current.removeAttribute("crossorigin");
        videoRef.current.src = DEMO_VIDEO_URL;
        videoRef.current.loop = true;
        await videoRef.current.play();
      }
      setSource("demo");
      setSourceLabel("Demo video");
      setRunning(true);
      persist("demo");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unable to play demo video";
      setErrorMsg(msg);
      toast.error(`Demo video failed: ${msg}`);
    } finally {
      setDemoLoading(false);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    cleanupStream();
    setErrorMsg(null);
    if (videoRef.current) {
      videoRef.current.removeAttribute("crossorigin");
      videoRef.current.src = URL.createObjectURL(file);
      videoRef.current.loop = true;
      try {
        await videoRef.current.play();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "File could not be played";
        setErrorMsg(msg); toast.error(msg); return;
      }
    }
    setSource("upload");
    setSourceLabel(file.name);
    setRunning(true);
    // Browsers can't re-access local files after refresh; do not persist.
  };

  // Unified picker dispatcher
  const handleStartPicker = async () => {
    switch (pickerType) {
      case "webcam-front": return startWebcam(false);
      case "webcam-rear": return startWebcam(true);
      case "ip": return startStreamUrl(streamUrl, "ip", "IP camera");
      case "cctv": return startStreamUrl(streamUrl, "cctv", "CCTV");
      case "drone": return startStreamUrl(streamUrl, "drone", "Drone");
      case "demo": return startDemo();
      case "upload": {
        // Trigger hidden file input
        document.getElementById(`live-upload-${camera.id}`)?.click();
        return;
      }
    }
  };

  // Auto-resume from persisted source on mount / camera change
  useEffect(() => {
    if (typeof window === "undefined") return;
    let raw: string | null = null;
    try { raw = localStorage.getItem(storageKey); } catch { return; }
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as { source?: Exclude<SourceKind, null>; url?: string; label?: string };
      if (!saved.source) return;
      if (saved.source === "webcam-front") void startWebcam(false);
      else if (saved.source === "webcam-rear") void startWebcam(true);
      else if (saved.source === "demo") void startDemo();
      else if ((saved.source === "ip" || saved.source === "cctv" || saved.source === "drone") && saved.url) {
        setPickerType(saved.source);
        setStreamUrl(saved.url);
        void startStreamUrl(saved.url, saved.source, saved.label ?? saved.source.toUpperCase());
      }
    } catch { /* noop */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera.id]);

  // ---------- Detection loop ----------
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

      if (video.videoWidth > 0) {
        try {
          ctx.drawImage(video, 0, 0, w, h);
        } catch {
          // Cross-origin taint — show a hint
          ctx.fillStyle = "#0f172a";
          ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = "#fca5a5";
          ctx.font = "13px sans-serif";
          ctx.fillText("Stream blocked by CORS — server must send Access-Control-Allow-Origin", 16, 28);
        }
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

  const isMobile = typeof navigator !== "undefined" && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  const activeType = SOURCE_TYPES.find((t) => t.value === pickerType)!;
  const needsUrl = !!activeType.needsUrl;

  return (
    <div className="space-y-3">
      {/* Unified source picker */}
      <div className="rounded-xl border bg-card p-3 space-y-3">
        <div className="grid gap-3 md:grid-cols-[220px_1fr_auto] md:items-end">
          <div className="space-y-1.5">
            <Label className="text-xs">Camera type</Label>
            <Select value={pickerType} onValueChange={(v) => setPickerType(v as Exclude<SourceKind, null>)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SOURCE_TYPES.map((t) => {
                  const Icon = t.icon;
                  // Hide rear webcam on desktop to reduce noise
                  if (t.value === "webcam-rear" && !isMobile) return null;
                  return (
                    <SelectItem key={t.value} value={t.value}>
                      <span className="inline-flex items-center gap-2">
                        <Icon className="h-3.5 w-3.5" /> {t.label}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {needsUrl ? (
            <div className="space-y-1.5">
              <Label className="text-xs">Stream URL</Label>
              <Input
                placeholder="https://example.com/stream.m3u8"
                value={streamUrl}
                onChange={(e) => setStreamUrl(e.target.value)}
              />
            </div>
          ) : activeType.needsFile ? (
            <div className="space-y-1.5">
              <Label className="text-xs">Video file</Label>
              <input
                id={`live-upload-${camera.id}`}
                type="file"
                accept="video/*"
                onChange={onFile}
                className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-secondary/80"
              />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{activeType.description}</p>
          )}

          <div className="flex gap-2">
            {!running ? (
              <Button onClick={handleStartPicker} disabled={demoLoading} size="sm">
                <Play className="h-4 w-4 mr-1.5" />
                {demoLoading ? "Loading…" : "Start"}
              </Button>
            ) : (
              <Button onClick={() => stop()} variant="destructive" size="sm">
                <Square className="h-4 w-4 mr-1.5" /> Stop
              </Button>
            )}
          </div>
        </div>

        {needsUrl && (
          <p className="text-[11px] text-muted-foreground">
            Supports HLS (.m3u8), HTTP MJPEG and HTTP MP4. RTSP requires a gateway (MediaMTX, go2rtc, ffmpeg → HLS).
            The stream server must allow CORS.
          </p>
        )}

        {errorMsg && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {source ? <>Active: <span className="font-medium text-foreground">{sourceLabel}</span></> : "No active source"}
          </span>
          <span>Detector: <span className="font-medium">{mode}</span></span>
        </div>
      </div>

      {/* Live canvas */}
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-xl border bg-slate-950 aspect-video",
          status === "danger" && running && "pulse-danger border-danger",
        )}
      >
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover opacity-0 pointer-events-none"
          muted
          playsInline
          autoPlay
        />
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        {showHeatmap && (
          <canvas
            ref={heatRef}
            className="pointer-events-none absolute inset-0 h-full w-full mix-blend-screen opacity-60"
            style={{ imageRendering: "pixelated" }}
          />
        )}
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
            <Pause className="mr-2 h-4 w-4" /> Idle — choose a camera type and press Start
          </div>
        )}
      </div>
    </div>
  );
}

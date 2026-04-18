/**
 * Detector adapter — pluggable person-detection backend.
 *
 * Two modes:
 *   - "simulator": generates believable bounding boxes locally (no backend needed).
 *                  Lets the whole dashboard work end-to-end out of the box.
 *   - "remote":    POSTs the current frame as a JPEG to your YOLO API and
 *                  expects back { boxes: [{x,y,w,h,score}] } in normalized
 *                  coords (0..1) OR pixel coords (auto-detected).
 *
 * Configure via the Settings page (stored in localStorage). When you host your
 * own YOLOv8/FastAPI backend, switch the mode to "remote" and paste the URL.
 */

export interface DetectionBox {
  x: number; // pixels in source image coords
  y: number;
  w: number;
  h: number;
  score: number;
}

export interface DetectionResult {
  boxes: DetectionBox[];
  count: number;
}

export type DetectorMode = "simulator" | "lovable-ai" | "remote";

export interface DetectorConfig {
  mode: DetectorMode;
  remoteUrl: string;
  apiKey?: string;
  // Simulator parameters
  simBaseCount: number; // average people
  simVariance: number; // ± variance
  // Lovable AI throttle (ms between calls — vision is rate-limited)
  aiIntervalMs: number;
}

const STORAGE_KEY = "smartcrowd.detector.config";

const DEFAULTS: DetectorConfig = {
  mode: "simulator",
  remoteUrl: "",
  simBaseCount: 12,
  simVariance: 8,
  aiIntervalMs: 2500,
};

export function getDetectorConfig(): DetectorConfig {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return DEFAULTS;
}

export function setDetectorConfig(cfg: DetectorConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

// Internal sim state for smooth motion
const simState: { boxes: DetectionBox[]; targetCount: number; lastTick: number } = {
  boxes: [],
  targetCount: 0,
  lastTick: 0,
};

function simulateBoxes(width: number, height: number, cfg: DetectorConfig): DetectionResult {
  const now = performance.now();
  const dt = simState.lastTick ? (now - simState.lastTick) / 1000 : 0.05;
  simState.lastTick = now;

  // Slowly drift target count
  if (Math.random() < 0.05 || simState.targetCount === 0) {
    const variance = cfg.simVariance;
    simState.targetCount = Math.max(
      0,
      Math.round(cfg.simBaseCount + (Math.random() * 2 - 1) * variance),
    );
  }

  // Add or remove boxes to approach target
  while (simState.boxes.length < simState.targetCount) {
    simState.boxes.push({
      x: Math.random() * width,
      y: height * (0.3 + Math.random() * 0.6),
      w: width * (0.04 + Math.random() * 0.04),
      h: height * (0.12 + Math.random() * 0.08),
      score: 0.7 + Math.random() * 0.3,
    });
  }
  while (simState.boxes.length > simState.targetCount) {
    simState.boxes.pop();
  }

  // Move each box gently
  for (const b of simState.boxes) {
    b.x += (Math.random() * 2 - 1) * 30 * dt;
    b.y += (Math.random() * 2 - 1) * 8 * dt;
    if (b.x < 0) b.x = 0;
    if (b.x + b.w > width) b.x = width - b.w;
    if (b.y < height * 0.25) b.y = height * 0.25;
    if (b.y + b.h > height) b.y = height - b.h;
  }

  return { boxes: [...simState.boxes], count: simState.boxes.length };
}

async function detectRemote(
  blob: Blob,
  cfg: DetectorConfig,
  width: number,
  height: number,
): Promise<DetectionResult> {
  const fd = new FormData();
  fd.append("image", blob, "frame.jpg");
  const headers: Record<string, string> = {};
  if (cfg.apiKey) headers["Authorization"] = `Bearer ${cfg.apiKey}`;
  const res = await fetch(cfg.remoteUrl, { method: "POST", body: fd, headers });
  if (!res.ok) throw new Error(`Detector HTTP ${res.status}`);
  const json = (await res.json()) as { boxes?: Array<{ x: number; y: number; w: number; h: number; score?: number }> };
  const raw = json.boxes ?? [];
  const isNormalized = raw.every((b) => b.x <= 1 && b.y <= 1 && b.w <= 1 && b.h <= 1);
  const boxes: DetectionBox[] = raw.map((b) => ({
    x: isNormalized ? b.x * width : b.x,
    y: isNormalized ? b.y * height : b.y,
    w: isNormalized ? b.w * width : b.w,
    h: isNormalized ? b.h * height : b.h,
    score: b.score ?? 1,
  }));
  return { boxes, count: boxes.length };
}

// Throttling state for AI mode + last result cache to keep canvas smooth between calls
const aiState: { lastCall: number; lastResult: DetectionResult; inFlight: boolean } = {
  lastCall: 0,
  lastResult: { boxes: [], count: 0 },
  inFlight: false,
};

async function detectLovableAI(
  video: HTMLVideoElement,
  width: number,
  height: number,
  cfg: DetectorConfig,
): Promise<DetectionResult> {
  const now = performance.now();
  // Throttle: only call AI every aiIntervalMs; otherwise return last result
  if (aiState.inFlight || now - aiState.lastCall < cfg.aiIntervalMs) {
    return aiState.lastResult;
  }
  aiState.inFlight = true;
  aiState.lastCall = now;
  try {
    const off = document.createElement("canvas");
    // Downscale to keep payload small + fast
    const scale = Math.min(1, 640 / Math.max(width, height));
    off.width = Math.round(width * scale);
    off.height = Math.round(height * scale);
    const ctx = off.getContext("2d");
    if (!ctx) throw new Error("No 2d context");
    ctx.drawImage(video, 0, 0, off.width, off.height);
    const dataUrl = off.toDataURL("image/jpeg", 0.6);

    const supabaseUrl = (import.meta as { env: Record<string, string> }).env.VITE_SUPABASE_URL;
    const publishable = (import.meta as { env: Record<string, string> }).env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const res = await fetch(`${supabaseUrl}/functions/v1/detect-people`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: publishable,
        Authorization: `Bearer ${publishable}`,
      },
      body: JSON.stringify({ imageBase64: dataUrl }),
    });
    if (!res.ok) {
      const txt = await res.text();
      console.error("detect-people failed", res.status, txt);
      return aiState.lastResult;
    }
    const json = (await res.json()) as { boxes: Array<{ x: number; y: number; w: number; h: number; score: number }>; count: number };
    const boxes: DetectionBox[] = (json.boxes ?? []).map((b) => ({
      x: b.x * width,
      y: b.y * height,
      w: b.w * width,
      h: b.h * height,
      score: b.score ?? 1,
    }));
    aiState.lastResult = { boxes, count: boxes.length };
    return aiState.lastResult;
  } catch (e) {
    console.error("detectLovableAI error", e);
    return aiState.lastResult;
  } finally {
    aiState.inFlight = false;
  }
}

/**
 * Main entry — pass a video element + the canvas dimensions. Returns boxes in
 * canvas pixel coordinates.
 */
export async function detectFrame(
  video: HTMLVideoElement,
  canvasWidth: number,
  canvasHeight: number,
): Promise<DetectionResult> {
  const cfg = getDetectorConfig();
  if (cfg.mode === "simulator") {
    return simulateBoxes(canvasWidth, canvasHeight, cfg);
  }
  if (cfg.mode === "lovable-ai") {
    if (!video || video.videoWidth === 0) return { boxes: [], count: 0 };
    return detectLovableAI(video, canvasWidth, canvasHeight, cfg);
  }
  // Remote: capture frame -> blob -> POST
  if (!cfg.remoteUrl) return simulateBoxes(canvasWidth, canvasHeight, cfg);
  const off = document.createElement("canvas");
  off.width = canvasWidth;
  off.height = canvasHeight;
  const ctx = off.getContext("2d");
  if (!ctx) throw new Error("No 2d context");
  ctx.drawImage(video, 0, 0, canvasWidth, canvasHeight);
  const blob: Blob = await new Promise((r) => off.toBlob((b) => r(b!), "image/jpeg", 0.7));
  return detectRemote(blob, cfg, canvasWidth, canvasHeight);
}

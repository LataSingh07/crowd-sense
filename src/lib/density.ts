// Density classification helpers
export type CrowdStatus = "safe" | "moderate" | "danger";

export function classifyStatus(
  count: number,
  thresholdModerate: number,
  thresholdDanger: number,
): CrowdStatus {
  if (count >= thresholdDanger) return "danger";
  if (count >= thresholdModerate) return "moderate";
  return "safe";
}

export function statusLabel(s: CrowdStatus) {
  return s === "safe" ? "Safe" : s === "moderate" ? "Moderate" : "Danger";
}

export function statusClass(s: CrowdStatus) {
  return s === "safe" ? "status-safe" : s === "moderate" ? "status-moderate" : "status-danger";
}

// Simple linear regression forecast for next N points
export function linearForecast(values: number[], steps = 5): number[] {
  const n = values.length;
  if (n < 2) return Array(steps).fill(values[n - 1] ?? 0);
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (values[i] - yMean);
    den += (i - xMean) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = yMean - slope * xMean;
  return Array.from({ length: steps }, (_, k) => Math.max(0, Math.round(intercept + slope * (n + k))));
}

// Persists a crowd reading and auto-creates an alert when thresholds are crossed.
// Requires the caller to be authenticated (verify_jwt = true by default in config).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface RecordRequest {
  cameraId: string;
  count: number;
  density: number;
  status: "safe" | "moderate" | "danger";
  /** previous status from the client to suppress duplicate alerts */
  previousStatus?: "safe" | "moderate" | "danger";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const body = (await req.json()) as RecordRequest;
    if (!body.cameraId || typeof body.count !== "number") {
      return new Response(JSON.stringify({ error: "cameraId and count required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Insert reading
    const { error: readErr } = await admin.from("crowd_readings").insert({
      camera_id: body.cameraId,
      people_count: body.count,
      density: body.density,
      status: body.status,
    });
    if (readErr) {
      console.error("reading insert failed", readErr);
      return new Response(JSON.stringify({ error: readErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let alertCreated = false;
    const shouldAlert =
      (body.status === "moderate" || body.status === "danger") &&
      body.previousStatus !== body.status;

    if (shouldAlert) {
      // Throttle: skip if an alert of same severity was created in the last 30s for this camera
      const since = new Date(Date.now() - 30_000).toISOString();
      const { data: recent } = await admin
        .from("alerts")
        .select("id")
        .eq("camera_id", body.cameraId)
        .eq("severity", body.status)
        .gte("created_at", since)
        .limit(1);

      if (!recent || recent.length === 0) {
        const { data: cam } = await admin
          .from("cameras")
          .select("name, location")
          .eq("id", body.cameraId)
          .single();

        const camName = cam?.name ?? "Camera";
        const message =
          body.status === "danger"
            ? `🚨 DANGER: ${body.count} people detected at ${camName}`
            : `⚠️ Moderate crowd at ${camName}: ${body.count} people`;

        const { error: alertErr } = await admin.from("alerts").insert({
          camera_id: body.cameraId,
          severity: body.status,
          people_count: body.count,
          message,
        });
        if (alertErr) console.error("alert insert failed", alertErr);
        else alertCreated = true;
      }
    }

    return new Response(JSON.stringify({ ok: true, alertCreated }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("record-reading error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

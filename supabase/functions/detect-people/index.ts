// Server-side person detection using Lovable AI vision (Gemini).
// Accepts a JPEG/PNG frame as base64 and returns a count + bounding boxes
// (normalized 0..1) via structured tool calling.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface DetectRequest {
  imageBase64: string; // data URL or raw base64
  mimeType?: string; // default image/jpeg
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { imageBase64, mimeType = "image/jpeg" } = (await req.json()) as DetectRequest;
    if (!imageBase64) {
      return new Response(JSON.stringify({ error: "imageBase64 required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const dataUrl = imageBase64.startsWith("data:")
      ? imageBase64
      : `data:${mimeType};base64,${imageBase64}`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "You are a strict person-detection model. Return bounding boxes ONLY for clearly visible humans (whole or partial bodies, heads, faces). Do NOT label animals, cartoon characters, plush toys, statues, mannequins, posters, or reflections as people. If there are no people, return an empty array. Coordinates are normalized 0..1 with (0,0) at top-left.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Detect every clearly visible real human in this frame. If none, return an empty array." },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "report_people",
              description: "Report detected people with normalized bounding boxes.",
              parameters: {
                type: "object",
                properties: {
                  people: {
                    type: "array",
                    description: "Array of detected people. Empty if none.",
                    items: {
                      type: "object",
                      properties: {
                        x: { type: "number", description: "Left edge 0..1" },
                        y: { type: "number", description: "Top edge 0..1" },
                        w: { type: "number", description: "Width 0..1" },
                        h: { type: "number", description: "Height 0..1" },
                        score: { type: "number", description: "Confidence 0..1" },
                      },
                      required: ["x", "y", "w", "h", "score"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["people"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "report_people" } },
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again shortly." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResp.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Add credits in Lovable workspace settings." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const txt = await aiResp.text();
      console.error("AI gateway error", aiResp.status, txt);
      return new Response(JSON.stringify({ error: "AI gateway error", detail: txt }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const json = await aiResp.json();
    const toolCall = json?.choices?.[0]?.message?.tool_calls?.[0];
    let people: Array<{ x: number; y: number; w: number; h: number; score: number }> = [];
    if (toolCall?.function?.arguments) {
      try {
        const parsed = JSON.parse(toolCall.function.arguments);
        if (Array.isArray(parsed.people)) people = parsed.people;
      } catch (e) {
        console.error("Failed to parse tool arguments", e);
      }
    }

    return new Response(
      JSON.stringify({ count: people.length, boxes: people }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("detect-people error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

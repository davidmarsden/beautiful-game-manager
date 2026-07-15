import { acceptManagerDecision } from "../../src/decisionSubmission.js";

const WORLD_URL = process.env.TBG_WORLD_URL || "https://raw.githubusercontent.com/davidmarsden/beautiful-game-engine/main/derived/world/world.json";

export default async (request) => {
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { "content-type": "application/json" } });
  try {
    const [payload, worldResponse] = await Promise.all([request.json(), fetch(WORLD_URL, { headers: { accept: "application/json" } })]);
    if (!worldResponse.ok) throw new Error(`World source returned ${worldResponse.status}`);
    const world = await worldResponse.json();
    const accepted = acceptManagerDecision(payload, world);
    return new Response(JSON.stringify({ ...accepted, persistence: "preview_only_until_supabase" }), { status: 201, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message, validation_errors: error.validationErrors || [] }), { status: error.validationErrors ? 400 : 500, headers: { "content-type": "application/json" } });
  }
};

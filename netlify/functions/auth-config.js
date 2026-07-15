const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

export default async () => new Response(JSON.stringify({
  supabase_url: SUPABASE_URL,
  supabase_anon_key: SUPABASE_ANON_KEY,
  configured: Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)
}), {
  status: 200,
  headers: {
    "content-type": "application/json",
    "cache-control": "no-store"
  }
});

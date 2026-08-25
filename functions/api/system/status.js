// Cloudflare Pages Serverless Function for Environment Variables Injection
export async function onRequestGet(context) {
  const supabaseUrl = context.env.SUPABASE_URL || '';
  const supabaseKey = context.env.SUPABASE_KEY || '';
  const supabaseBucket = context.env.SUPABASE_BUCKET || 'tutormark-files';

  return new Response(JSON.stringify({
    supabase_enabled: Boolean(supabaseUrl && supabaseKey),
    storage_mode: "Supabase Storage & PostgreSQL (Cloudflare Pages)",
    supabase_url: supabaseUrl,
    supabase_key: supabaseKey,
    supabase_bucket: supabaseBucket
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

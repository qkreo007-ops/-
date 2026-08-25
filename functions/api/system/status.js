// Cloudflare Pages Serverless Function for Environment Variables Injection
export async function onRequestGet(context) {
  const supabaseUrl = context.env.SUPABASE_URL || '';
  const supabaseKey = context.env.SUPABASE_KEY || '';
  const supabaseBucket = context.env.SUPABASE_BUCKET || 'tutormark-files';

  // The key is handed to the browser, so only a public anon key may leave here.
  // A service_role key in the environment would otherwise grant every visitor full DB access.
  const role = readJwtRole(supabaseKey);
  const clientSafe = Boolean(supabaseUrl && supabaseKey) && role === 'anon';

  return new Response(JSON.stringify({
    supabase_enabled: Boolean(supabaseUrl && supabaseKey),
    storage_mode: "Supabase Storage & PostgreSQL (Cloudflare Pages)",
    supabase_url: clientSafe ? supabaseUrl : '',
    supabase_key: clientSafe ? supabaseKey : '',
    supabase_bucket: supabaseBucket,
    client_direct_access: clientSafe,
    key_role: role
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

/** Reads the unverified `role` claim from a Supabase JWT. */
function readJwtRole(key) {
  try {
    const payload = key.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json).role || '';
  } catch (e) {
    return '';
  }
}

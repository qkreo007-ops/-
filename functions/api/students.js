// Cloudflare Pages Serverless Function for /api/students
export async function onRequestGet(context) {
  const url = context.env.SUPABASE_URL;
  const key = context.env.SUPABASE_KEY;

  if (!url || !key) {
    return new Response(JSON.stringify([]), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const res = await fetch(`${url}/rest/v1/students?select=*&order=id.asc`, {
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`
    }
  });

  const data = await res.json();
  return new Response(JSON.stringify(data || []), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

export async function onRequestPost(context) {
  const url = context.env.SUPABASE_URL;
  const key = context.env.SUPABASE_KEY;

  if (!url || !key) {
    return new Response(JSON.stringify({ error: 'Supabase URL or Key not set in Cloudflare' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  try {
    const body = await context.request.json();
    const res = await fetch(`${url}/rest/v1/students`, {
      method: 'POST',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        name: body.name,
        grade: body.grade || '',
        pin: body.pin || '0000',
        avatar_color: body.avatar_color || '#3B82F6',
        created_at: new Date().toISOString()
      })
    });

    const data = await res.json();
    if (!res.ok) {
      return new Response(JSON.stringify({ error: data.message || '학생 추가 실패' }), {
        status: res.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    return new Response(JSON.stringify(Array.isArray(data) ? data[0] : data), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

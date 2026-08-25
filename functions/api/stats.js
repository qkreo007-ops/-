// Cloudflare Pages Serverless Function for /api/stats
export async function onRequestGet(context) {
  const url = context.env.SUPABASE_URL;
  const key = context.env.SUPABASE_KEY;

  if (!url || !key) {
    return new Response(JSON.stringify({
      student_count: 0,
      total_submissions: 0,
      pending_count: 0,
      reviewed_count: 0
    }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  try {
    // Ask PostgREST for the count in the Content-Range header instead of
    // downloading every row just to call .length on it
    const headers = {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Prefer': 'count=exact',
      'Range': '0-0'
    };

    const countOf = async (path) => {
      const res = await fetch(`${url}/rest/v1/${path}`, { method: 'HEAD', headers });
      const range = res.headers.get('content-range') || '';
      const total = parseInt(range.split('/')[1], 10);
      return Number.isFinite(total) ? total : 0;
    };

    const [students, total, pending, reviewed] = await Promise.all([
      countOf('students?select=id'),
      countOf('submissions?select=id'),
      countOf('submissions?select=id&status=eq.pending'),
      countOf('submissions?select=id&status=eq.reviewed')
    ]);

    return new Response(JSON.stringify({
      student_count: students,
      total_submissions: total,
      pending_count: pending,
      reviewed_count: reviewed
    }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (err) {
    return new Response(JSON.stringify({
      student_count: 0,
      total_submissions: 0,
      pending_count: 0,
      reviewed_count: 0
    }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

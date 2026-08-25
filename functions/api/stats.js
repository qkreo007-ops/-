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
    const headers = { 'apikey': key, 'Authorization': `Bearer ${key}` };

    const [studentsRes, totalRes, pendingRes, reviewedRes] = await Promise.all([
      fetch(`${url}/rest/v1/students?select=id`, { headers }),
      fetch(`${url}/rest/v1/submissions?select=id`, { headers }),
      fetch(`${url}/rest/v1/submissions?select=id&status=eq.pending`, { headers }),
      fetch(`${url}/rest/v1/submissions?select=id&status=eq.reviewed`, { headers })
    ]);

    const [students, total, pending, reviewed] = await Promise.all([
      studentsRes.json(),
      totalRes.json(),
      pendingRes.json(),
      reviewedRes.json()
    ]);

    return new Response(JSON.stringify({
      student_count: Array.isArray(students) ? students.length : 0,
      total_submissions: Array.isArray(total) ? total.length : 0,
      pending_count: Array.isArray(pending) ? pending.length : 0,
      reviewed_count: Array.isArray(reviewed) ? reviewed.length : 0
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

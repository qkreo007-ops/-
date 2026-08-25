// Cloudflare Pages Serverless Function for /api/submissions
export async function onRequestGet(context) {
  const url = context.env.SUPABASE_URL;
  const key = context.env.SUPABASE_KEY;

  if (!url || !key) {
    return new Response(JSON.stringify([]), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const reqUrl = new URL(context.request.url);
  const studentId = reqUrl.searchParams.get('student_id');
  const status = reqUrl.searchParams.get('status');

  let query = `${url}/rest/v1/submissions?select=*,feedbacks(id)&order=id.desc`;
  // Encode caller-supplied values: raw interpolation lets them inject extra PostgREST filters
  if (studentId && /^\d+$/.test(studentId)) {
    query += `&student_id=eq.${encodeURIComponent(studentId)}`;
  }
  if (status && status !== 'all' && /^[a-z_]+$/.test(status)) {
    query += `&status=eq.${encodeURIComponent(status)}`;
  }

  const res = await fetch(query, {
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`
    }
  });

  const data = await res.json();
  const submissions = (Array.isArray(data) ? data : []).map(sub => {
    let images = [];
    if (sub.image_urls) {
      images = typeof sub.image_urls === 'string' ? JSON.parse(sub.image_urls) : sub.image_urls;
    } else if (sub.image_url) {
      images = [sub.image_url];
    }
    return {
      ...sub,
      images,
      feedback_count: Array.isArray(sub.feedbacks) ? sub.feedbacks.length : 0
    };
  });

  return new Response(JSON.stringify(submissions), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

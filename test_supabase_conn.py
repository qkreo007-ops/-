import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
SUPABASE_BUCKET = os.getenv("SUPABASE_BUCKET", "tutormark-files")

print(f"Connecting to: {SUPABASE_URL}")
client = create_client(SUPABASE_URL, SUPABASE_KEY)

# 1. Test database connection & students table
try:
    res = client.table("students").select("*").execute()
    print(f"[OK] Supabase 'students' table connected! Rows: {len(res.data)}")
    print(f"Students data: {res.data}")
except Exception as e:
    print(f"[NOTICE] 'students' table check: {e}")

# 2. Test submissions table
try:
    res = client.table("submissions").select("*").execute()
    print(f"[OK] Supabase 'submissions' table connected! Rows: {len(res.data)}")
except Exception as e:
    print(f"[NOTICE] 'submissions' table check: {e}")

# 3. Test storage bucket
try:
    buckets = client.storage.list_buckets()
    bucket_names = [b.name for b in buckets]
    print(f"Existing storage buckets: {bucket_names}")
    if SUPABASE_BUCKET in bucket_names:
        print(f"[OK] Storage bucket '{SUPABASE_BUCKET}' is ready!")
    else:
        print(f"[NOTICE] Bucket '{SUPABASE_BUCKET}' not found in: {bucket_names}")
except Exception as e:
    print(f"[NOTICE] Storage bucket check: {e}")

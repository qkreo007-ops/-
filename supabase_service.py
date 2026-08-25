import os
import io
import json
from datetime import datetime
from dotenv import load_dotenv
from typing import Optional, List, Dict, Any

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "").strip()
SUPABASE_BUCKET = os.getenv("SUPABASE_BUCKET", "tutormark-files").strip()

supabase_client = None
is_connected = False

if SUPABASE_URL and SUPABASE_KEY and "your-project-ref" not in SUPABASE_URL:
    try:
        from supabase import create_client, Client
        supabase_client: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
        is_connected = True
        print(f"⚡ [Supabase] Connected to {SUPABASE_URL}")
    except Exception as e:
        print(f"⚠️ [Supabase] Connection error: {e}. Falling back to SQLite/Local Storage.")
        is_connected = False

def is_supabase_enabled() -> bool:
    return is_connected and supabase_client is not None

def parse_image_urls(item: dict) -> List[str]:
    urls = []
    if item.get("image_urls"):
        if isinstance(item["image_urls"], list):
            urls = item["image_urls"]
        elif isinstance(item["image_urls"], str):
            try:
                urls = json.loads(item["image_urls"])
            except:
                urls = []
    if not urls and item.get("image_url"):
        urls = [item["image_url"]]
    if not urls and item.get("image_filename"):
        urls = [item["image_filename"]]
    return urls

# --- Supabase Storage Helpers ---

def upload_image_to_storage(file_bytes: bytes, filename: str, content_type: str = "image/jpeg") -> str:
    if not is_supabase_enabled():
        return ""

    try:
        res = supabase_client.storage.from_(SUPABASE_BUCKET).upload(
            path=filename,
            file=file_bytes,
            file_options={"content-type": content_type, "upsert": "true"}
        )
        public_url = supabase_client.storage.from_(SUPABASE_BUCKET).get_public_url(filename)
        return public_url
    except Exception as e:
        print(f"⚠️ [Supabase Storage Upload Error]: {e}")
        raise e

def delete_image_from_storage(filename: str):
    if not is_supabase_enabled():
        return
    try:
        supabase_client.storage.from_(SUPABASE_BUCKET).remove([filename])
    except Exception as e:
        print(f"⚠️ [Supabase Storage Delete Error]: {e}")

# --- Supabase Database Helpers ---

def get_all_students() -> List[Dict[str, Any]]:
    if not is_supabase_enabled():
        import database as local_db
        return local_db.get_all_students()

    res = supabase_client.table("students").select("*").order("id", desc=False).execute()
    return res.data or []

def add_student(name: str, grade: str = "", pin: str = "0000", avatar_color: str = "#3B82F6") -> int:
    if not is_supabase_enabled():
        import database as local_db
        return local_db.add_student(name, grade, pin, avatar_color)

    now = datetime.now().isoformat()
    res = supabase_client.table("students").insert({
        "name": name,
        "grade": grade,
        "pin": pin,
        "avatar_color": avatar_color,
        "created_at": now
    }).execute()
    
    if res.data:
        return res.data[0]["id"]
    return 0

def create_submission(student_id: int, student_name: str, subject: str, title: str, memo: str, image_urls_list: List[str]) -> int:
    if not is_supabase_enabled():
        import database as local_db
        return local_db.create_submission(student_id, student_name, subject, title, memo, image_urls_list)

    now = datetime.now().isoformat()
    first_url = image_urls_list[0] if image_urls_list else ""
    res = supabase_client.table("submissions").insert({
        "student_id": student_id,
        "student_name": student_name,
        "subject": subject,
        "title": title,
        "memo": memo,
        "image_url": first_url,
        "image_urls": image_urls_list,
        "status": "pending",
        "created_at": now
    }).execute()

    if res.data:
        return res.data[0]["id"]
    return 0

def get_submissions(student_id: Optional[int] = None, status: Optional[str] = None) -> List[Dict[str, Any]]:
    if not is_supabase_enabled():
        import database as local_db
        return local_db.get_submissions(student_id, status)

    query = supabase_client.table("submissions").select("*, feedbacks(count)")
    
    if student_id:
        query = query.eq("student_id", student_id)
    if status and status != 'all':
        query = query.eq("status", status)

    res = query.order("id", desc=True).execute()
    submissions = []
    for item in (res.data or []):
        sub_dict = dict(item)
        sub_dict["images"] = parse_image_urls(sub_dict)
        fb_info = sub_dict.get("feedbacks", [])
        if isinstance(fb_info, list) and len(fb_info) > 0 and "count" in fb_info[0]:
            sub_dict["feedback_count"] = fb_info[0]["count"]
        elif isinstance(fb_info, list):
            sub_dict["feedback_count"] = len(fb_info)
        else:
            sub_dict["feedback_count"] = 0
            
        submissions.append(sub_dict)
    return submissions

def get_submission_detail(submission_id: int) -> Optional[Dict[str, Any]]:
    if not is_supabase_enabled():
        import database as local_db
        return local_db.get_submission_detail(submission_id)

    res = supabase_client.table("submissions").select("*").eq("id", submission_id).execute()
    if not res.data:
        return None

    submission = dict(res.data[0])
    submission["images"] = parse_image_urls(submission)
    
    fb_res = supabase_client.table("feedbacks").select("*").eq("submission_id", submission_id).order("id", desc=False).execute()
    submission["feedbacks"] = fb_res.data or []
    return submission

def delete_submission(submission_id: int):
    if not is_supabase_enabled():
        import database as local_db
        return local_db.delete_submission(submission_id)

    detail = get_submission_detail(submission_id)
    if detail:
        for img_url in detail.get("images", []):
            if "/" in img_url:
                filename = img_url.split("/")[-1]
                delete_image_from_storage(filename)
            
        for fb in detail.get("feedbacks", []):
            fb_url = fb.get("annotated_image_url", "")
            if "/" in fb_url:
                fb_filename = fb_url.split("/")[-1]
                delete_image_from_storage(fb_filename)

    supabase_client.table("submissions").delete().eq("id", submission_id).execute()
    return {"message": "deleted"}

def create_feedback(submission_id: int, teacher_name: str, comment: str, annotated_image_url: str, annotation_data: str = "{}", page_index: int = 0) -> int:
    if not is_supabase_enabled():
        import database as local_db
        return local_db.create_feedback(submission_id, teacher_name, comment, annotated_image_url, annotation_data, page_index)

    now = datetime.now().isoformat()
    res = supabase_client.table("feedbacks").insert({
        "submission_id": submission_id,
        "page_index": page_index,
        "teacher_name": teacher_name,
        "comment": comment,
        "annotated_image_url": annotated_image_url,
        "annotation_data": annotation_data,
        "created_at": now
    }).execute()

    supabase_client.table("submissions").update({"status": "reviewed"}).eq("id", submission_id).execute()

    if res.data:
        return res.data[0]["id"]
    return 0

def delete_feedback(feedback_id: int):
    if not is_supabase_enabled():
        import database as local_db
        return local_db.delete_feedback(feedback_id)

    fb_res = supabase_client.table("feedbacks").select("*").eq("id", feedback_id).execute()
    if not fb_res.data:
        return None

    fb = fb_res.data[0]
    submission_id = fb["submission_id"]
    fb_url = fb.get("annotated_image_url", "")
    if "/" in fb_url:
        filename = fb_url.split("/")[-1]
        delete_image_from_storage(filename)

    supabase_client.table("feedbacks").delete().eq("id", feedback_id).execute()

    remaining = supabase_client.table("feedbacks").select("id").eq("submission_id", submission_id).execute()
    if not remaining.data:
        supabase_client.table("submissions").update({"status": "pending"}).eq("id", submission_id).execute()

    return {"submission_id": submission_id}

def get_stats() -> Dict[str, int]:
    if not is_supabase_enabled():
        import database as local_db
        return local_db.get_db_connection() and {
            "student_count": len(local_db.get_all_students()),
            "total_submissions": len(local_db.get_submissions()),
            "pending_count": len(local_db.get_submissions(status="pending")),
            "reviewed_count": len(local_db.get_submissions(status="reviewed"))
        }

    st_res = supabase_client.table("students").select("id", count="exact").execute()
    sub_res = supabase_client.table("submissions").select("id", count="exact").execute()
    pend_res = supabase_client.table("submissions").select("id", count="exact").eq("status", "pending").execute()
    rev_res = supabase_client.table("submissions").select("id", count="exact").eq("status", "reviewed").execute()

    return {
        "student_count": st_res.count or 0,
        "total_submissions": sub_res.count or 0,
        "pending_count": pend_res.count or 0,
        "reviewed_count": rev_res.count or 0
    }

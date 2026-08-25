import os
import uuid
import base64
import io
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
from PIL import Image, ImageOps

# iPhone photos arrive as HEIC; Pillow needs this plug-in to decode them.
# Optional so a failed wheel build degrades to a clear message instead of breaking startup.
try:
    import pillow_heif
    pillow_heif.register_heif_opener()
    HEIC_SUPPORTED = True
except Exception:
    HEIC_SUPPORTED = False

import database as local_db
import supabase_service as sb

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
FEEDBACK_DIR = os.path.join(UPLOAD_DIR, "feedbacks")
STATIC_DIR = os.path.join(BASE_DIR, "static")

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(FEEDBACK_DIR, exist_ok=True)
os.makedirs(STATIC_DIR, exist_ok=True)

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".bmp", ".gif"}
MAX_FILE_BYTES = 25 * 1024 * 1024   # 25MB per photo
MAX_FILES_PER_SUBMISSION = 30

# Refuse absurd pixel counts rather than letting Pillow allocate the whole heap
Image.MAX_IMAGE_PIXELS = 120_000_000


def remove_local_file(stored_path: str) -> None:
    """Deletes an uploaded file, refusing anything that resolves outside UPLOAD_DIR."""
    if not stored_path or stored_path.startswith(("http://", "https://")):
        return
    relative = stored_path.replace("/uploads/", "", 1).lstrip("/\\")
    target = os.path.abspath(os.path.join(UPLOAD_DIR, relative))
    if not target.startswith(os.path.abspath(UPLOAD_DIR) + os.sep):
        return
    try:
        if os.path.isfile(target):
            os.remove(target)
    except OSError as e:
        print(f"[Cleanup] Could not remove {target}: {e}")

# 로컬 DB 초기화
local_db.init_db()

app = FastAPI(title="TutorMark - 과외/멘토링 사진 과제 첨삭 시스템 (다중 이미지 지원)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 정적 파일 마운트
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

def optimize_image_bytes(image_bytes: bytes, max_dimension: int = 2560) -> bytes:
    """스마트폰 카메라 사진의 EXIF 회전 문제를 보정하고 고화질 최적화된 JPEG 바이트를 반환"""
    try:
        img_file = Image.open(io.BytesIO(image_bytes))
    except Exception:
        hint = ""
        if not HEIC_SUPPORTED:
            hint = " (HEIC 사진인 경우 'pip install pillow-heif'를 실행해주세요.)"
        raise HTTPException(status_code=400, detail=f"이미지 형식을 인식할 수 없습니다.{hint}")

    with img_file as img:
        img = ImageOps.exif_transpose(img)
        # JPEG has no alpha channel, so flatten anything that carries one
        if img.mode in ("RGBA", "LA", "P"):
            img = img.convert("RGB")
        elif img.mode != "RGB":
            img = img.convert("RGB")
            
        w, h = img.size
        if max(w, h) > max_dimension:
            scale = max_dimension / max(w, h)
            new_w, new_h = int(w * scale), int(h * scale)
            img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
            
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=90, optimize=True)
        return buf.getvalue()

@app.get("/")
async def serve_index():
    root_index = os.path.join(BASE_DIR, "index.html")
    static_index = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(root_index):
        return FileResponse(root_index)
    elif os.path.exists(static_index):
        return FileResponse(static_index)
    return {"message": "TutorMark Backend is running."}

# --- 시스템 상태 API ---
@app.get("/api/system/status")
def get_system_status():
    """Tells the browser how to reach Supabase.

    The key travels to the client, so only a public `anon` key is ever returned.
    A service_role key would grant full database access to anyone loading the page,
    so it is withheld and the client stays on the server-proxied API instead.
    """
    supabase_on = sb.is_supabase_enabled()
    if not supabase_on:
        return {
            "supabase_enabled": False,
            "storage_mode": "Local SQLite & Storage",
            "supabase_url": None,
            "supabase_key": None,
            "supabase_bucket": None,
            "heic_supported": HEIC_SUPPORTED
        }

    client_safe = sb.is_anon_key()
    if not client_safe:
        print("[Security] SUPABASE_KEY is not an anon key - withholding it from the browser.")

    return {
        "supabase_enabled": True,
        "storage_mode": "Supabase Storage & PostgreSQL",
        "supabase_url": sb.SUPABASE_URL if client_safe else None,
        "supabase_key": sb.SUPABASE_KEY if client_safe else None,
        "supabase_bucket": sb.SUPABASE_BUCKET if client_safe else None,
        "client_direct_access": client_safe,
        "key_role": sb.get_key_role(),
        "heic_supported": HEIC_SUPPORTED
    }

# --- 학생 API ---
@app.get("/api/students")
def get_students():
    return sb.get_all_students()

class StudentCreate(BaseModel):
    name: str
    grade: Optional[str] = ""
    pin: Optional[str] = "0000"
    avatar_color: Optional[str] = "#3B82F6"

@app.post("/api/students")
def add_student(student: StudentCreate):
    student_id = sb.add_student(student.name, student.grade, student.pin, student.avatar_color)
    return {"id": student_id, "message": "학생이 등록되었습니다."}

# --- 과제 제출 API (다중 이미지 지원) ---
@app.get("/api/submissions")
def get_submissions(student_id: Optional[int] = None, status: Optional[str] = None):
    return sb.get_submissions(student_id=student_id, status=status)

@app.get("/api/submissions/{submission_id}")
def get_submission(submission_id: int):
    sub = sb.get_submission_detail(submission_id)
    if not sub:
        raise HTTPException(status_code=404, detail="과제를 찾을 수 없습니다.")
    return sub

@app.post("/api/submissions")
async def create_submission(
    student_id: int = Form(...),
    student_name: str = Form(...),
    subject: str = Form(...),
    title: str = Form(...),
    memo: str = Form(""),
    files: List[UploadFile] = File(...)
):
    if not files:
        raise HTTPException(status_code=400, detail="업로드할 사진 파일이 없습니다.")
    if len(files) > MAX_FILES_PER_SUBMISSION:
        raise HTTPException(
            status_code=400,
            detail=f"한 번에 올릴 수 있는 사진은 최대 {MAX_FILES_PER_SUBMISSION}장입니다."
        )
    if not title.strip():
        raise HTTPException(status_code=400, detail="과제 제목을 입력해주세요.")

    saved_image_urls = []
    try:
        for idx, file in enumerate(files):
            ext = os.path.splitext(file.filename or "")[1].lower()
            if ext not in ALLOWED_EXTENSIONS:
                ext = ".jpg"

            content = await file.read()
            if not content:
                raise HTTPException(status_code=400, detail=f"{idx + 1}번째 사진이 비어 있습니다.")
            if len(content) > MAX_FILE_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail=f"{idx + 1}번째 사진이 너무 큽니다. (최대 {MAX_FILE_BYTES // (1024 * 1024)}MB)"
                )

            # Everything is normalised to JPEG, so the stored name always ends in .jpg
            unique_filename = f"sub_{uuid.uuid4().hex[:10]}_p{idx + 1}.jpg"
            optimized_bytes = optimize_image_bytes(content)

            if sb.is_supabase_enabled():
                url = sb.upload_image_to_storage(optimized_bytes, unique_filename, "image/jpeg")
            else:
                dest_path = os.path.join(UPLOAD_DIR, unique_filename)
                with open(dest_path, "wb") as f:
                    f.write(optimized_bytes)
                url = f"/uploads/{unique_filename}"

            saved_image_urls.append(url)

        sub_id = sb.create_submission(
            student_id=student_id,
            student_name=student_name,
            subject=subject,
            title=title,
            memo=memo,
            image_urls_list=saved_image_urls
        )
        return {
            "id": sub_id, 
            "image_urls": saved_image_urls, 
            "image_count": len(saved_image_urls),
            "message": f"과제 사진 {len(saved_image_urls)}장이 성공적으로 제출되었습니다."
        }
    except HTTPException:
        # A validation failure must keep its own status code instead of becoming a 500
        for url in saved_image_urls:
            remove_local_file(url)
        raise
    except Exception as e:
        for url in saved_image_urls:
            remove_local_file(url)
        raise HTTPException(status_code=500, detail=f"과제 업로드 실패: {str(e)}")

@app.delete("/api/submissions/{submission_id}")
def delete_submission(submission_id: int):
    if not sb.get_submission_detail(submission_id):
        raise HTTPException(status_code=404, detail="과제를 찾을 수 없습니다.")

    try:
        result = sb.delete_submission(submission_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"과제 삭제 실패: {str(e)}")

    # In local mode the DB cascade drops the rows; the files on disk are ours to clean up
    if isinstance(result, dict):
        for stored in result.get("original_images", []):
            remove_local_file(stored)
        for stored in result.get("feedback_images", []):
            remove_local_file(stored)

    return {"message": "과제와 첨삭 기록이 삭제되었습니다."}

# --- 교사 첨삭 피드백 API ---
class FeedbackCreate(BaseModel):
    submission_id: int
    page_index: Optional[int] = 0
    teacher_name: Optional[str] = "선생님"
    comment: Optional[str] = ""
    annotated_image_base64: str
    annotation_data: Optional[str] = "{}"

@app.post("/api/feedbacks")
def create_feedback(fb: FeedbackCreate):
    if not fb.annotated_image_base64:
        raise HTTPException(status_code=400, detail="첨삭 이미지 데이터가 비어 있습니다.")
    if fb.page_index < 0:
        raise HTTPException(status_code=400, detail="잘못된 페이지 번호입니다.")
    if not sb.get_submission_detail(fb.submission_id):
        raise HTTPException(status_code=404, detail="대상 과제를 찾을 수 없습니다.")

    try:
        base64_data = fb.annotated_image_base64
        if "," in base64_data:
            header, base64_data = base64_data.split(",", 1)

        try:
            img_bytes = base64.b64decode(base64_data, validate=True)
        except Exception:
            raise HTTPException(status_code=400, detail="첨삭 이미지 데이터가 올바르지 않습니다.")

        optimized_bytes = optimize_image_bytes(img_bytes)
        
        unique_filename = f"fb_{uuid.uuid4().hex[:10]}_p{fb.page_index + 1}.jpg"
        annotated_image_url = ""
        
        if sb.is_supabase_enabled():
            annotated_image_url = sb.upload_image_to_storage(optimized_bytes, f"feedbacks/{unique_filename}", "image/jpeg")
        else:
            dest_path = os.path.join(FEEDBACK_DIR, unique_filename)
            with open(dest_path, "wb") as f:
                f.write(optimized_bytes)
            annotated_image_url = f"/uploads/feedbacks/{unique_filename}"
        
        feedback_id = sb.create_feedback(
            submission_id=fb.submission_id,
            teacher_name=fb.teacher_name,
            comment=fb.comment,
            annotated_image_url=annotated_image_url,
            annotation_data=fb.annotation_data,
            page_index=fb.page_index
        )
        
        return {
            "id": feedback_id,
            "page_index": fb.page_index,
            "annotated_image_url": annotated_image_url,
            "message": "첨삭 피드백이 등록되었습니다."
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"피드백 저장 실패: {str(e)}")

@app.delete("/api/feedbacks/{feedback_id}")
def delete_feedback(feedback_id: int):
    try:
        result = sb.delete_feedback(feedback_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"피드백 삭제 실패: {str(e)}")

    if not result:
        raise HTTPException(status_code=404, detail="피드백을 찾을 수 없습니다.")

    if isinstance(result, dict) and result.get("filename"):
        remove_local_file(result["filename"])

    return {"message": "피드백이 삭제되었습니다."}

# --- 대시보드 통계 & PIN 검증 ---
@app.get("/api/stats")
def get_stats():
    return sb.get_stats()

class PinVerify(BaseModel):
    pin: str

# Override with TEACHER_PIN in .env; comma-separated values allow more than one.
TEACHER_PINS = [
    p.strip() for p in os.getenv("TEACHER_PIN", "1234,0000,admin").split(",") if p.strip()
]

@app.post("/api/teacher/verify-pin")
def verify_teacher_pin(data: PinVerify):
    if data.pin.strip() in TEACHER_PINS:
        return {"success": True}
    return {"success": False, "message": "비밀번호가 일치하지 않습니다. (기본: 1234)"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)

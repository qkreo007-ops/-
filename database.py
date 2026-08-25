import sqlite3
import os
import json
from datetime import datetime
from typing import List, Optional

DB_PATH = os.path.join(os.path.dirname(__file__), "tutormark.db")

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()

    # 학생 테이블
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        grade TEXT DEFAULT '',
        pin TEXT DEFAULT '0000',
        avatar_color TEXT DEFAULT '#3B82F6',
        created_at TEXT NOT NULL
    )
    """)

    # 과제/사진 제출 테이블 (다중 이미지 지원)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL,
        student_name TEXT NOT NULL,
        subject TEXT NOT NULL,
        title TEXT NOT NULL,
        memo TEXT DEFAULT '',
        image_filename TEXT DEFAULT '',
        image_urls TEXT DEFAULT '[]', -- 다중 이미지 URL/파일명 JSON 배열
        status TEXT DEFAULT 'pending', -- 'pending' (대기중), 'reviewed' (첨삭완료)
        created_at TEXT NOT NULL,
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
    )
    """)

    # 기존 DB 스키마 마이그레이션 (image_urls 컬럼이 없는 경우 추가)
    cursor.execute("PRAGMA table_info(submissions)")
    columns = [col["name"] for col in cursor.fetchall()]
    if "image_urls" not in columns:
        cursor.execute("ALTER TABLE submissions ADD COLUMN image_urls TEXT DEFAULT '[]'")

    # 교사 첨삭 피드백 (댓글 형태, 대상 페이지 번호 추가)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS feedbacks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        submission_id INTEGER NOT NULL,
        page_index INTEGER DEFAULT 0, -- 첨삭 대상 사진 번호 (0부터 시작)
        teacher_name TEXT DEFAULT '선생님',
        comment TEXT DEFAULT '',
        annotated_image_filename TEXT NOT NULL,
        annotation_data TEXT DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
    )
    """)

    cursor.execute("PRAGMA table_info(feedbacks)")
    fb_columns = [col["name"] for col in cursor.fetchall()]
    if "page_index" not in fb_columns:
        cursor.execute("ALTER TABLE feedbacks ADD COLUMN page_index INTEGER DEFAULT 0")

    # 기본 학생 2명 생성 (초기 데이터)
    cursor.execute("SELECT COUNT(*) FROM students")
    count = cursor.fetchone()[0]
    if count == 0:
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        cursor.execute(
            "INSERT INTO students (name, grade, pin, avatar_color, created_at) VALUES (?, ?, ?, ?, ?)",
            ("민수 (학생 1)", "중등 수학/영어", "1111", "#3B82F6", now)
        )
        cursor.execute(
            "INSERT INTO students (name, grade, pin, avatar_color, created_at) VALUES (?, ?, ?, ?, ?)",
            ("서연 (학생 2)", "고등 수학/과학", "2222", "#10B981", now)
        )

    conn.commit()
    conn.close()

def parse_image_urls(sub_dict: dict) -> List[str]:
    """단일/다중 이미지 URL을 표준 리스트 형태로 정규화"""
    urls = []
    if sub_dict.get("image_urls"):
        try:
            urls = json.loads(sub_dict["image_urls"])
        except:
            urls = []
    if not urls and sub_dict.get("image_filename"):
        urls = [sub_dict["image_filename"]]
    if not urls and sub_dict.get("image_url"):
        urls = [sub_dict["image_url"]]
    return urls

def get_all_students():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM students ORDER BY id ASC")
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_student_by_id(student_id: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM students WHERE id = ?", (student_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def add_student(name: str, grade: str = "", pin: str = "0000", avatar_color: str = "#3B82F6"):
    conn = get_db_connection()
    cursor = conn.cursor()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    cursor.execute(
        "INSERT INTO students (name, grade, pin, avatar_color, created_at) VALUES (?, ?, ?, ?, ?)",
        (name, grade, pin, avatar_color, now)
    )
    student_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return student_id

def create_submission(student_id: int, student_name: str, subject: str, title: str, memo: str, image_urls_list: List[str]):
    conn = get_db_connection()
    cursor = conn.cursor()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    first_image = image_urls_list[0] if image_urls_list else ""
    image_urls_json = json.dumps(image_urls_list)
    
    cursor.execute(
        """INSERT INTO submissions 
           (student_id, student_name, subject, title, memo, image_filename, image_urls, status, created_at) 
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)""",
        (student_id, student_name, subject, title, memo, first_image, image_urls_json, now)
    )
    submission_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return submission_id

def get_submissions(student_id: int = None, status: str = None):
    conn = get_db_connection()
    cursor = conn.cursor()
    query = "SELECT * FROM submissions WHERE 1=1"
    params = []
    
    if student_id:
        query += " AND student_id = ?"
        params.append(student_id)
    if status and status != 'all':
        query += " AND status = ?"
        params.append(status)
        
    query += " ORDER BY id DESC"

    # Pull the feedback tally in the same statement rather than issuing one COUNT per row
    joined = f"""
        SELECT s.*, (SELECT COUNT(*) FROM feedbacks f WHERE f.submission_id = s.id) AS feedback_count
        FROM ({query}) AS s
    """
    cursor.execute(joined, params)
    rows = cursor.fetchall()

    submissions = []
    for r in rows:
        sub_dict = dict(r)
        sub_dict["images"] = parse_image_urls(sub_dict)
        submissions.append(sub_dict)

    conn.close()
    return submissions


def get_stats():
    """Dashboard counters in one connection, using COUNT instead of loading every row."""
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM students")
        student_count = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM submissions")
        total = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM submissions WHERE status = 'pending'")
        pending = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM submissions WHERE status = 'reviewed'")
        reviewed = cursor.fetchone()[0]
        return {
            "student_count": student_count,
            "total_submissions": total,
            "pending_count": pending,
            "reviewed_count": reviewed
        }
    finally:
        conn.close()

def get_submission_detail(submission_id: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM submissions WHERE id = ?", (submission_id,))
    sub_row = cursor.fetchone()
    if not sub_row:
        conn.close()
        return None
    
    submission = dict(sub_row)
    submission["images"] = parse_image_urls(submission)
    
    cursor.execute("SELECT * FROM feedbacks WHERE submission_id = ? ORDER BY id ASC", (submission_id,))
    feedback_rows = cursor.fetchall()
    submission["feedbacks"] = [dict(f) for f in feedback_rows]
    
    conn.close()
    return submission

def delete_submission(submission_id: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute("SELECT image_filename, image_urls FROM submissions WHERE id = ?", (submission_id,))
    sub = cursor.fetchone()
    images_to_delete = []
    if sub:
        images_to_delete = parse_image_urls(dict(sub))
    
    cursor.execute("SELECT annotated_image_filename FROM feedbacks WHERE submission_id = ?", (submission_id,))
    feedback_images = [f["annotated_image_filename"] for f in cursor.fetchall()]

    cursor.execute("DELETE FROM submissions WHERE id = ?", (submission_id,))
    conn.commit()
    conn.close()

    return {
        "original_images": images_to_delete,
        "feedback_images": feedback_images
    }

def create_feedback(submission_id: int, teacher_name: str, comment: str, annotated_image_filename: str, annotation_data: str = "{}", page_index: int = 0):
    conn = get_db_connection()
    cursor = conn.cursor()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    cursor.execute(
        """INSERT INTO feedbacks 
           (submission_id, page_index, teacher_name, comment, annotated_image_filename, annotation_data, created_at) 
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (submission_id, page_index, teacher_name, comment, annotated_image_filename, annotation_data, now)
    )
    feedback_id = cursor.lastrowid
    
    cursor.execute("UPDATE submissions SET status = 'reviewed' WHERE id = ?", (submission_id,))
    conn.commit()
    conn.close()
    return feedback_id

def delete_feedback(feedback_id: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT submission_id, annotated_image_filename FROM feedbacks WHERE id = ?", (feedback_id,))
    fb = cursor.fetchone()
    if not fb:
        conn.close()
        return None
    
    submission_id = fb["submission_id"]
    annotated_filename = fb["annotated_image_filename"]
    
    cursor.execute("DELETE FROM feedbacks WHERE id = ?", (feedback_id,))
    
    cursor.execute("SELECT COUNT(*) FROM feedbacks WHERE submission_id = ?", (submission_id,))
    count = cursor.fetchone()[0]
    if count == 0:
        cursor.execute("UPDATE submissions SET status = 'pending' WHERE id = ?", (submission_id,))
        
    conn.commit()
    conn.close()
    return {"submission_id": submission_id, "filename": annotated_filename}

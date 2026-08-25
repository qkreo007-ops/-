import os
import io
import base64
from PIL import Image, ImageDraw, ImageFont
from fastapi.testclient import TestClient

from app import app
import database as db

client = TestClient(app)

def create_dummy_image(page_num=1):
    """테스트용 시험지/문제집 모의 이미지 생성"""
    img = Image.new("RGB", (800, 600), color=(250, 250, 250))
    draw = ImageDraw.Draw(img)
    
    draw.rectangle([(20, 20), (780, 580)], outline=(200, 200, 200), width=2)
    draw.text((40, 40), f"[수학 모의고사 - {page_num}페이지]", fill=(30, 30, 30))
    draw.text((40, 80), f"문제 {page_num}: 다음 방정식을 풀고 해를 구하시오.", fill=(50, 50, 50))
    draw.text((40, 150), f"학생 풀이 ({page_num}페이지): x = {page_num * 2}", fill=(20, 40, 180))
    
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()

def create_dummy_annotated_base64(page_num=1):
    """선생님 첨삭이 들어간 합성 이미지 생성 (Base64)"""
    img = Image.new("RGB", (800, 600), color=(250, 250, 250))
    draw = ImageDraw.Draw(img)
    
    draw.text((40, 40), f"[수학 모의고사 - {page_num}페이지 첨삭]", fill=(30, 30, 30))
    draw.ellipse([(40, 130), (240, 200)], outline=(239, 68, 68), width=5)
    draw.text((260, 160), f"<- {page_num}페이지 정답! 훌륭합니다.", fill=(239, 68, 68))
    
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
    return f"data:image/jpeg;base64,{b64}"

def test_multi_image_workflow():
    print("=== [1] 학생 목록 조회 테스트 ===")
    res = client.get("/api/students")
    assert res.status_code == 200
    students = res.json()
    assert len(students) >= 2
    student1 = students[0]
    print(f"학생 1: {student1['name']}")

    print("\n=== [2] 다중 사진 과제 업로드 테스트 (3장 제출) ===")
    img1 = create_dummy_image(1)
    img2 = create_dummy_image(2)
    img3 = create_dummy_image(3)

    files = [
        ("files", ("page1.jpg", img1, "image/jpeg")),
        ("files", ("page2.jpg", img2, "image/jpeg")),
        ("files", ("page3.jpg", img3, "image/jpeg"))
    ]
    data = {
        "student_id": student1["id"],
        "student_name": student1["name"],
        "subject": "수학",
        "title": "쎈 수학 38p~40p 총 3장 풀이",
        "memo": "2페이지 5번 문제가 헷갈려요!"
    }

    upload_res = client.post("/api/submissions", data=data, files=files)
    assert upload_res.status_code == 200
    upload_json = upload_res.json()
    submission_id = upload_json["id"]
    print(f"다중 과제 업로드 성공! ID: {submission_id}, 총 사진 수: {upload_json['image_count']}")
    assert upload_json["image_count"] == 3

    print("\n=== [3] 과제 상세 조회 및 다중 이미지 확인 ===")
    detail_res = client.get(f"/api/submissions/{submission_id}")
    assert detail_res.status_code == 200
    detail = detail_res.json()
    print(f"조회된 과제 이미지 리스트: {len(detail['images'])}개")
    assert len(detail["images"]) == 3

    print("\n=== [4] 1페이지 및 2페이지 개별 첨삭 댓글 등록 ===")
    # 1페이지 첨삭
    fb1_res = client.post("/api/feedbacks", json={
        "submission_id": submission_id,
        "page_index": 0,
        "teacher_name": "선생님",
        "comment": "1페이지 완벽합니다!",
        "annotated_image_base64": create_dummy_annotated_base64(1)
    })
    assert fb1_res.status_code == 200

    # 2페이지 첨삭
    fb2_res = client.post("/api/feedbacks", json={
        "submission_id": submission_id,
        "page_index": 1,
        "teacher_name": "선생님",
        "comment": "2페이지 5번 문제 부호 주의하세요!",
        "annotated_image_base64": create_dummy_annotated_base64(2)
    })
    assert fb2_res.status_code == 200
    print("1페이지, 2페이지 첨삭 댓글 등록 성공!")

    print("\n=== [5] 첨삭 후 상태 및 피드백 목록 확인 ===")
    sub_after = client.get(f"/api/submissions/{submission_id}").json()
    print(f"상태: {sub_after['status']}, 피드백 수: {len(sub_after['feedbacks'])}")
    assert sub_after["status"] == "reviewed"
    assert len(sub_after["feedbacks"]) == 2
    assert sub_after["feedbacks"][0]["page_index"] == 0
    assert sub_after["feedbacks"][1]["page_index"] == 1

    print("\n[SUCCESS] Multi-image submission and per-page feedback test passed successfully!")

if __name__ == "__main__":
    test_multi_image_workflow()

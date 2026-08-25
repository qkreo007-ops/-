import subprocess
import time
import os
import requests
from playwright.sync_api import sync_playwright

def run_browser_test():
    proc = subprocess.Popen(["python", "app.py"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    time.sleep(2.5)

    try:
        r = requests.get("http://127.0.0.1:8000/api/students")
        assert r.status_code == 200, "Server not responding"

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 1280, "height": 800})
            
            page.goto("http://127.0.0.1:8000/")
            page.wait_for_selector("#submission-title")
            os.makedirs("screenshots", exist_ok=True)

            # 1. Take screenshot of student mode
            page.screenshot(path="screenshots/01_student_view.png")
            print("[OK] Student View screenshot saved")

            # 2. Click on the first submission in the list to open Detail Modal
            page.click("#student-submissions-list button:has-text('보기')")
            page.wait_for_selector("#submission-detail-modal:not(.hidden)", timeout=5000)
            time.sleep(0.5)
            page.screenshot(path="screenshots/04_detail_modal.png")
            print("[OK] Detail Modal screenshot saved")

            # 3. Click on the first photo in the gallery inside the Detail Modal to test Lightbox on top of modal!
            page.click("#modal-photos-gallery div:first-child")
            page.wait_for_selector("#image-lightbox-modal:not(.hidden)", timeout=5000)
            time.sleep(0.5)
            page.screenshot(path="screenshots/05_lightbox_top_layer.png")
            print("[OK] Lightbox on top of Modal screenshot saved")

            # Close lightbox with ESC
            page.keyboard.press("Escape")
            time.sleep(0.5)

            # Close detail modal
            page.click("#submission-detail-modal button:has-text('닫기')")
            time.sleep(0.5)

            # 4. Switch to Teacher mode
            page.on("dialog", lambda dialog: dialog.accept("1234"))
            page.click("#btn-mode-teacher")
            page.wait_for_selector("#teacher-view:not(.hidden)", timeout=5000)
            page.screenshot(path="screenshots/02_teacher_dashboard.png")
            print("[OK] Teacher View screenshot saved")

            # 5. Open Canvas Editor
            page.click("#teacher-submissions-list button:has-text('첨삭')")
            page.wait_for_selector("#canvas-editor-modal:not(.hidden)", timeout=5000)
            time.sleep(1.0)
            page.screenshot(path="screenshots/03_canvas_editor_modal.png")
            print("[OK] Canvas Editor screenshot saved")

            browser.close()
    finally:
        proc.terminate()

if __name__ == "__main__":
    run_browser_test()
    print("[SUCCESS] All UI and Lightbox Layer tests passed successfully!")

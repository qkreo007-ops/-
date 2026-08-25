# -*- coding: utf-8 -*-
"""TutorMark 전체 기능 자동 검증 (실제 브라우저 구동).

  python verify_e2e.py

로컬 SQLite 모드로 임시 서버를 띄워 업로드 -> 캔버스 첨삭 -> 저장 -> 삭제까지
전 과정을 확인합니다. 테스트로 만든 과제와 사진은 마지막에 스스로 지웁니다.
필요 패키지: playwright, requests, pillow  (playwright install chromium)
"""
import io
import os
import subprocess
import sys
import time

import requests
import functools
from PIL import Image
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8123"
HERE = os.path.dirname(os.path.abspath(__file__))

results = []
console_errors = []


def check(name, condition, detail=""):
    results.append((name, bool(condition), detail))
    mark = "PASS" if condition else "FAIL"
    print(f"[{mark}] {name}" + (f"  -> {detail}" if detail and not condition else ""), flush=True)
    return bool(condition)


def make_photo(path, color, label):
    img = Image.new("RGB", (900, 1200), color)
    for x in range(0, 900, 60):
        for y in range(0, 1200, 60):
            if (x // 60 + y // 60) % 2 == 0:
                img.paste((255, 255, 255), (x, y, x + 30, y + 30))
    img.save(path, "JPEG", quality=88)
    return path


def main():
    env = dict(os.environ)
    env["SUPABASE_URL"] = ""
    env["SUPABASE_KEY"] = ""
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", "8123"],
        cwd=HERE, env=env, stdout=open('server_local.log', "wb"), stderr=subprocess.STDOUT,
    )
    try:
        for _ in range(60):
            try:
                if requests.get(f"{BASE}/api/system/status", timeout=1).ok:
                    break
            except Exception:
                time.sleep(0.4)
        else:
            raise RuntimeError("server never came up")

        status = requests.get(f"{BASE}/api/system/status").json()
        check("status endpoint reports local mode", status["supabase_enabled"] is False, str(status))
        check("status endpoint does not leak a key", status.get("supabase_key") in (None, ""), str(status))

        photos = [
            make_photo(os.path.join(HERE, "t1.jpg"), (240, 230, 210), "p1"),
            make_photo(os.path.join(HERE, "t2.jpg"), (210, 235, 240), "p2"),
            make_photo(os.path.join(HERE, "t3.jpg"), (235, 215, 235), "p3"),
        ]

        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 1500, "height": 950})
            page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

            # A single persistent dialog handler: one-shot page.once() hooks deadlock the
            # sync API when the dialog opens while a click is still in flight.
            dialog_plan = []   # list of ("accept"/"dismiss", text)
            dialog_seen_log = []

            def handle_dialog(d):
                dialog_seen_log.append(d.message)
                action, text = dialog_plan.pop(0) if dialog_plan else ("accept", "")
                try:
                    if action == "accept":
                        d.accept(text)
                    else:
                        d.dismiss()
                except Exception:
                    pass

            page.on("dialog", handle_dialog)
            page.on("pageerror", lambda e: console_errors.append(f"PAGEERROR: {e}"))

            page.goto(BASE)
            page.wait_for_selector("#submission-title")
            page.wait_for_timeout(1200)

            # --- connection precedence: server said local, config.js must not hijack ---
            badge = page.inner_text("#supabase-status-badge")
            check("badge shows local mode (config.js did not override server)", "로컬" in badge, badge)
            check("no supabase client created", page.evaluate("state.supabaseClient === null"))

            # --- student upload of three photos ---
            page.set_input_files("#student-photo-input", photos)
            page.wait_for_timeout(400)
            thumbs = page.eval_on_selector_all("#photo-thumbnails-grid > div", "els => els.length")
            check("three previews rendered", thumbs == 3, f"got {thumbs}")
            check("blob urls tracked for revocation",
                  page.evaluate("state.previewObjectUrls.length") == 3)

            page.fill("#submission-title", "쎈 수학 38~40p \"부호\" 연습 & 복습")
            page.fill("#submission-memo", "2페이지 5번 문제가 헷갈려요")
            page.click("#btn-submit-work")
            page.wait_for_timeout(2500)

            cards = page.eval_on_selector_all("#student-submissions-list > div", "e => e.length")
            check("submission card appears", cards >= 1, f"got {cards}")
            check("preview strip cleared and blob urls revoked",
                  page.evaluate("state.previewObjectUrls.length") == 0)

            subs = requests.get(f"{BASE}/api/submissions").json()
            newest = subs[0]
            sub_id = newest["id"]
            check("three images stored", len(newest["images"]) == 3, str(newest["images"]))
            check("quotes in title survived round-trip", '"부호"' in newest["title"], newest["title"])

            # --- teacher mode ---
            dialog_plan.append(("accept", "1234"))
            page.click("#btn-mode-teacher")
            page.wait_for_timeout(1200)
            check("teacher view visible",
                  not page.is_hidden("#teacher-view"))

            # --- canvas editor ---
            page.click(f"text=사진 확대 및 마우스/글자 첨삭하기 >> nth=0")
            page.wait_for_timeout(2000)
            check("canvas modal open", not page.is_hidden("#canvas-editor-modal"))
            check("page indicator shows 3 pages",
                  "1 / 3" in page.inner_text("#canvas-page-indicator"),
                  page.inner_text("#canvas-page-indicator"))
            check("image loaded into editor", page.evaluate("state.canvasEditor.imageLoaded"))

            box = page.query_selector("#canvas-container").bounding_box()
            cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2

            def draw(dx1, dy1, dx2, dy2):
                page.mouse.move(cx + dx1, cy + dy1)
                page.mouse.down()
                for i in range(1, 9):
                    page.mouse.move(cx + dx1 + (dx2 - dx1) * i / 8, cy + dy1 + (dy2 - dy1) * i / 8)
                page.mouse.up()
                page.wait_for_timeout(120)

            draw(-160, -80, -40, 40)
            check("pen stroke recorded", page.evaluate("state.canvasEditor.objects.length") == 1,
                  str(page.evaluate("state.canvasEditor.objects.length")))

            # stroke that leaves the canvas mid-drag must still commit (pointer capture)
            page.mouse.move(cx, cy + 100)
            page.mouse.down()
            page.mouse.move(cx + 300, cy + 120)
            page.mouse.move(box["x"] + box["width"] + 260, cy + 140)  # outside the container
            page.mouse.up()
            page.wait_for_timeout(150)
            check("stroke dragged outside the canvas still committed",
                  page.evaluate("state.canvasEditor.objects.length") == 2,
                  str(page.evaluate("state.canvasEditor.objects.length")))

            # --- text tool: spaces must reach the box, not trigger pan ---
            page.click('[data-tool="text"]')
            page.mouse.click(cx - 100, cy - 160)
            page.wait_for_timeout(300)
            check("text overlay opened", page.query_selector(".canvas-text-overlay") is not None)
            page.keyboard.type("부호 주의 하세요")
            page.wait_for_timeout(150)
            typed = page.eval_on_selector(".canvas-text-overlay", "el => el.innerText")
            check("spaces typed into the text box", typed.count(" ") == 2, repr(typed))
            page.keyboard.press("Enter")
            page.wait_for_timeout(250)
            texts = page.evaluate("state.canvasEditor.objects.filter(o => o.type === 'text').length")
            check("text annotation committed", texts == 1, str(texts))
            check("committed text keeps its spaces",
                  page.evaluate("state.canvasEditor.objects.find(o=>o.type==='text').text") == "부호 주의 하세요",
                  page.evaluate("JSON.stringify(state.canvasEditor.objects.find(o=>o.type==='text').text)"))

            # --- Escape must cancel, not commit ---
            page.mouse.click(cx + 150, cy - 160)
            page.wait_for_timeout(250)
            page.keyboard.type("버려질 텍스트")
            page.keyboard.press("Escape")
            page.wait_for_timeout(250)
            check("Escape discards the text instead of committing it",
                  page.evaluate("state.canvasEditor.objects.filter(o=>o.type==='text').length") == 1)

            # --- undo / redo ---
            before = page.evaluate("state.canvasEditor.objects.length")
            page.click("#btn-canvas-undo")
            page.wait_for_timeout(150)
            check("undo removes one object",
                  page.evaluate("state.canvasEditor.objects.length") == before - 1)
            page.click("#btn-canvas-redo")
            page.wait_for_timeout(150)
            check("redo restores it",
                  page.evaluate("state.canvasEditor.objects.length") == before)

            # --- eraser is undoable (it was not before) ---
            page.click('[data-tool="eraser"]')
            page.mouse.move(cx - 160, cy - 80)
            page.mouse.down()
            page.mouse.move(cx - 40, cy + 40)
            page.mouse.up()
            page.wait_for_timeout(250)
            after_erase = page.evaluate("state.canvasEditor.objects.length")
            check("eraser removed something", after_erase < before, f"{before} -> {after_erase}")
            page.click("#btn-canvas-undo")
            page.wait_for_timeout(200)
            check("undo brings the erased strokes back",
                  page.evaluate("state.canvasEditor.objects.length") == before,
                  f"got {page.evaluate('state.canvasEditor.objects.length')}, want {before}")

            # --- clear all is undoable ---
            dialog_plan.append(("accept", ""))
            page.click("#btn-canvas-clear")
            page.wait_for_timeout(300)
            check("clear all empties the canvas",
                  page.evaluate("state.canvasEditor.objects.length") == 0)
            page.click("#btn-canvas-undo")
            page.wait_for_timeout(200)
            check("undo after clear-all restores everything",
                  page.evaluate("state.canvasEditor.objects.length") == before)

            # --- THE headline bug: page switching used to throw on a missing method ---
            errs_before = len(console_errors)
            page.click("#btn-canvas-next-page")
            page.wait_for_timeout(1800)
            check("page switch advanced the indicator",
                  "2 / 3" in page.inner_text("#canvas-page-indicator"),
                  page.inner_text("#canvas-page-indicator"))
            check("page switch raised no JS error",
                  len(console_errors) == errs_before,
                  str(console_errors[errs_before:]))
            check("page 2 starts with a clean canvas",
                  page.evaluate("state.canvasEditor.objects.length") == 0)
            check("page 1 annotations were cached",
                  page.evaluate("state.pageAnnotations[0].length") == before)

            page.click("#btn-canvas-prev-page")
            page.wait_for_timeout(1800)
            check("going back restores page 1 annotations",
                  page.evaluate("state.canvasEditor.objects.length") == before,
                  str(page.evaluate("state.canvasEditor.objects.length")))

            # --- save page 1 -> should advance, not close ---
            page.fill("#canvas-feedback-comment", "부호 실수가 많아요. 다시 확인!")
            page.click("#btn-save-feedback")
            page.wait_for_timeout(4000)
            check("editor stays open after saving a non-final page",
                  not page.is_hidden("#canvas-editor-modal"))
            check("auto-advanced to page 2",
                  "2 / 3" in page.inner_text("#canvas-page-indicator"),
                  page.inner_text("#canvas-page-indicator"))
            check("comment box cleared for the new page",
                  page.eval_on_selector("#canvas-feedback-comment", "e => e.value") == "")

            # close with unsaved work -> must warn
            page.click('[data-tool="pen"]')
            draw(-80, -80, 60, 60)
            seen_before = len(dialog_seen_log)
            dialog_plan.append(("dismiss", ""))
            page.click("#canvas-editor-modal >> text=취소")
            page.wait_for_timeout(600)
            check("closing with unsaved strokes asks for confirmation",
                  len(dialog_seen_log) > seen_before, str(dialog_seen_log[-1:]))
            check("dismissing the prompt keeps the editor open",
                  not page.is_hidden("#canvas-editor-modal"))

            dialog_plan.append(("accept", ""))
            page.click("#canvas-editor-modal >> text=취소")
            page.wait_for_timeout(800)
            check("accepting the prompt closes the editor", page.is_hidden("#canvas-editor-modal"))

            # --- feedback round-trip ---
            detail = requests.get(f"{BASE}/api/submissions/{sub_id}").json()
            check("feedback persisted", len(detail["feedbacks"]) == 1, str(len(detail["feedbacks"])))
            fb = detail["feedbacks"][0]
            check("feedback image reachable",
                  requests.get(BASE + fb["annotated_image_filename"]).status_code == 200,
                  fb["annotated_image_filename"])
            import json as _json
            parsed = _json.loads(fb["annotation_data"])
            check("annotation_data stored as a real array (not double-encoded)",
                  isinstance(parsed, list) and len(parsed) == before,
                  f"{type(parsed).__name__} len={len(parsed) if isinstance(parsed, list) else 'n/a'}")
            check("submission flipped to reviewed", detail["status"] == "reviewed", detail["status"])

            # --- reopening restores the saved strokes ---
            page.reload()
            page.wait_for_timeout(1500)
            dialog_plan.append(("accept", "1234"))
            page.click("#btn-mode-teacher")
            page.wait_for_timeout(1200)
            page.click("text=사진 확대 및 마우스/글자 첨삭하기 >> nth=0")
            page.wait_for_timeout(2500)
            check("saved annotations reloaded into the editor",
                  page.evaluate("state.canvasEditor.objects.length") == before,
                  str(page.evaluate("state.canvasEditor.objects.length")))
            dialog_plan.append(("accept", ""))
            page.keyboard.press("Escape")
            page.wait_for_timeout(600)
            check("Escape closes the canvas editor", page.is_hidden("#canvas-editor-modal"))

            # --- detail modal + lightbox ---
            page.click("text=과제 & 첨삭 피드백 >> nth=0")
            page.wait_for_timeout(1500)
            check("detail modal open", not page.is_hidden("#submission-detail-modal"))
            gal = page.eval_on_selector_all("#modal-photos-gallery > div", "e => e.length")
            check("all three photos in the gallery", gal == 3, str(gal))

            page.click("#modal-photos-gallery > div >> nth=0")
            page.wait_for_timeout(900)
            check("lightbox opened from a title containing quotes",
                  not page.is_hidden("#image-lightbox-modal"))
            check("lightbox title carries the raw quotes",
                  '"부호"' in page.inner_text("#lightbox-title"),
                  page.inner_text("#lightbox-title"))

            vp = page.query_selector("#lightbox-viewport").bounding_box()
            page.mouse.move(vp["x"] + vp["width"] / 2, vp["y"] + vp["height"] / 2)
            page.mouse.down()
            page.mouse.move(vp["x"] + vp["width"] / 2 + 120, vp["y"] + vp["height"] / 2 + 60)
            page.mouse.up()
            page.wait_for_timeout(600)
            check("dragging inside the lightbox does not close it",
                  not page.is_hidden("#image-lightbox-modal"))
            page.click("#btn-close-lightbox")
            page.wait_for_timeout(400)
            check("close button works", page.is_hidden("#image-lightbox-modal"))

            browser.close()

        # --- API error codes ---
        check("missing submission returns 404",
              requests.get(f"{BASE}/api/submissions/999999").status_code == 404)
        check("missing feedback delete returns 404 (was 500)",
              requests.delete(f"{BASE}/api/feedbacks/999999").status_code == 404)
        check("feedback for an unknown submission returns 404 (was 500)",
              requests.post(f"{BASE}/api/feedbacks", json={
                  "submission_id": 999999, "annotated_image_base64": "data:image/jpeg;base64,/9j/4AAQ"
              }).status_code == 404)
        check("garbage image data returns 400 (was 500)",
              requests.post(f"{BASE}/api/feedbacks", json={
                  "submission_id": sub_id, "annotated_image_base64": "data:image/jpeg;base64,####"
              }).status_code == 400)
        check("submission without files returns 422/400",
              requests.post(f"{BASE}/api/submissions", data={
                  "student_id": 1, "student_name": "x", "subject": "수학", "title": "t"
              }).status_code in (400, 422))

        # --- deletion cleans up files on disk ---
        detail = requests.get(f"{BASE}/api/submissions/{sub_id}").json()
        on_disk = [os.path.join(HERE, p.lstrip("/")) for p in detail["images"]]
        on_disk += [os.path.join(HERE, f["annotated_image_filename"].lstrip("/"))
                    for f in detail["feedbacks"]]
        check("files exist before delete", all(os.path.isfile(p) for p in on_disk),
              str([p for p in on_disk if not os.path.isfile(p)]))
        requests.delete(f"{BASE}/api/submissions/{sub_id}")
        time.sleep(0.6)
        leftovers = [p for p in on_disk if os.path.isfile(p)]
        check("delete removed the image files from disk (they used to be orphaned)",
              not leftovers, str(leftovers))
        check("submission row gone",
              requests.get(f"{BASE}/api/submissions/{sub_id}").status_code == 404)

        real_errors = [e for e in console_errors if "favicon" not in e.lower()]
        check("no uncaught JS errors during the whole run", not real_errors, str(real_errors[:5]))

    finally:
        proc.terminate()
        try:
            proc.wait(timeout=8)
        except Exception:
            proc.kill()

    passed = sum(1 for _, ok, _ in results if ok)
    print("\n" + "=" * 62)
    print(f"  {passed}/{len(results)} checks passed")
    failed = [(n, d) for n, ok, d in results if not ok]
    if failed:
        print("  FAILURES:")
        for n, d in failed:
            print(f"   - {n}  [{d}]")
    print("=" * 62)
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())

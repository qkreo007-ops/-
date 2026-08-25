// TutorMark Supabase Client Configuration
// This enables static hosting (e.g. Cloudflare Pages) to connect to Supabase directly.
//
// ⚠️  이 파일은 .gitignore 대상이 아니므로 깃허브에 그대로 올라갑니다.
//     - 여기 들어가는 키는 반드시 **anon(공개) 키**여야 합니다. service_role 키는 절대 금지.
//     - anon 키는 공개되어도 되는 키지만, 보호는 전적으로 Supabase RLS 정책에 달려 있습니다.
//       supabase_schema.sql의 기본 정책은 `USING (true)` 이므로 주소를 아는 누구나
//       모든 과제/첨삭을 읽고 쓰고 지울 수 있습니다. 공개 배포 시에는 RLS를 반드시 강화하세요.
//     - 백엔드(app.py)를 함께 띄우는 경우, 서버가 응답하면 이 값은 무시되고 서버 설정이 우선합니다.
window.SUPABASE_CONFIG = {
  url: "https://fihybhvjtzqatddaupej.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZpaHliaHZqdHpxYXRkZGF1cGVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1NzAwODYsImV4cCI6MjEwMzE0NjA4Nn0.asrtgx3ryN0IQcPLo4ucWd_6TvuO1vGTrZ-ddjEHGwI",
  bucket: "tutormark-files"
};

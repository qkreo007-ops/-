# 🛡️ Supabase 키 보안 및 Cloudflare 안전 배포 가이드

깃허브(GitHub) 공개 저장소에 Supabase URL과 API Key가 노출되지 않도록 보호하고, **Cloudflare(클라우드플레어)** 환경 변수를 통해 안전하게 배포하는 단계별 가이드입니다.

---

## 1. 깃허브(GitHub) 키 유출 방지 확인

이미 프로젝트 루트에 [`.gitignore`](file:///c:/Users/박대현/Downloads/학생이%20사진%20찍어%20올리고%20그%20이미지%20위에%20마우스로%20그림그리거나%20키보드로%20글자를%20치는/.gitignore) 설정이 완료되었습니다.

- `.env` 파일은 `git add .` 및 `git commit` 시 **자동으로 제외**되어 깃허브에 절대로 업로드되지 않습니다.
- 깃허브에는 키가 없는 템플릿 파일인 `.env.example`만 올라갑니다.

### ⚠️ 단, `static/js/config.js`는 예외입니다

`.env`와 달리 **`static/js/config.js`는 `.gitignore` 대상이 아니므로 깃허브에 그대로 올라갑니다.**
이 파일은 백엔드 없이 정적 호스팅만 할 때 브라우저가 Supabase에 직접 붙기 위한 설정이라 어차피
공개되는 값이지만, 아래 두 가지를 반드시 확인하세요.

| 확인 항목 | 설명 |
|---|---|
| **anon 키만 넣을 것** | `service_role` 키를 넣으면 페이지를 여는 누구나 DB 전체 권한을 갖게 됩니다. 서버(`app.py`)와 Cloudflare Function은 키의 `role` 클레임을 검사해 anon이 아니면 브라우저에 내려보내지 않습니다. |
| **RLS 정책을 조일 것** | anon 키의 실제 방어선은 Supabase RLS입니다. `supabase_schema.sql`의 기본 정책은 `USING (true)`(전체 허용)이므로, **주소를 아는 사람은 누구나 모든 학생의 과제와 첨삭을 읽고 지울 수 있습니다.** 가족·소수 과외용이 아니라면 배포 전에 정책을 반드시 강화하세요. |

키를 완전히 감추고 싶다면 `config.js`의 값을 비워 두고 **[방법 A]의 Cloudflare 환경 변수**만
사용하세요. 그러면 키는 `/api/system/status` Function을 통해서만 전달됩니다.

---

## 2. Cloudflare에 환경 변수(Secret Key) 등록 방법

### 📌 [방법 A] Cloudflare Pages / Workers로 배포 시

Cloudflare Pages에 깃허브 저장소를 연결한 경우, 대시보드에서 환경 변수를 등록합니다.

```mermaid
flowchart LR
    A[내 컴퓨터의 코드] -->|git push| B[GitHub 레포지토리 (키 없음)]
    B -->|자동 배포 연동| C[Cloudflare Pages 빌드 환경]
    D[Cloudflare Dashboard 환경변수 설정] -->|안전한 Secret 주입| C
    C --> E[전 세계 서비스 배포 (HTTPS)]
```

#### 설정 단계:
1. **Cloudflare 대시보드** ([dash.cloudflare.com](https://dash.cloudflare.com))에 로그인합니다.
2. 좌측 메뉴에서 **Compute (Workers & Pages)** -> **Pages**로 이동합니다.
3. 생성한 TutorMark 프로젝트를 클릭합니다.
4. 상단 탭에서 **Settings (설정)** -> **Environment variables (환경 변수)**를 클릭합니다.
5. **Add variables (변수 추가)**를 클릭하고 아래 3개의 값을 입력합니다:
   - **Variable name**: `SUPABASE_URL` / **Value**: `https://당신의프로젝트.supabase.co`
   - **Variable name**: `SUPABASE_KEY` / **Value**: `당신의-supabase-anon-key` (우측 **Encrypt/암호화** 버튼 클릭)
   - **Variable name**: `SUPABASE_BUCKET` / **Value**: `tutormark-files`
6. **Save (저장)**을 누르면 완료됩니다. 이제 배포 시 Cloudflare 내부에서만 안전하게 키가 로드됩니다.

---

### 📌 [방법 B] Cloudflare Tunnel 활용 (선생님 PC에서 직접 구동 시 - 추천)

선생님 PC에서 `python app.py`를 켜두고 줌(Zoom) 수업을 진행할 때, 학생들에게 안전한 무료 HTTPS 주소를 제공하는 가장 간단하고 강력한 방법입니다.

- **장점**: 깃허브에 아무것도 올릴 필요 없이 내 컴퓨터의 `.env` 파일만 사용하며, 외부에서 접속 가능한 무료 보안 도메인이 즉시 발급됩니다.

#### 1분 실행 방법:
1. [Cloudflare 공식 cloudflared 다운로드](https://github.com/cloudflare/cloudflared/releases) (Windows용 `cloudflared.exe`)
2. 터미널에서 아래 명령어 1줄 실행:
   ```bash
   cloudflared tunnel --url http://localhost:8000
   ```
3. 터미널에 생성되는 주소(예: `https://tutormark-xyz.trycloudflare.com`)를 학생에게 카톡이나 줌 채팅으로 공유하면 끝입니다!

---

## 3. 깃허브 업로드 및 푸시 절차

```bash
# 1. 깃 초기화 및 파일 추가
git init
git add .

# 2. .env 파일이 제외되었는지 상태 확인 (초록색 목록에 .env가 없어야 정상)
git status

# 3. 커밋 및 원격 저장소 푸시
git commit -m "Initial commit for TutorMark"
git branch -M main
git remote add origin https://github.com/당신의아이디/당신의레포지토리.git
git push -u origin main
```

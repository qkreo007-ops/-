-- ========================================================
-- TutorMark (과외/멘토링 사진 과제 첨삭 시스템) Supabase Schema (다중 이미지 지원)
-- Supabase 대시보드 -> SQL Editor에 복사하여 실행하세요.
-- ========================================================

-- 1. 학생 (Students) 테이블
CREATE TABLE IF NOT EXISTS students (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    grade TEXT DEFAULT '',
    pin TEXT DEFAULT '0000',
    avatar_color TEXT DEFAULT '#3B82F6',
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 2. 과제 제출 (Submissions) 테이블 (다중 이미지 지원)
CREATE TABLE IF NOT EXISTS submissions (
    id BIGSERIAL PRIMARY KEY,
    student_id BIGINT REFERENCES students(id) ON DELETE CASCADE,
    student_name TEXT NOT NULL,
    subject TEXT NOT NULL,
    title TEXT NOT NULL,
    memo TEXT DEFAULT '',
    image_url TEXT DEFAULT '',
    image_urls JSONB DEFAULT '[]'::jsonb, -- 다중 이미지 URL 목록
    status TEXT DEFAULT 'pending', -- 'pending' (대기중), 'reviewed' (첨삭완료)
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 기존 테이블이 있을 경우 컬럼 추가
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='submissions' AND column_name='image_urls') THEN
        ALTER TABLE submissions ADD COLUMN image_urls JSONB DEFAULT '[]'::jsonb;
    END IF;
END $$;

-- 3. 교사 첨삭 피드백 댓글 (Feedbacks) 테이블 (페이지 번호 지원)
CREATE TABLE IF NOT EXISTS feedbacks (
    id BIGSERIAL PRIMARY KEY,
    submission_id BIGINT REFERENCES submissions(id) ON DELETE CASCADE,
    page_index INTEGER DEFAULT 0, -- 첨삭 대상 사진 번호 (0, 1, 2...)
    teacher_name TEXT DEFAULT '선생님',
    comment TEXT DEFAULT '',
    annotated_image_url TEXT NOT NULL,
    annotation_data TEXT DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='feedbacks' AND column_name='page_index') THEN
        ALTER TABLE feedbacks ADD COLUMN page_index INTEGER DEFAULT 0;
    END IF;
END $$;

-- 4. 초기 학생 데이터 생성 (테이블이 비어있는 경우)
INSERT INTO students (name, grade, pin, avatar_color)
SELECT '민수 (학생 1)', '중등 수학/영어', '1111', '#3B82F6'
WHERE NOT EXISTS (SELECT 1 FROM students WHERE name LIKE '민수%');

INSERT INTO students (name, grade, pin, avatar_color)
SELECT '서연 (학생 2)', '고등 수학/과학', '2222', '#10B981'
WHERE NOT EXISTS (SELECT 1 FROM students WHERE name LIKE '서연%');

-- 5. RLS (Row Level Security) 설정
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedbacks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read students" ON students FOR SELECT USING (true);
CREATE POLICY "Allow public insert students" ON students FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update students" ON students FOR UPDATE USING (true);

CREATE POLICY "Allow public read submissions" ON submissions FOR SELECT USING (true);
CREATE POLICY "Allow public insert submissions" ON submissions FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update submissions" ON submissions FOR UPDATE USING (true);
CREATE POLICY "Allow public delete submissions" ON submissions FOR DELETE USING (true);

CREATE POLICY "Allow public read feedbacks" ON feedbacks FOR SELECT USING (true);
CREATE POLICY "Allow public insert feedbacks" ON feedbacks FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public delete feedbacks" ON feedbacks FOR DELETE USING (true);

-- ========================================================
-- TutorMark (과외/멘토링 사진 과제 첨삭 시스템) Supabase Schema
-- ========================================================

-- 1. 학생 (Students) 테이블 생성
CREATE TABLE IF NOT EXISTS public.students (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    grade TEXT DEFAULT '',
    pin TEXT DEFAULT '0000',
    avatar_color TEXT DEFAULT '#3B82F6',
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 2. 과제 제출 (Submissions) 테이블 생성 (다중 이미지 지원)
CREATE TABLE IF NOT EXISTS public.submissions (
    id BIGSERIAL PRIMARY KEY,
    student_id BIGINT REFERENCES public.students(id) ON DELETE CASCADE,
    student_name TEXT NOT NULL,
    subject TEXT NOT NULL,
    title TEXT NOT NULL,
    memo TEXT DEFAULT '',
    image_url TEXT DEFAULT '',
    image_urls JSONB DEFAULT '[]'::jsonb,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 3. 교사 첨삭 피드백 댓글 (Feedbacks) 테이블 생성
CREATE TABLE IF NOT EXISTS public.feedbacks (
    id BIGSERIAL PRIMARY KEY,
    submission_id BIGINT REFERENCES public.submissions(id) ON DELETE CASCADE,
    page_index INTEGER DEFAULT 0,
    teacher_name TEXT DEFAULT '선생님',
    comment TEXT DEFAULT '',
    annotated_image_url TEXT NOT NULL,
    annotation_data TEXT DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 4. 기본 학생 2명 생성 (초기 데이터)
INSERT INTO public.students (name, grade, pin, avatar_color)
SELECT '민수 (학생 1)', '중등 수학/영어', '1111', '#3B82F6'
WHERE NOT EXISTS (SELECT 1 FROM public.students WHERE name LIKE '민수%');

INSERT INTO public.students (name, grade, pin, avatar_color)
SELECT '서연 (학생 2)', '고등 수학/과학', '2222', '#10B981'
WHERE NOT EXISTS (SELECT 1 FROM public.students WHERE name LIKE '서연%');

-- 5. 테이블 RLS (Row Level Security) 설정
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedbacks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "students_policy" ON public.students;
CREATE POLICY "students_policy" ON public.students FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "submissions_policy" ON public.submissions;
CREATE POLICY "submissions_policy" ON public.submissions FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "feedbacks_policy" ON public.feedbacks;
CREATE POLICY "feedbacks_policy" ON public.feedbacks FOR ALL USING (true) WITH CHECK (true);

-- 6. Storage 버킷 ('tutormark-files') 생성 및 공개 접근 정책
INSERT INTO storage.buckets (id, name, public) 
VALUES ('tutormark-files', 'tutormark-files', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "storage_objects_policy" ON storage.objects;
CREATE POLICY "storage_objects_policy" ON storage.objects FOR ALL USING (bucket_id = 'tutormark-files') WITH CHECK (bucket_id = 'tutormark-files');

# 근태관리 PWA — 설치 및 배포 가이드

## 프로젝트 구조

```
pwa-attendance/
├── index.html          # 진입점 (세션 체크 후 라우팅)
├── login.html          # 로그인 / 회원가입
├── admin.html          # 관리자 대시보드
├── worker.html         # 근무자 출퇴근/미션
├── css/
│   └── style.css       # 다크모드 모바일 UI
├── js/
│   └── app.js          # Supabase 초기화 & 공통 인증
├── icons/              # PWA 아이콘 (직접 생성 필요)
├── manifest.json       # PWA 설정
├── service-worker.js   # 오프라인 캐싱
├── vercel.json         # Vercel 배포 설정
└── README.md
```

-----

## 1단계: Supabase 설정

### 1-1. 프로젝트 생성

1. [supabase.com](https://supabase.com) → 새 프로젝트 생성
1. Project URL과 anon key를 복사

### 1-2. `js/app.js` 수정

```js
const SUPABASE_URL = 'https://YOUR_PROJECT_ID.supabase.co';  // 실제 URL로 교체
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';                   // 실제 키로 교체
```

### 1-3. 데이터베이스 테이블 생성 (Supabase SQL Editor)

```sql
-- 1. users 테이블
CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'worker')),
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. attendance 테이블
CREATE TABLE public.attendance (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('checkin', 'checkout')),
  mission_text TEXT,
  photo_url TEXT,
  latitude FLOAT,
  longitude FLOAT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. schedules 테이블
CREATE TABLE public.schedules (
  id BIGSERIAL PRIMARY KEY,
  worker_name TEXT NOT NULL,
  location TEXT NOT NULL,
  work_date TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스
CREATE INDEX idx_attendance_user_id ON attendance(user_id);
CREATE INDEX idx_attendance_created_at ON attendance(created_at);
CREATE INDEX idx_schedules_work_date ON schedules(work_date);
```

### 1-4. RLS (Row Level Security) 정책 설정

```sql
-- users 테이블 RLS 활성화
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- 본인 프로필 읽기 허용
CREATE POLICY "users_select_own" ON public.users
  FOR SELECT USING (auth.uid() = id);

-- 관리자는 전체 읽기 허용
CREATE POLICY "users_select_admin" ON public.users
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
  );

-- 회원가입 시 insert 허용
CREATE POLICY "users_insert_self" ON public.users
  FOR INSERT WITH CHECK (auth.uid() = id);

-- attendance RLS
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;

-- 근무자 본인 기록 읽기/쓰기
CREATE POLICY "attendance_self" ON public.attendance
  FOR ALL USING (auth.uid() = user_id);

-- 관리자 전체 읽기
CREATE POLICY "attendance_admin_read" ON public.attendance
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
  );

-- schedules RLS
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;

-- 관리자 전체 접근
CREATE POLICY "schedules_admin" ON public.schedules
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
  );
```

### 1-5. Auth 트리거 (회원가입 시 users 테이블 자동 생성)

```sql
-- 함수: auth.users → public.users 자동 insert
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'worker')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 트리거 등록
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
```

### 1-6. Storage 버킷 설정

1. Supabase → Storage → New bucket
1. 버킷 이름: `photos`
1. **Public bucket** 체크 (공개 URL 발급용)
1. 허용 파일 크기: 10MB
1. 허용 MIME types: `image/*`

Storage 정책 (SQL):

```sql
-- 로그인 사용자는 자신의 폴더에 업로드 가능
CREATE POLICY "photos_insert_own" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'photos' AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- 모든 인증 사용자 읽기 허용
CREATE POLICY "photos_read_authenticated" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'photos' AND auth.role() = 'authenticated'
  );
```

-----

## 2단계: PWA 아이콘 생성

`icons/` 폴더에 아래 크기의 PNG 아이콘이 필요합니다:

- icon-72x72.png
- icon-96x96.png
- icon-128x128.png
- icon-144x144.png
- icon-152x152.png
- icon-192x192.png
- icon-384x384.png
- icon-512x512.png

**무료 아이콘 생성 도구:**

- [RealFaviconGenerator](https://realfavicongenerator.net)
- [PWA Builder Image Generator](https://www.pwabuilder.com/imageGenerator)

또는 임시로 단색 PNG를 생성하는 스크립트:

```bash
# ImageMagick이 설치된 경우
for size in 72 96 128 144 152 192 384 512; do
  convert -size ${size}x${size} xc:#6c63ff \
    -gravity Center -fill white -pointsize $((size/3)) \
    -annotate 0 "⏱" \
    icons/icon-${size}x${size}.png
done
```

-----

## 3단계: Vercel 배포

```bash
# Vercel CLI 설치
npm i -g vercel

# 프로젝트 루트에서
vercel

# 또는 GitHub에 push 후 Vercel 대시보드에서 연결
```

### 환경 변수 (선택사항)

Vercel 대시보드 → Settings → Environment Variables에 추가할 수 있지만,
이 프로젝트는 클라이언트 사이드 앱이므로 `js/app.js`에 직접 입력합니다.

-----

## 4단계: iOS PWA 홈 화면 추가

1. iPhone Safari에서 배포된 URL 접속
1. 하단 공유 버튼 탭
1. “홈 화면에 추가” 선택
1. 앱처럼 실행 확인

-----

## 주요 기능 요약

|기능     |설명                             |
|-------|-------------------------------|
|인증     |이메일/비밀번호 로그인 + 역할 기반 라우팅       |
|출근     |GPS + 사진 촬영 + 미션 텍스트 필수        |
|퇴근     |출근 후 활성화, 동일한 제출 프로세스          |
|중복 방지  |Supabase count 조회로 서버 사이드 검증   |
|관리자 조회 |날짜 필터 + 사진 미리보기 + 구글지도 링크      |
|엑셀 업로드 |SheetJS 파싱 → schedules 테이블 저장  |
|엑셀 다운로드|근태 기록 xlsx 로컬 저장               |
|PWA    |오프라인 캐싱, standalone 실행, iOS 최적화|

-----

## iOS Safari 특이사항

- **GPS**: HTTPS + 사용자 직접 클릭 이벤트 내부에서만 동작 (구현 완료)
- **카메라**: `capture="environment"` 속성으로 즉시 카메라 실행
- **16px**: 입력창 font-size 16px 이상으로 자동 줌 방지
- **뷰포트**: `viewport-fit=cover` + env(safe-area-inset-*) 적용
- **키보드**: 포커스 시 scrollIntoView로 input 가시성 보장
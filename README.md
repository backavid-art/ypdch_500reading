# 양평동교회 성경 500독 명예의 전당 (Supabase/Postgres 저장 버전)

GitHub + Render Free에서 사용 가능하도록, 데이터 저장을 파일이 아닌 외부 Postgres(Supabase)로 변경한 버전입니다.

## 1) Supabase 준비
1. Supabase에서 새 프로젝트 생성
2. `Project Settings -> Database -> Connection string (URI)` 복사

이 앱은 시작 시 자동으로 테이블을 생성합니다.
- `members`
- `read_logs`

## 2) 로컬 실행
```bash
cd bible-hall-server
cp .env.example .env
# .env에서 DATABASE_URL, ADMIN_PASSWORD 수정
npm install
npm start
```
브라우저: `http://localhost:3000`

## 3) 필수 환경변수
- `ADMIN_PASSWORD` : 관리자 비밀번호
- `DATABASE_URL` : Supabase/Postgres 연결 문자열

## 4) GitHub 업로드
```bash
git init
git add .
git commit -m "Supabase deployable version"
git branch -M main
git remote add origin <YOUR_GITHUB_REPO_URL>
git push -u origin main
```

## 5) Render 배포 (Free 가능)
`render.yaml` 포함됨.

1. Render `New +` -> `Blueprint`
2. GitHub 저장소 연결
3. 환경변수 입력
- `ADMIN_PASSWORD`
- `DATABASE_URL` (Supabase URI)
4. Deploy

## 6) API
- `GET /api/health` : 상태 확인
- `GET /api/state` : 전체 현황 조회
- `POST /api/login` : 관리자 로그인
- `POST /api/logout` : 관리자 로그아웃
- `POST /api/reads` : 1독 추가
- `POST /api/reset` : 전체 초기화
- `POST /api/backups/manual` : 수동 백업 생성(관리자)
- `POST /api/members/update` : 이름/교구 수정(관리자)
- `POST /api/members/delete` : 인물 삭제(관리자)

## 7) 백업
- 자동백업: 서버가 하루 1회(Asia/Seoul 기준) DB 스냅샷을 `backup_snapshots` 테이블에 저장
- 수동백업: 관리자 화면의 `백업 실행` 버튼

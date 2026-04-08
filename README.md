# 양평동교회 성경 500독 명예의 전당 (서버 저장 버전)

GitHub에 올린 뒤 바로 배포할 수 있도록 구성된 Node.js 앱입니다.

## 로컬 실행
```bash
cd bible-hall-server
cp .env.example .env
# .env에서 ADMIN_PASSWORD를 원하는 값으로 변경
npm install
npm start
```
브라우저: `http://localhost:3000`

## 환경변수
- `PORT` : 서버 포트 (기본 3000)
- `ADMIN_PASSWORD` : 관리자 비밀번호 (필수)
- `DATA_DIR` : 데이터 저장 경로 (기본 `./data`)

## 데이터 저장
- 파일: `DATA_DIR/store.json`
- 브라우저 LocalStorage를 사용하지 않고 서버 파일로 저장

## GitHub 업로드
```bash
git init
git add .
git commit -m "Initial deployable version"
git branch -M main
git remote add origin <YOUR_GITHUB_REPO_URL>
git push -u origin main
```

## Render로 배포 (GitHub 연결)
이 프로젝트에는 `render.yaml`이 포함되어 있습니다.

1. Render에서 `New +` -> `Blueprint` 선택
2. GitHub 저장소 연결
3. 자동으로 `render.yaml` 인식 후 서비스 생성
4. `ADMIN_PASSWORD` 값 입력
5. 배포 완료 후 도메인 접속

`render.yaml` 설정 포함 사항:
- Node 20
- `/api/health` 헬스체크
- Persistent Disk (`/var/data`) 마운트
- `DATA_DIR=/var/data` (서버 저장 유지)

## 수동 배포(옵션)
### PM2
```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
```

### Docker
```bash
docker build -t bible-hall .
docker run -d --name bible-hall \
  -p 3000:3000 \
  -e ADMIN_PASSWORD='강한비밀번호' \
  -v $(pwd)/data:/app/data \
  bible-hall
```

## API
- `GET /api/health` : 상태 확인
- `GET /api/state` : 전체 현황 조회
- `POST /api/login` : 관리자 로그인
- `POST /api/logout` : 관리자 로그아웃
- `POST /api/reads` : 1독 추가
- `POST /api/reset` : 전체 초기화

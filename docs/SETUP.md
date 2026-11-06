# 새 컴퓨터 세팅 (SETUP)
> 다른 컴퓨터에서 이 프로젝트를 이어받는 절차. 위에서부터 순서대로. 상한 6KB.
> 최종 확인: 2026-11-06

## 1. 저장소 받기
```
git clone https://github.com/gjssk159-sudo/style-finder.git
cd style-finder
```

## 2. 깃에 없는 것 — 직접 옮기기
> 깃·메신저·메일로 보내지 않는다. USB, 에어드롭, 비밀번호 관리자 같은 안전한 경로로만.

| 무엇 | 원래 위치 | 옮길 위치 | 없으면 |
|---|---|---|---|
| 환경변수 파일(`.env.example` 참고, 변수 이름: `SUPABASE_URL`·`SUPABASE_ANON_KEY`·`SUPABASE_SERVICE_KEY`) | `.env` | 같은 경로 | 로컬에서 Supabase 적재·브랜드 동기화가 안 됨(화면 띄우기는 됨) |
| 로컬 수집 결과·로그(선택) | `data/` | 같은 경로 | 없어도 됨. 수집하면 다시 생김 |

## 3. 도구 설치
```
Windows: winget install OpenJS.NodeJS Git.Git GitHub.cli
Mac:     brew install node git gh
```
Node는 24 이상. 그다음 프로젝트 폴더에서:
```
npm ci
npx playwright install chromium
```

## 4. 로그인 (한 번씩)
```
gh auth login
```
Supabase·Vercel은 웹 대시보드에서 로그인해 확인한다(CLI 없이도 운영 가능).

## 5. 확인
```
npm run check
node web-server.js
```
두 번째 명령 뒤 브라우저에서 http://localhost:5173 을 열어 화면이 뜨는지 본다.

# 용현3동 행복마을 현장기록

카카오 지도 위에서 팀원 6~7명이 현장 사진과 메모를 공동 기록하는 반응형 웹앱입니다. **현위치 기록** 버튼을 누르면 GPS 좌표를 가져와 바로 기록할 수 있습니다.

## 처음 한 번만 설정

1. Supabase Dashboard의 **SQL Editor**에서 `supabase-schema.sql` 전체를 실행합니다.
2. Supabase **Authentication → Providers → Email**에서 이메일 로그인을 활성화합니다.
3. 관리자는 `minkijon65@gmail.com`으로 먼저 계정을 만들고 이메일 인증 후 로그인합니다.
4. 관리자 화면의 **팀 관리**에서 나머지 팀원 이메일을 추가합니다.
5. Vercel에 이 폴더를 배포한 뒤 발급된 `https://....vercel.app` 주소를 카카오 개발자 콘솔의 **JavaScript SDK 도메인**에 추가합니다.
6. 로컬 시험 시 JavaScript SDK 도메인에 `http://localhost:5173`도 추가합니다.

## 로컬 실행

이 폴더에서 정적 파일 서버를 실행하세요. 예:

```bash
npx serve . -l 5173
```

## 운영 설정

- 앱 이름: 용현3동 행복마을 현장기록
- 분류: 보행, 주차, 안전, 환경, 편의시설, 빈집·유휴공간, 기타
- 사진: 기록당 최대 3장, 업로드 전 긴 변 1600px 및 약 500KB 이하로 자동 압축
- 권한: 팀원 전체 기록 열람, 작성자 본인 기록 수정·삭제, 관리자는 전체 관리
- 사진 버킷: 비공개, 로그인한 승인 팀원만 임시 URL로 열람

## 공개 키

카카오 JavaScript 키와 Supabase Publishable Key는 브라우저에서 사용하는 공개용 키입니다. 데이터 보호는 카카오의 도메인 제한과 Supabase RLS 정책이 담당합니다. Supabase `service_role` 키나 데이터베이스 비밀번호는 웹 코드에 넣지 마세요.

# claude-commin-kit

Claude Code 프로젝트 워크플로우 시스템 — 단계별 작업 관리, git 자동화, 진행 상태 추적

---

## 시작하기

### npx로 바로 실행 (설치 불필요)

```bash
npx github:astudyinglady-max/claude-commin-kit
```

### 프로젝트에 설치

```bash
npm install github:astudyinglady-max/claude-commin-kit
npx claude-commin-kit
```

### git submodule로 추가 (버전 고정)

```bash
git submodule add https://github.com/astudyinglady-max/claude-commin-kit.git .kit
node .kit/kit/cli.mjs
```

---

## 사용법

```bash
node kit/cli.mjs init                  # 초기화
node kit/cli.mjs status                # 전체 상태 요약
node kit/cli.mjs next                  # 다음 할 일
node kit/cli.mjs complete <step-id>    # step 완료
node kit/cli.mjs list                  # 전체 목록
node kit/cli.mjs sync                  # 상태 파일 재생성
node kit/cli.mjs update                # 업데이트 안내
node kit/cli.mjs help                  # 전체 명령어 목록
```

---

## 워크플로우 단계

| Phase | 이름 | 주요 산출물 |
|-------|------|------------|
| 0 | Git & 스프린트 초기화 | .gitignore, PR 템플릿, 브랜치 전략 |
| 1 | 기획 | README, 요구사항, 유저스토리, 기술스택 |
| 2 | 디자인 | 디자인 시스템, 컴포넌트 목록, 페이지 목록 |
| 3 | 프론트엔드 | 컴포넌트, 페이지, API 연동, 단위 테스트 |
| 4 | 백엔드 | API, DB, 인증, CI/CD |
| 5 | 스프린트 마무리 | E2E 테스트, 회고, 다음 계획 |

---

## 업데이트

```bash
# npx 사용 시 — 자동으로 최신 버전 사용됨
npx github:astudyinglady-max/claude-commin-kit

# npm 설치 시
npm install github:astudyinglady-max/claude-commin-kit

# git submodule 사용 시
git submodule update --remote .kit

# 업데이트 후
node kit/cli.mjs sync
```

> state.json은 프로젝트 루트(`.workflow/`)에 저장되므로 업데이트해도 진행 상태가 보존됩니다.

---

## 라이선스

MIT

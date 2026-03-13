# claude-code-kit

Claude Code 프로젝트 워크플로우 시스템 — 기획부터 배포까지 단계별 작업 관리, git 자동화, 진행 상태 추적

**→ [기능 상세 소개 보기](docs/features.md)**

---

## 시작하기

### npx로 바로 실행 (설치 불필요, 권장)

```bash
npx claude-code-kit init
```

### 프로젝트에 설치

```bash
npm install claude-code-kit
npx claude-code-kit init
```

### GitHub에서 직접 설치

```bash
npx github:astudyinglady-max/claude-code-kit init
```

### git submodule로 추가 (버전 고정)

```bash
git submodule add https://github.com/astudyinglady-max/claude-code-kit.git .kit
node .kit/kit/cli.mjs init
```

---

## init — 인터랙티브 초기화

`init` 실행 시 프로젝트 정보와 기술 스택을 물어봅니다.

```
🚀 claude-code-kit 초기화

프로젝트 이름: My App
프로젝트 설명 (선택):
스프린트 번호 (기본값: 1): 1

기술 스택을 선택하세요:
  [1] Next.js + Express    Next.js 15 (App Router) + Express + Prisma + PostgreSQL
  [2] Next.js 풀스택       Next.js 15 (App Router + API Routes) — Vercel 친화적
  [3] React + FastAPI      React (Vite) + Python FastAPI + SQLAlchemy
  [4] 커스텀               기본 템플릿 (프롬프트 직접 설정)
```

초기화 후 프로젝트 `CLAUDE.md`에 현재 다음 할 일이 자동으로 주입됩니다. Claude Code가 파일을 읽는 순간 무엇을 해야 하는지 바로 알 수 있습니다.

---

## 사용법

```bash
npx claude-code-kit init                  # 초기화 (인터랙티브)
npx claude-code-kit status                # 전체 상태 요약
npx claude-code-kit next                  # 다음 할 일 + 프롬프트
npx claude-code-kit complete <step-id>    # step 완료 → CLAUDE.md 자동 업데이트
npx claude-code-kit list                  # 전체 목록
npx claude-code-kit sync                  # 상태 파일 재생성
npx claude-code-kit help                  # 전체 명령어 목록
```

---

## CLAUDE.md 자동 주입

`complete`, `init`, `sync` 실행 시마다 프로젝트 `CLAUDE.md`의 아래 섹션이 자동으로 업데이트됩니다.

```markdown
<!-- claude-code-kit:start -->
## 다음 할 일 (claude-code-kit)

**`p1s1`** 요구사항 & 차별화 정의 ★QA
Phase 1 — 기획 (1/3) | 전체 6%

### 프롬프트 [1/3]
요구사항.md를 작성해줘...

---
*완료 후: `node kit/cli.mjs complete p1s1`*
<!-- claude-code-kit:end -->
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
# npx 사용 시 — 항상 최신 버전 사용됨
npx claude-code-kit@latest <command>

# npm 설치 시
npm install claude-code-kit@latest

# git submodule 사용 시
git submodule update --remote .kit
node .kit/kit/cli.mjs sync
```

> `.workflow/state.json`은 프로젝트 루트에 저장되므로 업데이트해도 진행 상태가 보존됩니다.

---

## 라이선스

MIT

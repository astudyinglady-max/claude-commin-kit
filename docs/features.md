# claude-code-kit 기능 소개

> Claude Code로 개발할 때 기획부터 배포까지 단계를 놓치지 않게 도와주는 워크플로우 가이드 CLI

---

## 이런 문제를 해결합니다

Claude Code로 개발하다 보면 이런 경험이 있지 않나요?

- "다음에 뭘 해야 하지?" 매번 스스로 판단해야 함
- 요구사항 → 디자인 → 개발 → 테스트 → 배포 순서가 뒤죽박죽
- QC(품질 검토)를 빠뜨리고 나중에 문제 발견
- 어디까지 했는지 진행 상태를 따로 관리해야 함

**claude-code-kit**은 이 흐름을 처음부터 끝까지 안내해줍니다.

---

## 핵심 기능

### 1. 인터랙티브 초기화 (`init`)

```bash
npx claude-code-kit init
```

프로젝트를 처음 시작할 때 몇 가지 질문에 답하면 세팅이 완료됩니다.

```
🚀 claude-code-kit 초기화

프로젝트 이름: My Shopping App
프로젝트 설명: 중고거래 플랫폼
스프린트 번호 (기본값: 1): 1

기술 스택을 선택하세요:
  [1] Next.js + Express    Next.js 15 + Express + Prisma + PostgreSQL
  [2] Next.js 풀스택       Next.js 15 (API Routes) — Vercel 친화적
  [3] React + FastAPI      React (Vite) + Python FastAPI + SQLAlchemy
  [4] 커스텀               기본 템플릿 (직접 설정)
```

선택한 기술 스택에 맞는 Claude Code 프롬프트, 파일 목록, QC 체크리스트가 자동으로 구성됩니다.

---

### 2. 단계별 워크플로우 (6 Phase)

모든 프로젝트는 아래 6단계를 순서대로 진행합니다.

| Phase | 이름 | 하는 일 |
|-------|------|---------|
| 0 | Git & 스프린트 초기화 | `.gitignore`, PR 템플릿, 브랜치 전략 |
| 1 | 기획 | README, 요구사항, 유저스토리, 기술스택 문서 |
| 2 | 디자인 | 디자인 시스템, 컴포넌트 목록, 페이지 & 사용자 흐름 |
| 3 | 프론트엔드 | 컴포넌트 구현, 페이지, API 연동, 단위 테스트 |
| 4 | 백엔드 | API, DB, 인증, CI/CD 자동화 |
| 5 | 스프린트 마무리 | E2E 테스트, 회고, 다음 스프린트 계획 |

각 단계는 구체적인 **Step**으로 나뉘고, Step마다 Claude Code에 입력할 **프롬프트 예시**가 제공됩니다.

---

### 3. 다음 할 일 안내 (`next`)

```bash
npx claude-code-kit next
```

```
다음 단계:

  p1s1  요구사항 & 차별화 정의 ★QA
  Phase 1: 기획

  생성할 파일:
    • docs/요구사항.md
    • docs/유저스토리.md
    • docs/차별화.md

  Claude Code 프롬프트 예시:
  [1] 요구사항.md를 작성해줘. Must Have / Should Have / Nice to Have...
  [2] 유저스토리.md를 작성해줘...

  완료 처리: npx claude-code-kit complete p1s1
```

프롬프트를 복사해서 Claude Code에 붙여넣으면 됩니다.

---

### 4. CLAUDE.md 자동 주입

`init`, `complete`, `sync` 실행 시마다 프로젝트의 `CLAUDE.md`에 현재 다음 할 일이 자동으로 삽입됩니다.

```markdown
<!-- claude-code-kit:start -->
## 다음 할 일 (claude-code-kit)

**`p1s1`** 요구사항 & 차별화 정의 ★QA
Phase 1 — 기획 (1/3) | 전체 6%

**생성할 파일:** `docs/요구사항.md`, `docs/유저스토리.md`

### 프롬프트 [1/2]
요구사항.md를 작성해줘...

---
*완료 후: `npx claude-code-kit complete p1s1`*
<!-- claude-code-kit:end -->
```

Claude Code가 프로젝트를 열면 `CLAUDE.md`를 자동으로 읽기 때문에, **별도로 `next` 명령을 실행하지 않아도** 무엇을 해야 하는지 바로 알 수 있습니다.

---

### 5. 진행 상태 추적 (`status`, `list`)

```bash
npx claude-code-kit status
```

```
⚡ My Shopping App
   Sprint 1  |  Updated: 2026. 3. 14.

  ████████░░░░░░░░░░░░ 38% (8/21)

  Phase 0  Git & 스프린트 초기화  ██████████  3/3  ✓ 완료
  Phase 1  기획                  ██████░░░░  2/3  진행중
  Phase 2  디자인                ░░░░░░░░░░  0/3  대기
  Phase 3  프론트엔드             ░░░░░░░░░░  0/5  대기
  Phase 4  백엔드                ░░░░░░░░░░  0/5  대기
  Phase 5  스프린트 마무리        ░░░░░░░░░░  0/2  대기
```

---

### 6. QC 체크리스트 (`qc`)

★QA가 표시된 Step과 각 Phase 완료 시 QC 검토를 권장합니다.

```bash
npx claude-code-kit qc 1
```

```
QC: 기획

체크리스트:
  [1] 요구사항에 누락된 핵심 기능은 없는가?
  [2] 유저스토리가 실제 사용자 관점으로 작성되었는가?
  [3] 기술 스택 선택 근거가 문서에 명확히 서술되었는가?
  ...

QC 프롬프트 (Claude Code에 복사):
────────────────────────────────────────
요구사항.md, 유저스토리.md, 기술스택.md를 전체적으로 검토해줘...
────────────────────────────────────────
```

---

### 7. Git 자동화 (`git-start`, `git-finish`)

```bash
npx claude-code-kit git-start 1   # feat/기획-스프린트1 브랜치 생성
npx claude-code-kit git-finish 1  # add + commit + push (확인 후 실행)
```

각 Phase에 맞는 브랜치명과 커밋 메시지가 미리 정의되어 있어서 컨벤션을 신경 쓰지 않아도 됩니다.

---

### 8. 웹 대시보드

`docs/index.html`을 브라우저에서 열면 시각적인 대시보드를 확인할 수 있습니다.

- **프로젝트 목록** — 여러 프로젝트의 진행률 카드
- **작업 목록** — Phase별 Step, 프롬프트, QC, LOG, GIT 섹션 시각화
- **작업 보드** — 담당자 지정, 완료일, 메모, 코멘트 기능

CLI로 `complete` 처리한 항목은 대시보드에 자동으로 체크 표시됩니다.

---

### 9. 기존 프로젝트 연동 (`import-from-claude`)

이미 진행 중인 프로젝트에 claude-code-kit을 도입할 때, 파일 존재 여부를 분석해서 완료된 Step을 자동으로 감지합니다.

```bash
npx claude-code-kit import-from-claude
```

```
✓ 완료된 것으로 감지됨 (5개):
  p0s0  Git 저장소 초기화 ← 새로 감지
  p1s0  프로젝트 초기 설정 ← 새로 감지
  ...
```

---

## 전체 흐름 요약

```
npx claude-code-kit init
        ↓
   프로젝트 이름 · 기술 스택 선택
        ↓
   CLAUDE.md에 첫 번째 할 일 주입
        ↓
Claude Code 열기 → CLAUDE.md 읽음 → 프롬프트 실행
        ↓
npx claude-code-kit complete p0s0
        ↓
   CLAUDE.md 다음 단계로 자동 업데이트
        ↓
         ... 반복 ...
        ↓
npx claude-code-kit git-finish 1
        ↓
   커밋 + 푸시 + PR 생성
```

---

## CLI 전체 명령어

| 명령어 | 설명 |
|--------|------|
| `init` | 인터랙티브 초기화 |
| `next` | 다음 할 일 + 프롬프트 출력 |
| `complete <step-id>` | Step 완료 처리 |
| `status` | 전체 진행률 요약 |
| `list` | 전체 Step 목록 |
| `qc <phase-id>` | QC 체크리스트 출력 |
| `git-start <phase-id>` | feature 브랜치 생성 |
| `git-finish <phase-id>` | commit + push |
| `log <phase-id>` | sprint-log 기록 프롬프트 출력 |
| `import-from-claude` | 기존 프로젝트 상태 자동 감지 |
| `sync` | 상태 파일 재생성 |
| `update` | 업데이트 안내 |
| `reset` | 전체 초기화 |

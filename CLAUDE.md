# Claude Code 워크플로우 지침

이 프로젝트는 **claude-commin-kit** 워크플로우 시스템을 사용합니다.
작업 전 반드시 이 문서를 읽고 단계별 순서를 준수하세요.

---

## 워크플로우 시스템 개요

### 핵심 파일
| 파일 | 역할 |
|------|------|
| `.workflow/config.json` | 워크플로우 정의 (Phase/Step/프롬프트/QC) |
| `.workflow/state.json` | 진행 상태 (Single Source of Truth) |
| `.workflow/status.md` | 사람이 읽는 진행 상태 (자동 생성) |
| `.workflow/state.js` | HTML 대시보드용 상태 브릿지 (자동 생성) |

### 상태 흐름
```
CLI command → state.json 업데이트
                  ↓
         status.md 재생성 (사람이 읽는 뷰)
         state.js  재생성 (HTML이 읽는 브릿지)
                  ↓
         docs/workflow.html, docs/index.html 열면
         state.js 로드 → 체크 상태 자동 반영
```

---

## 작업 규칙

### 1. 작업 시작 전
```bash
node kit/cli.mjs status    # 현재 진행 상태 확인
node kit/cli.mjs next      # 다음 할 일 확인
```

### 2. 각 Step 작업 순서
1. `node kit/cli.mjs next` — 다음 step 확인
2. `node kit/cli.mjs template <step-id>` — 템플릿 파일 생성 (있는 경우)
3. 프롬프트를 Claude Code에 입력해서 파일 작성
4. ★QA 표시된 step은 반드시 QC 수행
5. `node kit/cli.mjs complete <step-id>` — 완료 처리

### 3. Phase 완료 시
```bash
node kit/cli.mjs qc <phase-id>          # QC 체크리스트 확인
node kit/cli.mjs log <phase-id>         # sprint-log.md 기록
node kit/cli.mjs git-start <phase-id>   # feature 브랜치 생성
# ... 코드 작업 ...
node kit/cli.mjs git-finish <phase-id>  # commit + push
```

---

## CLI 사용법 요약

```bash
node kit/cli.mjs init                 # 초기화
node kit/cli.mjs status               # 전체 상태 요약
node kit/cli.mjs list                 # 전체 목록
node kit/cli.mjs next                 # 다음 할 일
node kit/cli.mjs complete p1s0        # step 완료
node kit/cli.mjs uncomplete p1s0      # 완료 취소
node kit/cli.mjs template p1s1        # 템플릿 파일 생성
node kit/cli.mjs qc 1                 # Phase 1 QC
node kit/cli.mjs git-start 1          # feat/기획-스프린트1 브랜치 생성
node kit/cli.mjs git-finish 1         # commit + push
node kit/cli.mjs log 1                # 기록 프롬프트 출력
node kit/cli.mjs sync                 # state.js, status.md 재생성
node kit/cli.mjs reset                # 전체 초기화
```

---

## 금지 사항

- `.workflow/state.json` 직접 수정 — 반드시 CLI 명령어 사용
- `.workflow/status.md` 직접 수정 — 자동 생성 파일
- `.workflow/state.js` 직접 수정 — 자동 생성 파일
- 단계 건너뛰기 — 순서대로 진행
- ★QA step을 QC 없이 complete 처리

---

## 워크플로우 단계

| Phase | 이름 | 주요 산출물 |
|-------|------|------------|
| 0 | Git & 스프린트 초기화 | .gitignore, PR 템플릿, 브랜치 전략 |
| 1 | 기획 | README, 요구사항, 유저스토리, 기술스택, 차별화 |
| 2 | 디자인 | 디자인 시스템, 컴포넌트 목록, 페이지 목록, 사용자 흐름 |
| 3 | 프론트엔드 | 컴포넌트, 페이지, API 연동, 단위 테스트 |
| 4 | 백엔드 | API, DB, 인증, CI/CD |
| 5 | 스프린트 마무리 | E2E 테스트, 회고, 다음 계획 |

---

## 프로젝트 설정 변경

`config.json`의 `project` 섹션을 수정한 후 sync:
```bash
node kit/cli.mjs sync
```

프로젝트 이름, 스프린트 번호, 브랜치 전략을 커스터마이징할 수 있습니다.

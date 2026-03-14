# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

`claude-code-kit` is a CLI workflow manager for Claude Code projects. It guides users through structured development phases (planning → design → frontend → backend → sprint wrap-up), tracks progress in a state file, and automates git operations.

## Running the CLI

```bash
node kit/cli.mjs <command>    # primary way to run
npx github:astudyinglady-max/claude-code-kit <command>   # via npx
```

No build step required. The project is pure ESM (`"type": "module"`) with no dependencies — only Node.js built-ins.

## Architecture

**Everything lives in one file: `kit/cli.mjs`**

Key path constants at the top of `cli.mjs`:
- `KIT_ROOT` — directory containing `kit/cli.mjs` (kit-owned files: `config.json`, `templates/`)
- `ROOT` — `process.cwd()` (user project root; user-owned files: `state.json`, `status.md`, `state.js`)

This separation is critical for safe updates: kit files can be overwritten on update, user files must never be.

**Three install modes** detected at runtime:
- `standalone` — `KIT_ROOT === ROOT` (kit used as the project itself)
- `submodule` — kit lives at `project/.kit/`, state saves to `project/.workflow/`
- `npx/npm` — state saves to `cwd`-based project

**State flow:**
```
CLI command → saveState() → state.json
                          → syncFiles() → status.md (human-readable)
                                       → state.js (window.__WORKFLOW_STATE__ for HTML dashboard)
```

**Config vs State:**
- `.workflow/config.json` — phase/step definitions, prompts, QC checklists, git commands (kit-owned)
- `ROOT/.workflow/state.json` — `{ project, completedSteps[], updatedAt }` (user-owned, single source of truth)

**Template system:** `cmdTemplate()` reads `.workflow/templates/*.tmpl` files and replaces `{{project.name}}`, `{{sprint}}`, `{{date}}` placeholders, then writes to the user project.

**HTML dashboard:** `docs/workflow.html` and `docs/index.html` load `state.js` at runtime — `state.js` must always reflect current state.

## Adding or modifying commands

All commands are functions named `cmd*()` registered in the `switch` block at the bottom of `cli.mjs`. The pattern is:

1. Add `async function cmdFoo(arg)` with the implementation
2. Add `case 'foo': cmdFoo(args[0]); break;` to the switch
3. Add `['foo', 'description']` entry to the `cmds` array in `cmdHelp()`

## Modifying workflow phases/steps

Edit `.workflow/config.json`. Each step has:
- `id` — e.g. `p1s0` (phase 1, step 0)
- `qa: true` — marks step as requiring QC before completion
- `files[]` — used by `import-from-claude` to auto-detect completion
- `templates[]` — `{ tmpl, out }` pairs for `cmdTemplate()`
- `prompts[]` — shown by `cmdNext()` as Claude Code prompt suggestions

Phase-level keys: `qc` (checklist + prompt), `log` (sprint log prompt), `git` (branch/commands).

## Important constraints

- Never call `saveState()` without going through the exported function — it must always trigger `syncFiles()` to keep `status.md` and `state.js` in sync.
- `status.md` and `state.js` are auto-generated — the comment `DO NOT EDIT` at the top of each is intentional.
- Files with `[placeholder]` in their paths (e.g. `app/[feature]/page.tsx`) are intentionally skipped in `import-from-claude` file detection.
- The legacy state path migration (`.workflow/state.json` inside kit → `ROOT/.workflow/state.json`) must remain in `loadState()` for backwards compatibility.

<!-- claude-code-kit:start -->
## 다음 할 일 (claude-code-kit)

**`p0s0`** Git 저장소 초기화
Phase 0 — Git & 스프린트 초기화 (0/3) | 전체 0%

**생성할 파일:** `.gitignore`, `.github/pull_request_template.md`, `.github/ISSUE_TEMPLATE/feature.md`

### 프롬프트 [1/3]
Next.js + Node.js 프로젝트에 맞는 .gitignore 파일을 만들어줘. node_modules, .env, .next, dist 등 포함.

### 프롬프트 [2/3]
GitHub PR 템플릿을 만들어줘. 작업 내용 요약, 변경 유형 체크박스(feat/fix/docs/refactor), 테스트 여부, 스크린샷 섹션 포함.

### 프롬프트 [3/3]
GitHub Issue 템플릿 두 가지를 만들어줘. 하나는 기능 요청(feature request), 하나는 버그 리포트(bug report) 형식으로.

---
*완료 후: `node kit/cli.mjs complete p0s0`*
<!-- claude-code-kit:end -->

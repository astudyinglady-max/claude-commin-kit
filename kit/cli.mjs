#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import readline from 'node:readline';

// ─── ANSI Colors ────────────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m',
  bold:  '\x1b[1m',
  dim:   '\x1b[2m',
  green: '\x1b[32m',
  cyan:  '\x1b[36m',
  yellow:'\x1b[33m',
  red:   '\x1b[31m',
  blue:  '\x1b[34m',
  magenta:'\x1b[35m',
  white: '\x1b[37m',
  gray:  '\x1b[90m',
};
const c = (color, text) => `${C[color]}${text}${C.reset}`;
const bold = (text) => `${C.bold}${text}${C.reset}`;

// ─── Paths ───────────────────────────────────────────────────────────────────
// KIT_ROOT: cli.mjs 위치 기준으로 kit 루트를 찾음 (업데이트에 영향받는 파일들)
// ROOT:     process.cwd() = 사용자 프로젝트 루트 (업데이트에 영향받지 않는 파일들)
//
// 파일 분리 전략 (업데이트 안전성):
//   KIT_ROOT/.workflow/  → config.json, templates/  (kit이 제공, 업데이트로 갱신됨)
//   ROOT/.workflow/      → state.json, status.md, state.js  (사용자 데이터, 절대 덮어쓰기 안됨)
//
// 모드별 동작:
//   standalone  cwd === kit root  → ROOT === KIT_ROOT, 동일 폴더
//   submodule   project/.kit/     → state가 project/.workflow/에 저장 (submodule 밖)
//   npx/global  어디서나 실행      → state가 cwd 기준 프로젝트에 저장
const __kitfile = fileURLToPath(import.meta.url);       // .../kit/cli.mjs
const KIT_ROOT  = path.resolve(path.dirname(__kitfile), '..'); // .../kit → ..

const ROOT            = process.cwd();                              // 사용자 프로젝트 루트
const KIT_WORKFLOW    = path.join(KIT_ROOT, '.workflow');           // kit 소유 파일 (config, templates)
const USER_WORKFLOW   = path.join(ROOT, '.workflow');               // 사용자 소유 파일 (state)
const CONFIG_PATH     = path.join(KIT_WORKFLOW, 'config.json');
const STATE_PATH      = path.join(USER_WORKFLOW, 'state.json');
const STATUS_PATH     = path.join(USER_WORKFLOW, 'status.md');
const STATE_JS_PATH   = path.join(USER_WORKFLOW, 'state.js');
const TEMPLATES_DIR   = path.join(KIT_WORKFLOW, 'templates');
// 하위 호환: standalone 모드(ROOT===KIT_ROOT)에서는 동일 경로이므로 마이그레이션 불필요
const LEGACY_STATE    = path.join(KIT_WORKFLOW, 'state.json');
// 사용자 프로젝트가 덮어쓴 config (업데이트 시에도 보존됨)
const USER_CONFIG_PATH = path.join(USER_WORKFLOW, 'config.json');
// 사용자 프로젝트의 CLAUDE.md (다음 할 일 자동 주입 대상)
const CLAUDE_MD_PATH   = path.join(ROOT, 'CLAUDE.md');

// ─── Core Helpers ────────────────────────────────────────────────────────────
function loadConfig() {
  // USER_CONFIG_PATH 우선 (init 시 기술 스택에 맞게 생성된 config)
  const configPath = fs.existsSync(USER_CONFIG_PATH) ? USER_CONFIG_PATH : CONFIG_PATH;
  if (!fs.existsSync(configPath)) {
    console.error(c('red', '❌ .workflow/config.json not found.'));
    console.error(c('yellow', '   Run: node kit/cli.mjs init'));
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    console.error(c('red', `❌ Failed to parse config.json: ${e.message}`));
    process.exit(1);
  }
}

function loadState() {
  // 새 위치(ROOT/.workflow/state.json)에 없으면 구버전 위치(KIT_ROOT/.workflow/state.json) 확인 후 마이그레이션
  if (!fs.existsSync(STATE_PATH)) {
    if (LEGACY_STATE !== STATE_PATH && fs.existsSync(LEGACY_STATE)) {
      // 구버전 state 자동 마이그레이션
      try {
        const legacy = JSON.parse(fs.readFileSync(LEGACY_STATE, 'utf8'));
        if (!fs.existsSync(USER_WORKFLOW)) fs.mkdirSync(USER_WORKFLOW, { recursive: true });
        fs.writeFileSync(STATE_PATH, JSON.stringify(legacy, null, 2));
        fs.renameSync(LEGACY_STATE, LEGACY_STATE + '.migrated');
        console.log(c('cyan', `ℹ  state.json 마이그레이션 완료: .workflow/ → 프로젝트 루트`));
      } catch {
        // 마이그레이션 실패 시 기본값 반환
      }
    }
    if (!fs.existsSync(STATE_PATH)) {
      return { project: { name: '', description: '', sprint: 1 }, completedSteps: [], updatedAt: new Date().toISOString() };
    }
  }
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { project: { name: '', description: '', sprint: 1 }, completedSteps: [], updatedAt: new Date().toISOString() };
  }
}

function saveState(state) {
  state.updatedAt = new Date().toISOString();
  if (!fs.existsSync(USER_WORKFLOW)) fs.mkdirSync(USER_WORKFLOW, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  const config = loadConfig();
  syncFiles(config, state);
  try { injectToClaude(config, state); } catch {}
}

function syncFiles(config, state) {
  fs.writeFileSync(STATUS_PATH, generateStatusMd(config, state));
  fs.writeFileSync(STATE_JS_PATH, generateStateJs(config, state));
}

function generateStatusMd(config, state) {
  const all = getAllSteps(config);
  const total = all.length;
  const done = state.completedSteps.length;
  const pct = total ? Math.round(done / total * 100) : 0;
  const projectName = state.project?.name || config.project?.name || '(미설정)';
  const sprint = state.project?.sprint || config.project?.sprint || 1;
  const updated = new Date(state.updatedAt).toLocaleDateString('ko-KR');

  let md = `# 워크플로우 진행 상태\n\n`;
  md += `**프로젝트**: ${projectName}\n`;
  md += `**스프린트**: ${sprint}\n`;
  md += `**업데이트**: ${updated}\n`;
  md += `**진행률**: ${pct}% (${done} / ${total} 완료)\n\n`;
  md += `---\n\n`;

  config.phases.forEach(ph => {
    const pDone = ph.steps.filter(s => state.completedSteps.includes(s.id)).length;
    const pPct = ph.steps.length ? Math.round(pDone / ph.steps.length * 100) : 0;
    md += `## Phase ${ph.id}: ${ph.name}\n`;
    md += `> ${ph.sub}\n\n`;
    md += `진행: ${pDone}/${ph.steps.length} (${pPct}%)\n\n`;
    ph.steps.forEach(step => {
      const isDone = state.completedSteps.includes(step.id);
      const qa = step.qa ? ' ★QA' : '';
      md += `- [${isDone ? 'x' : ' '}] \`${step.id}\` ${step.title}${qa}\n`;
    });
    md += '\n';
  });

  md += `---\n*Auto-generated by kit/cli.mjs — DO NOT EDIT*\n`;
  return md;
}

function generateStateJs(config, state) {
  const all = getAllSteps(config);
  const wsState = {
    project: { ...(config.project || {}), ...(state.project || {}) },
    completedSteps: state.completedSteps || [],
    totalSteps: all.length,
    progress: (state.completedSteps || []).length,
    updatedAt: state.updatedAt,
  };
  return `// Auto-generated by kit/cli.mjs — DO NOT EDIT\nwindow.__WORKFLOW_STATE__ = ${JSON.stringify(wsState, null, 2)};\n`;
}

function getAllSteps(config) {
  const steps = [];
  config.phases.forEach(ph => {
    ph.steps.forEach((step, si) => {
      steps.push({ ...step, phaseId: ph.id, phaseName: ph.name, phaseColor: ph.color, stepIndex: si });
    });
  });
  return steps;
}

function getStepById(config, stepId) {
  for (const ph of config.phases) {
    for (const step of ph.steps) {
      if (step.id === stepId) return { ...step, phase: ph };
    }
  }
  return null;
}

function getPhaseById(config, phaseId) {
  const id = parseInt(phaseId, 10);
  return config.phases.find(ph => ph.id === id) || null;
}

function bar(pct, width = 20) {
  const filled = Math.round(pct / 100 * width);
  return c('green', '█'.repeat(filled)) + c('gray', '░'.repeat(width - filled));
}

function confirm(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${question} (y/N) `, ans => {
      rl.close();
      resolve(ans.trim().toLowerCase() === 'y');
    });
  });
}

function promptQuestion(question, defaultVal = '') {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const suffix = defaultVal ? c('gray', ` (기본값: ${defaultVal})`) : '';
    rl.question(`${question}${suffix}: `, ans => {
      rl.close();
      resolve(ans.trim() || defaultVal);
    });
  });
}

function promptSelect(question, options) {
  return new Promise(resolve => {
    console.log(bold(question));
    options.forEach((opt, i) => {
      console.log(`  ${c('cyan', `[${i + 1}]`)} ${bold(opt.label)}  ${c('gray', opt.desc || '')}`);
    });
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(c('gray', '\n선택 (숫자): '), ans => {
      rl.close();
      const idx = parseInt(ans.trim(), 10) - 1;
      resolve(idx >= 0 && idx < options.length ? idx : 0);
    });
  });
}

// ─── Config Generator ────────────────────────────────────────────────────────

function generateConfig(projectName, projectDesc, sprint, stackKey) {
  const base = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const project = {
    name: projectName,
    description: projectDesc,
    sprint,
    branchStrategy: base.project.branchStrategy,
  };

  // nextjs-express, custom: 기존 config 그대로 사용
  if (stackKey === 'nextjs-express' || stackKey === 'custom') {
    return { ...base, project };
  }

  let phase3, phase4;

  if (stackKey === 'nextjs-fullstack') {
    phase3 = {
      id: 3, name: '풀스택 구현', sub: 'Next.js API Routes + 컴포넌트 + DB 연동',
      color: '#0ea5e9', bg: '#f0f9ff', border: '#bae6fd',
      steps: [
        {
          id: 'p3s0', title: '프로젝트 초기화', qa: true,
          files: ['package.json', 'tsconfig.json', 'tailwind.config.ts'],
          templates: [],
          prompts: [
            'Next.js 15 + TypeScript + Tailwind CSS + Prisma 프로젝트를 세팅해줘. App Router 방식, 폴더구조.md 기반 디렉토리 생성.',
            'Jest + React Testing Library를 설치하고 설정해줘. Next.js 환경, 절대 경로 alias(@/), 커버리지 옵션 포함.',
          ],
        },
        {
          id: 'p3s1', title: 'DB 설계 & Prisma', qa: false,
          files: ['prisma/schema.prisma', 'lib/db.ts'],
          templates: [],
          prompts: [
            '요구사항.md 기반으로 Prisma schema를 설계해줘. 모델 관계, 인덱스, createdAt/updatedAt 자동 관리, 설계 이유를 주석으로.',
            'Prisma 클라이언트를 싱글턴 패턴으로 lib/db.ts에 작성해줘. 핫 리로드 연결 중복 방지.',
          ],
        },
        {
          id: 'p3s2', title: '공통 컴포넌트 + 단위 테스트', qa: true,
          files: ['components/ui/Button.tsx', 'components/ui/Input.tsx', 'components/ui/Card.tsx'],
          templates: [],
          prompts: [
            'Button, Input, Card, Modal 컴포넌트를 TypeScript로 만들어줘. CVA로 variant 관리, 접근성(aria) 포함.',
            'Jest + RTL로 Button 컴포넌트 단위 테스트를 작성해줘. variant, 클릭, disabled, loading 상태 테스트.',
          ],
        },
        {
          id: 'p3s3', title: 'API Routes & 인증', qa: true,
          files: ['app/api/auth/[...nextauth]/route.ts', 'middleware.ts'],
          templates: [],
          prompts: [
            'NextAuth.js로 인증을 구현해줘. 이메일/비밀번호 + Prisma 어댑터, JWT 세션, 보호 경로 미들웨어.',
            'Next.js API Routes로 핵심 기능 CRUD API를 구현해줘. zod 입력값 검증, 에러 응답 { success, data, error } 통일.',
          ],
        },
        {
          id: 'p3s4', title: '페이지 구현', qa: false,
          files: ['app/page.tsx', 'app/layout.tsx'],
          templates: [],
          prompts: [
            '페이지목록.md 기반으로 각 페이지를 Server Components로 구현해줘. loading.tsx, error.tsx, not-found.tsx 포함.',
            'Suspense 기반 스켈레톤 로딩, 빈 상태(empty state), 에러 상태 UI를 각 페이지에 추가해줘.',
          ],
        },
      ],
      qc: {
        title: '풀스택 QC',
        checks: [
          'TypeScript 타입 오류가 없는가? (tsc --noEmit)',
          'API Routes에 인증/권한 검사가 적용되었는가?',
          '단위 테스트가 주요 컴포넌트에 작성되었는가?',
          '로딩/에러/빈 상태가 모두 처리되었는가?',
        ],
        prompt: '코드 전체를 검토해줘. TypeScript 오류, 인증 누락 API, 테스트 누락, N+1 쿼리, 에러 처리 누락을 항목별로 찾아줘.',
      },
      log: {
        file: 'docs/sprint-log.md',
        items: ['구현된 컴포넌트/페이지/API 목록', '테스트 커버리지'],
        prompt: 'sprint-log.md에 풀스택 구현 단계 기록을 추가해줘. 구현 목록, 테스트 현황, 주요 결정 사항 포함.',
      },
      git: {
        branch: 'feat/풀스택-스프린트1',
        pr: 'develop',
        commands: [
          'git checkout -b feat/풀스택-스프린트1',
          'git add components/ app/ lib/ prisma/',
          'git commit -m "feat: 풀스택 구현 (컴포넌트, 페이지, API Routes, DB)"',
          'git push origin feat/풀스택-스프린트1',
        ],
      },
    };
    phase4 = {
      id: 4, name: '배포 & CI/CD', sub: 'GitHub Actions + Vercel 배포',
      color: '#10b981', bg: '#f0fdf4', border: '#bbf7d0',
      steps: [
        {
          id: 'p4s0', title: 'CI/CD & Vercel 배포', qa: true,
          files: ['.github/workflows/ci.yml'],
          templates: [],
          prompts: [
            'ci.yml을 만들어줘. PR마다 TypeScript 체크 → ESLint → Jest → 커버리지 80% 미만 차단 자동 실행.',
            'Vercel 배포 설정을 안내해줘. 환경변수, Prisma 마이그레이션 자동화, Preview 배포 설정 포함.',
          ],
        },
      ],
      qc: {
        title: '배포 QC',
        checks: [
          'CI 파이프라인이 PR마다 자동 실행되는가?',
          '환경변수가 Vercel에 올바르게 설정되었는가?',
          'Prisma 마이그레이션이 배포 시 자동 실행되는가?',
        ],
        prompt: 'CI/CD 설정을 검토해줘. 누락된 환경변수, 배포 실패 시나리오, 보안 이슈를 찾아줘.',
      },
      log: {
        file: 'docs/sprint-log.md',
        items: ['배포 설정 완료 여부', 'CI 파이프라인 현황'],
        prompt: 'sprint-log.md에 배포 단계 기록을 추가해줘.',
      },
      git: {
        branch: 'feat/배포-스프린트1',
        pr: 'develop',
        commands: [
          'git checkout -b feat/배포-스프린트1',
          'git add .github/',
          'git commit -m "ci: GitHub Actions + Vercel 배포 설정"',
          'git push origin feat/배포-스프린트1',
        ],
      },
    };
  } else if (stackKey === 'react-fastapi') {
    phase3 = {
      id: 3, name: '프론트엔드', sub: 'React (Vite) 컴포넌트 & 페이지 구현',
      color: '#0ea5e9', bg: '#f0f9ff', border: '#bae6fd',
      steps: [
        {
          id: 'p3s0', title: '프로젝트 초기화', qa: true,
          files: ['package.json', 'tsconfig.json', 'vite.config.ts'],
          templates: [],
          prompts: [
            'React + Vite + TypeScript + Tailwind CSS 프로젝트를 세팅해줘. 절대 경로 alias(@/), .env 환경변수 설정 포함.',
            'Vitest + React Testing Library를 설치하고 vite.config.ts에 test 설정을 추가해줘.',
          ],
        },
        {
          id: 'p3s1', title: '공통 컴포넌트 + 단위 테스트', qa: true,
          files: ['src/components/ui/Button.tsx', 'src/components/ui/Input.tsx'],
          templates: [],
          prompts: [
            'Button, Input, Card, Modal 컴포넌트를 TypeScript로 만들어줘. CVA로 variant 관리, 접근성 포함.',
            'Vitest + RTL로 Button 컴포넌트 단위 테스트를 작성해줘.',
          ],
        },
        {
          id: 'p3s2', title: 'API 연동 & 상태관리', qa: true,
          files: ['src/lib/api.ts', 'src/hooks'],
          templates: [],
          prompts: [
            'TanStack Query + axios로 API 클라이언트를 설정해줘. JWT 토큰 자동 첨부, 401 자동 갱신, 공통 에러 타입.',
            '핵심 기능 커스텀 훅을 TanStack Query로 만들어줘. 낙관적 업데이트(optimistic update) 포함.',
          ],
        },
        {
          id: 'p3s3', title: '페이지 구현', qa: false,
          files: ['src/pages', 'src/router.tsx'],
          templates: [],
          prompts: [
            'React Router v6로 라우팅을 설정해줘. Protected Route, 404 페이지, 레이아웃 중첩 포함.',
            '페이지목록.md 기반으로 각 페이지를 구현해줘. 로딩/에러/빈 상태 처리 포함.',
          ],
        },
      ],
      qc: {
        title: '프론트엔드 QC',
        checks: [
          'TypeScript 타입 오류가 없는가?',
          '단위 테스트가 주요 컴포넌트에 작성되었는가?',
          '로딩/에러/빈 상태가 모두 처리되었는가?',
          'API 오류가 사용자에게 적절히 표시되는가?',
        ],
        prompt: '프론트엔드 코드를 검토해줘. TypeScript 오류, 테스트 누락, 에러 처리 누락, 성능 문제를 찾아줘.',
      },
      log: {
        file: 'docs/sprint-log.md',
        items: ['구현된 컴포넌트/페이지 목록', '테스트 커버리지'],
        prompt: 'sprint-log.md에 프론트엔드 단계 기록을 추가해줘.',
      },
      git: {
        branch: 'feat/프론트-스프린트1',
        pr: 'develop',
        commands: [
          'git checkout -b feat/프론트-스프린트1',
          'git add src/',
          'git commit -m "feat: 프론트엔드 컴포넌트, 페이지 구현 및 단위 테스트 추가"',
          'git push origin feat/프론트-스프린트1',
        ],
      },
    };
    phase4 = {
      id: 4, name: '백엔드', sub: 'FastAPI + SQLAlchemy + 인증 구현',
      color: '#10b981', bg: '#f0fdf4', border: '#bbf7d0',
      steps: [
        {
          id: 'p4s0', title: 'FastAPI 초기화', qa: true,
          files: ['backend/main.py', 'backend/requirements.txt'],
          templates: [],
          prompts: [
            'FastAPI 프로젝트를 초기화해줘. CORS(허용 도메인), 공통 에러 핸들러, .env 환경변수 관리, uvicorn 실행 스크립트.',
            'pytest + httpx로 테스트 환경을 설정해줘. SQLite 테스트 DB, conftest.py, 픽스처 설정.',
          ],
        },
        {
          id: 'p4s1', title: 'DB 설계 & SQLAlchemy', qa: false,
          files: ['backend/models', 'backend/alembic.ini'],
          templates: [],
          prompts: [
            '요구사항.md 기반으로 SQLAlchemy 모델을 설계해줘. relationship, 인덱스, created_at/updated_at 포함.',
            'Alembic으로 DB 마이그레이션을 설정하고 초기 마이그레이션 파일을 생성해줘.',
          ],
        },
        {
          id: 'p4s2', title: '인증 구현 + 테스트', qa: true,
          files: ['backend/routes/auth.py', 'backend/core/security.py'],
          templates: [],
          prompts: [
            'JWT 인증을 구현해줘. 회원가입(bcrypt), 로그인(access+refresh token), 토큰 갱신, OAuth2PasswordBearer.',
            'pytest로 인증 API 테스트를 작성해줘. 회원가입/로그인 성공·실패, 토큰 갱신, 미들웨어 케이스.',
          ],
        },
        {
          id: 'p4s3', title: 'API 구현 + 테스트', qa: true,
          files: ['backend/routes', 'backend/services', 'backend/schemas'],
          templates: [],
          prompts: [
            'Pydantic 스키마 + Router → Service → Repository 구조로 CRUD API를 구현해줘.',
            'pytest + httpx로 CRUD API 테스트를 작성해줘. 성공/실패/권한 없음 케이스.',
          ],
        },
        {
          id: 'p4s4', title: 'Docker & CI/CD', qa: true,
          files: ['Dockerfile', 'docker-compose.yml', '.github/workflows/ci.yml'],
          templates: [],
          prompts: [
            'FastAPI와 React 각각의 Dockerfile을 멀티스테이지 빌드로 만들고 docker-compose.yml로 함께 실행해줘.',
            'ci.yml을 만들어줘. PR마다 mypy → pytest → React 빌드+테스트가 자동 실행되도록.',
          ],
        },
      ],
      qc: {
        title: '백엔드 QC',
        checks: [
          'API에 인증 미들웨어가 적용되었는가?',
          'Pydantic으로 입력값 검증이 되는가?',
          'pytest 테스트가 주요 API에 작성되었는가?',
          '민감정보가 하드코딩되지 않았는가?',
        ],
        prompt: '백엔드 코드를 검토해줘. 인증 누락, 검증 누락, SQL Injection, 하드코딩 민감정보, 테스트 누락을 찾아줘.',
      },
      log: {
        file: 'docs/sprint-log.md',
        items: ['구현된 API 목록', '테스트 커버리지', '보안 처리 내용'],
        prompt: 'sprint-log.md에 백엔드 단계 기록을 추가해줘.',
      },
      git: {
        branch: 'feat/백엔드-스프린트1',
        pr: 'develop',
        commands: [
          'git checkout -b feat/백엔드-스프린트1',
          'git add backend/ .github/',
          'git commit -m "feat: FastAPI 백엔드 구현, 단위 테스트, CI/CD 추가"',
          'git push origin feat/백엔드-스프린트1',
        ],
      },
    };
  }

  return {
    project,
    phases: base.phases.map(ph => {
      if (ph.id === 3) return phase3;
      if (ph.id === 4) return phase4;
      return ph;
    }),
  };
}

// ─── Commands ────────────────────────────────────────────────────────────────

async function cmdInit() {
  // 이미 초기화된 경우: sync만 실행
  if (fs.existsSync(STATE_PATH)) {
    console.log();
    console.log(c('yellow', 'ℹ  이미 초기화된 프로젝트입니다. 상태 파일을 동기화합니다.'));
    const config = loadConfig();
    const state = loadState();
    syncFiles(config, state);
    try { injectToClaude(config, state); } catch {}
    console.log(c('green', '✓ sync 완료 (status.md, state.js, CLAUDE.md 업데이트)'));
    console.log(c('gray', '  node kit/cli.mjs status  — 현재 상태 확인'));
    console.log();
    return;
  }

  console.log();
  console.log(bold('🚀 claude-code-kit 초기화'));
  console.log(c('gray', '  새 프로젝트를 설정합니다.\n'));

  // 1. 프로젝트 정보 입력
  const projectName = await promptQuestion('프로젝트 이름');
  const projectDesc = await promptQuestion('프로젝트 설명', '');
  const sprintRaw   = await promptQuestion('스프린트 번호', '1');
  const sprint      = parseInt(sprintRaw, 10) || 1;

  // 2. 기술 스택 선택
  console.log();
  const stackIdx = await promptSelect('기술 스택을 선택하세요:', [
    { label: 'Next.js + Express',   desc: 'Next.js 15 (App Router) + Express + Prisma + PostgreSQL' },
    { label: 'Next.js 풀스택',      desc: 'Next.js 15 (App Router + API Routes) — Vercel 친화적' },
    { label: 'React + FastAPI',      desc: 'React (Vite) + Python FastAPI + SQLAlchemy' },
    { label: '커스텀',               desc: '기본 템플릿 (프롬프트 직접 설정)' },
  ]);
  const stackKey = ['nextjs-express', 'nextjs-fullstack', 'react-fastapi', 'custom'][stackIdx];

  // 3. config.json 생성 (USER_WORKFLOW — 업데이트해도 덮어써지지 않음)
  console.log();
  if (!fs.existsSync(USER_WORKFLOW)) fs.mkdirSync(USER_WORKFLOW, { recursive: true });
  const config = generateConfig(projectName, projectDesc, sprint, stackKey);
  fs.writeFileSync(USER_CONFIG_PATH, JSON.stringify(config, null, 2));

  // 4. state.json 생성
  const initialState = {
    project: { name: projectName, description: projectDesc, sprint },
    completedSteps: [],
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(STATE_PATH, JSON.stringify(initialState, null, 2));

  // 5. status.md, state.js 생성
  syncFiles(config, initialState);

  // 6. CLAUDE.md에 다음 할 일 주입
  try { injectToClaude(config, initialState); } catch {}

  console.log(c('green', '✓ 초기화 완료!'));
  console.log();
  console.log(c('gray', '  생성된 파일:'));
  console.log(c('gray', '    .workflow/config.json  — 워크플로우 설정 (' + stackKey + ')'));
  console.log(c('gray', '    .workflow/state.json   — 진행 상태'));
  console.log(c('gray', '    .workflow/status.md    — 진행 요약'));
  console.log(c('gray', '    CLAUDE.md              — 다음 할 일 주입됨'));
  console.log();
  console.log(bold('다음:'));
  console.log(c('gray', '  node kit/cli.mjs next    — 다음 할 일 확인'));
  console.log(c('gray', '  node kit/cli.mjs status  — 전체 진행 상태'));
  console.log();
}

function cmdStatus() {
  const config = loadConfig();
  const state = loadState();
  const all = getAllSteps(config);
  const total = all.length;
  const done = (state.completedSteps || []).length;
  const pct = total ? Math.round(done / total * 100) : 0;
  const projectName = state.project?.name || config.project?.name || '(미설정)';

  console.log();
  console.log(bold(`⚡ ${projectName}`));
  console.log(c('gray', `   Sprint ${state.project?.sprint || 1}  |  Updated: ${new Date(state.updatedAt).toLocaleDateString('ko-KR')}`));
  console.log();
  console.log(`  ${bar(pct)} ${c('cyan', pct + '%')} (${done}/${total})`);
  console.log();

  config.phases.forEach(ph => {
    const pDone = ph.steps.filter(s => (state.completedSteps || []).includes(s.id)).length;
    const pPct = ph.steps.length ? Math.round(pDone / ph.steps.length * 100) : 0;
    const status = pDone === ph.steps.length
      ? c('green', '✓ 완료')
      : pDone > 0 ? c('yellow', '진행중') : c('gray', '대기');
    console.log(`  Phase ${ph.id}  ${bold(ph.name.slice(0, 14).padEnd(14))}  ${bar(pPct, 10)} ${String(pDone+'/'+ph.steps.length).padStart(4)}  ${status}`);
  });
  console.log();
}

function cmdList() {
  const config = loadConfig();
  const state = loadState();

  console.log();
  config.phases.forEach(ph => {
    const pDone = ph.steps.filter(s => (state.completedSteps || []).includes(s.id)).length;
    console.log(`${bold(`Phase ${ph.id}: ${ph.name}`)}  ${c('gray', `${pDone}/${ph.steps.length}`)}`);
    ph.steps.forEach(step => {
      const isDone = (state.completedSteps || []).includes(step.id);
      const mark = isDone ? c('green', '✓') : c('gray', '○');
      const label = isDone ? c('gray', step.title) : step.title;
      const qa = step.qa ? c('yellow', ' ★') : '';
      console.log(`  ${mark}  ${c('cyan', step.id)}  ${label}${qa}`);
    });
    console.log();
  });
}

function cmdNext() {
  const config = loadConfig();
  const state = loadState();
  const all = getAllSteps(config);
  const next = all.find(s => !(state.completedSteps || []).includes(s.id));

  if (!next) {
    console.log();
    console.log(c('green', '✓ 모든 단계가 완료되었습니다!'));
    return;
  }

  const ph = config.phases.find(p => p.id === next.phaseId);
  console.log();
  console.log(bold('다음 단계:'));
  console.log();
  console.log(`  ${c('cyan', next.id)}  ${bold(next.title)}${next.qa ? c('yellow', ' ★QA') : ''}`);
  console.log(`  ${c('gray', `Phase ${ph.id}: ${ph.name}`)}`);

  if (next.files && next.files.length) {
    console.log();
    console.log(c('gray', '  생성할 파일:'));
    next.files.forEach(f => console.log(c('gray', `    • ${f}`)));
  }

  if (next.templates && next.templates.length) {
    console.log();
    console.log(c('gray', `  템플릿 생성: node kit/cli.mjs template ${next.id}`));
  }

  if (next.prompts && next.prompts.length) {
    console.log();
    console.log(c('gray', '  Claude Code 프롬프트 예시:'));
    next.prompts.forEach((p, i) => {
      const preview = p.length > 80 ? p.slice(0, 80) + '...' : p;
      console.log(c('gray', `  [${i+1}] ${preview}`));
    });
  }

  console.log();
  console.log(c('gray', `  완료 처리: node kit/cli.mjs complete ${next.id}`));
  console.log();
}

function cmdComplete(stepId) {
  if (!stepId) { console.error(c('red', '❌ 사용법: node kit/cli.mjs complete <step-id>')); process.exit(1); }
  const config = loadConfig();
  const step = getStepById(config, stepId);
  if (!step) { console.error(c('red', `❌ Step not found: ${stepId}`)); process.exit(1); }

  const state = loadState();
  if (!state.completedSteps) state.completedSteps = [];

  if (state.completedSteps.includes(stepId)) {
    console.log(c('yellow', `ℹ  ${stepId} is already completed.`));
    return;
  }

  state.completedSteps.push(stepId);
  saveState(state);

  const all = getAllSteps(config);
  const total = all.length;
  const done = state.completedSteps.length;
  const pct = Math.round(done / total * 100);

  console.log();
  console.log(c('green', `✓ ${stepId}: ${step.title}`));
  console.log(c('gray', `  전체 진도: ${pct}% (${done}/${total})`));
  console.log(c('gray', `  state.json, status.md, state.js 업데이트 완료`));
  console.log();
}

function cmdUncomplete(stepId) {
  if (!stepId) { console.error(c('red', '❌ 사용법: node kit/cli.mjs uncomplete <step-id>')); process.exit(1); }
  const config = loadConfig();
  const step = getStepById(config, stepId);
  if (!step) { console.error(c('red', `❌ Step not found: ${stepId}`)); process.exit(1); }

  const state = loadState();
  if (!state.completedSteps) state.completedSteps = [];

  if (!state.completedSteps.includes(stepId)) {
    console.log(c('yellow', `ℹ  ${stepId} is not in completed list.`));
    return;
  }

  state.completedSteps = state.completedSteps.filter(id => id !== stepId);
  saveState(state);
  console.log(c('yellow', `↩ ${stepId}: ${step.title} — 완료 취소됨`));
}

function cmdTemplate(stepId) {
  if (!stepId) { console.error(c('red', '❌ 사용법: node kit/cli.mjs template <step-id>')); process.exit(1); }
  const config = loadConfig();
  const step = getStepById(config, stepId);
  if (!step) { console.error(c('red', `❌ Step not found: ${stepId}`)); process.exit(1); }

  const force = process.argv.includes('--force');
  const state = loadState();
  const projectName = state.project?.name || config.project?.name || 'My Project';
  const sprint = state.project?.sprint || config.project?.sprint || 1;
  const date = new Date().toISOString().split('T')[0];

  const vars = {
    '{{project.name}}': projectName,
    '{{project.description}}': state.project?.description || config.project?.description || '',
    '{{sprint}}': String(sprint),
    '{{date}}': date,
  };

  if (!step.templates || step.templates.length === 0) {
    console.log(c('yellow', `ℹ  ${stepId} has no templates defined.`));
    return;
  }

  console.log();
  let created = 0, skipped = 0;
  for (const t of step.templates) {
    const tmplPath = path.join(TEMPLATES_DIR, t.tmpl);
    const outPath = path.join(ROOT, t.out);

    if (!fs.existsSync(tmplPath)) {
      console.log(c('red', `  ✗ Template not found: .workflow/templates/${t.tmpl}`));
      continue;
    }

    if (fs.existsSync(outPath) && !force) {
      console.log(c('yellow', `  ○ Skip (exists): ${t.out}  (use --force to overwrite)`));
      skipped++;
      continue;
    }

    let content = fs.readFileSync(tmplPath, 'utf8');
    for (const [placeholder, value] of Object.entries(vars)) {
      content = content.split(placeholder).join(value);
    }

    const dir = path.dirname(outPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outPath, content);
    console.log(c('green', `  ✓ Created: ${t.out}`));
    created++;
  }

  console.log();
  console.log(c('gray', `  ${created} created, ${skipped} skipped`));
  console.log();
}

function cmdQc(phaseId) {
  if (!phaseId) { console.error(c('red', '❌ 사용법: node kit/cli.mjs qc <phase-id>')); process.exit(1); }
  const config = loadConfig();
  const ph = getPhaseById(config, phaseId);
  if (!ph) { console.error(c('red', `❌ Phase not found: ${phaseId}`)); process.exit(1); }
  if (!ph.qc) { console.log(c('yellow', `ℹ  Phase ${phaseId} has no QC section.`)); return; }

  console.log();
  console.log(bold(`QC: ${ph.name}`));
  console.log();
  console.log(c('cyan', '체크리스트:'));
  ph.qc.checks.forEach((check, i) => {
    console.log(`  ${c('gray', `[${i+1}]`)} ${check}`);
  });
  console.log();
  console.log(c('cyan', 'QC 프롬프트 (Claude Code에 복사):'));
  console.log();
  console.log(c('gray', '─'.repeat(60)));
  console.log(ph.qc.prompt);
  console.log(c('gray', '─'.repeat(60)));
  console.log();
}

function cmdGitStart(phaseId) {
  if (!phaseId) { console.error(c('red', '❌ 사용법: node kit/cli.mjs git-start <phase-id>')); process.exit(1); }
  const config = loadConfig();
  const ph = getPhaseById(config, phaseId);
  if (!ph) { console.error(c('red', `❌ Phase not found: ${phaseId}`)); process.exit(1); }
  if (!ph.git) { console.log(c('yellow', `ℹ  Phase ${phaseId} has no git config.`)); return; }

  const branch = ph.git.branch;
  console.log();
  console.log(c('cyan', `브랜치 생성: ${branch}`));
  try {
    execSync(`git checkout -b ${branch}`, { cwd: ROOT, stdio: 'inherit' });
    console.log(c('green', `✓ 브랜치 생성 완료: ${branch}`));
  } catch {
    console.log(c('yellow', `ℹ  Branch may already exist. Trying checkout...`));
    try {
      execSync(`git checkout ${branch}`, { cwd: ROOT, stdio: 'inherit' });
    } catch (e2) {
      console.error(c('red', `❌ git error: ${e2.message}`));
    }
  }
  console.log();
}

async function cmdGitFinish(phaseId) {
  if (!phaseId) { console.error(c('red', '❌ 사용법: node kit/cli.mjs git-finish <phase-id>')); process.exit(1); }
  const config = loadConfig();
  const ph = getPhaseById(config, phaseId);
  if (!ph) { console.error(c('red', `❌ Phase not found: ${phaseId}`)); process.exit(1); }
  if (!ph.git) { console.log(c('yellow', `ℹ  Phase ${phaseId} has no git config.`)); return; }

  console.log();
  console.log(bold(`Git Finish: Phase ${phaseId} — ${ph.name}`));
  console.log();
  console.log(c('gray', '실행될 명령어:'));
  ph.git.commands.forEach(cmd => {
    if (cmd.startsWith('#')) {
      console.log(c('gray', `  ${cmd}`));
    } else {
      console.log(c('cyan', `  $ ${cmd}`));
    }
  });
  console.log();

  const ok = await confirm(c('yellow', '위 명령어를 실행할까요?'));
  if (!ok) { console.log(c('gray', '취소됨')); return; }

  for (const cmd of ph.git.commands) {
    if (cmd.startsWith('#')) continue;
    console.log(c('gray', `$ ${cmd}`));
    try {
      execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
    } catch (e) {
      console.error(c('red', `❌ Failed: ${e.message}`));
      process.exit(1);
    }
  }
  console.log();
  console.log(c('green', '✓ Git finish 완료'));
  console.log();
}

function cmdLog(phaseId) {
  if (!phaseId) { console.error(c('red', '❌ 사용법: node kit/cli.mjs log <phase-id>')); process.exit(1); }
  const config = loadConfig();
  const ph = getPhaseById(config, phaseId);
  if (!ph) { console.error(c('red', `❌ Phase not found: ${phaseId}`)); process.exit(1); }
  if (!ph.log) { console.log(c('yellow', `ℹ  Phase ${phaseId} has no log config.`)); return; }

  const date = new Date().toISOString().split('T')[0];
  const logPath = path.join(ROOT, ph.log.file);

  // Create sprint-log.md if it doesn't exist
  if (!fs.existsSync(logPath)) {
    const tmplPath = path.join(TEMPLATES_DIR, 'sprint-log.md.tmpl');
    const dir = path.dirname(logPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(tmplPath)) {
      const state = loadState();
      const projectName = state.project?.name || config.project?.name || 'My Project';
      let content = fs.readFileSync(tmplPath, 'utf8');
      content = content.split('{{project.name}}').join(projectName);
      content = content.split('{{date}}').join(date);
      fs.writeFileSync(logPath, content);
      console.log(c('green', `✓ Created: ${ph.log.file}`));
    } else {
      const header = `# Sprint Log — {{project.name}}\n\n`;
      fs.writeFileSync(logPath, header);
    }
  }

  // Show log prompt
  console.log();
  console.log(bold(`LOG: ${ph.name}`));
  console.log(c('gray', `  파일: ${ph.log.file}`));
  console.log();
  console.log(c('cyan', '기록 항목:'));
  ph.log.items.forEach(item => console.log(c('gray', `  • ${item}`)));
  console.log();
  console.log(c('cyan', 'LOG 프롬프트 (Claude Code에 복사):'));
  console.log();
  console.log(c('gray', '─'.repeat(60)));
  console.log(ph.log.prompt);
  console.log(c('gray', '─'.repeat(60)));
  console.log();
}

async function cmdImportFromClaude(targetDir) {
  const projectRoot = targetDir ? path.resolve(targetDir) : ROOT;
  const claudePath = path.join(projectRoot, 'CLAUDE.md');

  console.log();
  console.log(bold('📥 CLAUDE.md 기반 상태 자동 감지'));
  console.log(c('gray', `  프로젝트 경로: ${projectRoot}`));
  console.log();

  // 1. CLAUDE.md 파싱 → 프로젝트 정보 추출
  let projectName = '';
  let projectDescription = '';

  if (fs.existsSync(claudePath)) {
    const content = fs.readFileSync(claudePath, 'utf8');
    const lines = content.split('\n');

    // 첫 번째 # 제목을 프로젝트 이름으로
    const titleLine = lines.find(l => l.startsWith('# '));
    if (titleLine) projectName = titleLine.replace(/^#\s+/, '').trim();

    // 첫 번째 비어있지 않은 일반 텍스트 단락을 설명으로
    let foundTitle = false;
    for (const line of lines) {
      if (line.startsWith('# ')) { foundTitle = true; continue; }
      if (foundTitle && line.trim() && !line.startsWith('#') && !line.startsWith('|') && !line.startsWith('!')) {
        projectDescription = line.trim().replace(/^>\s*/, '');
        break;
      }
    }

    console.log(c('cyan', 'CLAUDE.md 감지됨:'));
    console.log(`  프로젝트명: ${bold(projectName || '(감지 실패)')}`);
    if (projectDescription) console.log(`  설명: ${c('gray', projectDescription.slice(0, 80))}`);
  } else {
    console.log(c('yellow', `ℹ  CLAUDE.md 없음: ${claudePath}`));
    console.log(c('gray', '  파일 존재 여부만으로 상태를 감지합니다.'));
  }
  console.log();

  // 2. 각 step의 files 배열로 완료 여부 감지
  const config = loadConfig();
  const state = loadState();
  const detectedComplete = [];
  const partialSteps = [];
  const notStarted = [];

  console.log(c('cyan', '파일 존재 여부 검사 중...'));
  console.log();

  for (const ph of config.phases) {
    for (const step of ph.steps) {
      if (!step.files || step.files.length === 0) {
        // 파일 정의 없는 step은 감지 불가 → 건너뜀
        continue;
      }

      // [placeholder] 포함 파일은 동적 파일이므로 제외
      const checkableFiles = step.files.filter(f => !f.includes('['));
      if (checkableFiles.length === 0) continue;

      const existingFiles = checkableFiles.filter(f => fs.existsSync(path.join(projectRoot, f)));
      const ratio = existingFiles.length / checkableFiles.length;

      if (ratio === 1) {
        detectedComplete.push({ step, ph, existingFiles });
      } else if (ratio > 0) {
        partialSteps.push({ step, ph, existingFiles, checkableFiles });
      } else {
        notStarted.push({ step, ph });
      }
    }
  }

  // 3. 결과 출력
  if (detectedComplete.length > 0) {
    console.log(c('green', `✓ 완료된 것으로 감지됨 (${detectedComplete.length}개):`));
    detectedComplete.forEach(({ step, ph }) => {
      const alreadyDone = state.completedSteps.includes(step.id);
      const suffix = alreadyDone ? c('gray', ' (이미 완료)') : c('green', ' ← 새로 감지');
      console.log(`  ${c('cyan', step.id)}  ${step.title}${suffix}`);
    });
    console.log();
  }

  if (partialSteps.length > 0) {
    console.log(c('yellow', `△ 일부만 존재 (수동 확인 필요 ${partialSteps.length}개):`));
    partialSteps.forEach(({ step, existingFiles, checkableFiles }) => {
      console.log(`  ${c('cyan', step.id)}  ${step.title}  ${c('gray', `${existingFiles.length}/${checkableFiles.length} 파일`)}`);;
    });
    console.log();
  }

  const newCompletions = detectedComplete.filter(({ step }) => !state.completedSteps.includes(step.id));

  if (newCompletions.length === 0) {
    console.log(c('yellow', 'ℹ  새로 추가할 완료 step이 없습니다.'));
    if (projectName && !state.project?.name) {
      console.log(c('gray', `  프로젝트명 "${projectName}"을 적용하려면 config.json > project.name을 수정하세요.`));
    }
    console.log();
    return;
  }

  // 4. 확인 후 state 업데이트
  console.log(bold(`총 ${newCompletions.length}개 step을 완료 처리합니다:`));
  newCompletions.forEach(({ step }) => {
    console.log(`  ${c('green', '✓')} ${c('cyan', step.id)} ${step.title}`);
  });
  console.log();

  const ok = await confirm(c('yellow', '위 step들을 완료 처리할까요?'));
  if (!ok) { console.log(c('gray', '취소됨')); return; }

  // 프로젝트 이름도 업데이트
  if (projectName && !state.project?.name) {
    state.project = state.project || {};
    state.project.name = projectName;
    if (projectDescription) state.project.description = projectDescription;
    console.log(c('green', `✓ 프로젝트명 업데이트: "${projectName}"`));
  }

  if (!state.completedSteps) state.completedSteps = [];
  newCompletions.forEach(({ step }) => {
    if (!state.completedSteps.includes(step.id)) {
      state.completedSteps.push(step.id);
    }
  });

  saveState(state);

  const all = getAllSteps(config);
  const pct = Math.round(state.completedSteps.length / all.length * 100);
  console.log();
  console.log(c('green', `✓ 상태 업데이트 완료!`));
  console.log(c('gray', `  전체 진도: ${pct}% (${state.completedSteps.length}/${all.length})`));
  console.log(c('gray', `  state.json, status.md, state.js 재생성 완료`));
  console.log();
  console.log(c('gray', '  ※ 일부 감지된 step은 수동으로 확인하세요:'));
  console.log(c('gray', '    node kit/cli.mjs list        — 전체 목록'));
  console.log(c('gray', '    node kit/cli.mjs complete <id> — 추가 완료 처리'));
  console.log();
}

async function cmdUpdate() {
  console.log();
  console.log(bold('🔄 claude-code-kit 업데이트'));
  console.log();

  // 현재 버전 확인
  const pkgPath = path.join(KIT_ROOT, 'package.json');
  let currentVersion = '?';
  if (fs.existsSync(pkgPath)) {
    try { currentVersion = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || '?'; } catch {}
  }
  console.log(c('gray', `  현재 버전: v${currentVersion}`));
  console.log(c('gray', `  kit 경로: ${KIT_ROOT}`));
  console.log(c('gray', `  state 경로: ${STATE_PATH} ${fs.existsSync(STATE_PATH) ? c('green','✓') : c('red','없음')}`));
  console.log();

  // state.json이 ROOT/.workflow에 있는지 확인 (새 구조)
  // KIT_ROOT/.workflow에만 있으면 구버전 경고
  const stateInKit = fs.existsSync(LEGACY_STATE) && LEGACY_STATE !== STATE_PATH;
  if (stateInKit) {
    console.log(c('yellow', '⚠  state.json이 kit 내부에 있습니다 (구버전 위치).'));
    console.log(c('yellow', '   업데이트 전 마이그레이션이 필요합니다.'));
    console.log();
    const ok = await confirm(c('cyan', '지금 state.json을 프로젝트 루트로 이동할까요?'));
    if (!ok) {
      console.log(c('red', '❌ 업데이트 취소. 수동으로 state.json을 백업 후 업데이트하세요.'));
      return;
    }
    try {
      if (!fs.existsSync(USER_WORKFLOW)) fs.mkdirSync(USER_WORKFLOW, { recursive: true });
      fs.copyFileSync(LEGACY_STATE, STATE_PATH);
      fs.renameSync(LEGACY_STATE, LEGACY_STATE + '.migrated');
      console.log(c('green', `✓ 마이그레이션 완료: ${STATE_PATH}`));
    } catch (e) {
      console.error(c('red', `❌ 마이그레이션 실패: ${e.message}`));
      return;
    }
    console.log();
  }

  // 설치 방식 감지
  const isNpmGlobal = KIT_ROOT.includes('node_modules') && !KIT_ROOT.includes(ROOT);
  const isNpx = KIT_ROOT.includes('_npx') || KIT_ROOT.includes('.npm');
  const isGitSubmodule = fs.existsSync(path.join(KIT_ROOT, '.git')) || fs.existsSync(path.join(ROOT, '.gitmodules'));
  const isStandalone = KIT_ROOT === ROOT;

  console.log(c('cyan', '설치 방식 감지:'));
  if (isNpx) {
    console.log(`  ${c('yellow', 'npx 모드')} — 다음 실행 시 자동으로 최신 버전을 사용합니다.`);
    console.log(c('gray', '  npx claude-code-kit@latest <command>'));
  } else if (isNpmGlobal) {
    console.log(`  ${c('cyan', 'npm 설치')} — 다음 명령으로 업데이트하세요:`);
    console.log(c('gray', '  npm install -g claude-code-kit@latest'));
    console.log(c('gray', '  # 또는 로컬: npm install claude-code-kit@latest'));
  } else if (isGitSubmodule) {
    console.log(`  ${c('magenta', 'git submodule')} — 다음 명령으로 업데이트하세요:`);
    console.log(c('gray', `  git submodule update --remote ${path.relative(ROOT, KIT_ROOT)}`));
  } else if (isStandalone) {
    console.log(`  ${c('blue', 'standalone')} — git pull로 업데이트하세요:`);
    console.log(c('gray', '  git pull origin main'));
  } else {
    console.log(`  ${c('gray', '직접 복사')} — kit 디렉토리를 새 버전으로 교체하세요.`);
    console.log(c('gray', `  kit 경로: ${KIT_ROOT}`));
  }

  console.log();
  console.log(bold('업데이트 후 안전성:'));
  console.log(`  ${c('green', '✓')} state.json  — ${STATE_PATH}`);
  console.log(`  ${c('green', '✓')} status.md   — 업데이트 후 ${c('cyan','sync')} 명령으로 재생성`);
  console.log(`  ${c('yellow', '↻')} config.json — 새 버전 설정으로 교체됨 (커스텀 설정은 수동 재적용)`);
  console.log();
  console.log(c('gray', '  업데이트 완료 후: node kit/cli.mjs sync'));
  console.log();
}

function cmdSync() {
  const config = loadConfig();
  const state = loadState();
  syncFiles(config, state);
  try { injectToClaude(config, state); } catch {}
  console.log(c('green', '✓ status.md, state.js, CLAUDE.md 재생성 완료'));
}

// ─── CLAUDE.md Injector ───────────────────────────────────────────────────────

function injectToClaude(config, state) {
  const START = '<!-- claude-code-kit:start -->';
  const END   = '<!-- claude-code-kit:end -->';

  const all  = getAllSteps(config);
  const done = (state.completedSteps || []).length;
  const pct  = all.length ? Math.round(done / all.length * 100) : 0;
  const next = all.find(s => !(state.completedSteps || []).includes(s.id));

  let section;
  if (!next) {
    section = `${START}\n## 워크플로우 완료! 🎉\n\n모든 단계 완료 (${done}/${all.length})\n${END}`;
  } else {
    const ph     = config.phases.find(p => p.id === next.phaseId);
    const phDone = ph.steps.filter(s => (state.completedSteps || []).includes(s.id)).length;

    let s = `${START}\n`;
    s += `## 다음 할 일 (claude-code-kit)\n\n`;
    s += `**\`${next.id}\`** ${next.title}${next.qa ? ' ★QA' : ''}\n`;
    s += `Phase ${ph.id} — ${ph.name} (${phDone}/${ph.steps.length}) | 전체 ${pct}%\n\n`;

    if (next.files && next.files.length) {
      s += `**생성할 파일:** ${next.files.map(f => `\`${f}\``).join(', ')}\n\n`;
    }

    if (next.prompts && next.prompts.length) {
      next.prompts.forEach((p, i) => {
        s += `### 프롬프트 [${i + 1}/${next.prompts.length}]\n${p}\n\n`;
      });
    }

    s += `---\n*완료 후: \`node kit/cli.mjs complete ${next.id}\`*\n`;
    s += END;
    section = s;
  }

  let content = fs.existsSync(CLAUDE_MD_PATH)
    ? fs.readFileSync(CLAUDE_MD_PATH, 'utf8')
    : '';

  if (content.includes(START)) {
    const si = content.indexOf(START);
    const ei = content.indexOf(END) + END.length;
    content = content.slice(0, si).trimEnd() + '\n\n' + section + '\n' + content.slice(ei).trimStart();
  } else {
    content = (content.trimEnd() ? content.trimEnd() + '\n\n' : '') + section + '\n';
  }

  fs.writeFileSync(CLAUDE_MD_PATH, content);
}

async function cmdReset() {
  console.log();
  console.log(c('yellow', '⚠  전체 워크플로우 상태를 초기화합니다.'));
  console.log(c('gray', '   (config.json과 templates는 유지됩니다)'));
  console.log();

  const ok = await confirm(c('red', '정말 초기화할까요?'));
  if (!ok) { console.log(c('gray', '취소됨')); return; }

  const config = loadConfig();
  const newState = {
    project: {
      name: config.project?.name || '',
      description: config.project?.description || '',
      sprint: config.project?.sprint || 1,
    },
    completedSteps: [],
    updatedAt: new Date().toISOString(),
  };
  saveState(newState);
  console.log(c('green', '✓ 초기화 완료'));
}

function cmdHelp() {
  console.log();
  console.log(bold('⚡ claude-code-kit CLI'));
  console.log(c('gray', '  워크플로우 에이전트 시스템'));
  console.log();
  console.log(bold('명령어:'));
  const cmds = [
    ['init',                  '워크플로우 초기화 (state.json, status.md, state.js 생성)'],
    ['status',                '전체 진행 상태 요약'],
    ['list',                  '전체 phase/step 목록 + 완료 표시'],
    ['next',                  '다음 미완료 step 안내 (프롬프트, 파일 포함)'],
    ['complete <step-id>',    'step 완료 처리 → 상태 파일 자동 업데이트'],
    ['uncomplete <step-id>',  'step 완료 취소'],
    ['template <step-id>',    '해당 step의 MD 템플릿 파일 생성 (--force: 덮어쓰기)'],
    ['qc <phase-id>',         'QC 체크리스트 + 프롬프트 출력'],
    ['git-start <phase-id>',  'feature 브랜치 생성'],
    ['git-finish <phase-id>', 'git add + commit + push (확인 후 실행)'],
    ['log <phase-id>',        'sprint-log.md 기록 프롬프트 출력'],
    ['import-from-claude [dir]','CLAUDE.md + 파일 존재 여부로 완료 step 자동 감지 & 반영'],
    ['update',                'kit 업데이트 안내 (state 보존 방법 + 설치 방식 감지)'],
    ['sync',                  'state.json → status.md + state.js 재생성'],
    ['reset',                 '전체 상태 초기화 (확인 필요)'],
  ];
  cmds.forEach(([cmd, desc]) => {
    console.log(`  ${c('cyan', ('node kit/cli.mjs ' + cmd).padEnd(40))} ${c('gray', desc)}`);
  });
  console.log();
  console.log(bold('예시:'));
  console.log(c('gray', '  node kit/cli.mjs init'));
  console.log(c('gray', '  node kit/cli.mjs next'));
  console.log(c('gray', '  node kit/cli.mjs complete p1s0'));
  console.log(c('gray', '  node kit/cli.mjs template p1s1'));
  console.log(c('gray', '  node kit/cli.mjs qc 1'));
  console.log(c('gray', '  node kit/cli.mjs git-start 1'));
  console.log();
}

// ─── Router ──────────────────────────────────────────────────────────────────
const [,, cmd, ...args] = process.argv;

switch (cmd) {
  case 'init':        cmdInit();           break;
  case 'status':      cmdStatus();         break;
  case 'list':        cmdList();           break;
  case 'next':        cmdNext();           break;
  case 'complete':    cmdComplete(args[0]); break;
  case 'uncomplete':  cmdUncomplete(args[0]); break;
  case 'template':    cmdTemplate(args[0]); break;
  case 'qc':          cmdQc(args[0]);      break;
  case 'git-start':   cmdGitStart(args[0]); break;
  case 'git-finish':  cmdGitFinish(args[0]); break;
  case 'log':         cmdLog(args[0]);     break;
  case 'import-from-claude': cmdImportFromClaude(args[0]); break;
  case 'update':      cmdUpdate();         break;
  case 'sync':        cmdSync();           break;
  case 'reset':       cmdReset();          break;
  case 'help':
  case '--help':
  case '-h':
  case undefined:     cmdHelp();           break;
  default:
    console.error(c('red', `❌ Unknown command: ${cmd}`));
    cmdHelp();
    process.exit(1);
}

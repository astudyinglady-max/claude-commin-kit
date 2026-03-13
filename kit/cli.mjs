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

// ─── Core Helpers ────────────────────────────────────────────────────────────
function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(c('red', '❌ .workflow/config.json not found.'));
    console.error(c('yellow', '   Run: node kit/cli.mjs init'));
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
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

// ─── Commands ────────────────────────────────────────────────────────────────

function cmdInit() {
  let created = [];

  if (!fs.existsSync(USER_WORKFLOW)) {
    fs.mkdirSync(USER_WORKFLOW, { recursive: true });
    created.push('.workflow/');
  }

  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(c('red', '❌ .workflow/config.json not found.'));
    console.error(c('yellow', '   Please ensure the kit is complete (config.json should exist in .workflow/).'));
    process.exit(1);
  }

  if (!fs.existsSync(STATE_PATH)) {
    const config = loadConfig();
    const initialState = {
      project: {
        name: config.project?.name || '',
        description: config.project?.description || '',
        sprint: config.project?.sprint || 1,
      },
      completedSteps: [],
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(STATE_PATH, JSON.stringify(initialState, null, 2));
    created.push('.workflow/state.json');
  } else {
    console.log(c('yellow', 'ℹ  .workflow/state.json already exists — skipping'));
  }

  const config = loadConfig();
  const state = loadState();
  syncFiles(config, state);
  created.push('.workflow/status.md', '.workflow/state.js');

  console.log();
  created.forEach(f => console.log(c('green', `✓ Created: ${f}`)));
  console.log();
  console.log(bold('워크플로우 초기화 완료!'));
  console.log(c('gray', `  node kit/cli.mjs status    — 현재 상태 확인`));
  console.log(c('gray', `  node kit/cli.mjs next      — 다음 할 일 확인`));
  console.log(c('gray', `  node kit/cli.mjs list      — 전체 목록 확인`));
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
  console.log(bold('🔄 claude-commin-kit 업데이트'));
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
    console.log(c('gray', '  npx claude-commin-kit@latest <command>'));
  } else if (isNpmGlobal) {
    console.log(`  ${c('cyan', 'npm 설치')} — 다음 명령으로 업데이트하세요:`);
    console.log(c('gray', '  npm install -g claude-commin-kit@latest'));
    console.log(c('gray', '  # 또는 로컬: npm install claude-commin-kit@latest'));
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
  console.log(c('green', '✓ status.md, state.js 재생성 완료'));
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
  console.log(bold('⚡ claude-commin-kit CLI'));
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

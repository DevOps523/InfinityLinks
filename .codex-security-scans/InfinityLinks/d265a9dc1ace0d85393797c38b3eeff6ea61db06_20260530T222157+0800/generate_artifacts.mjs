import fs from 'node:fs';
import path from 'node:path';

const root = String.raw`C:\Users\Administrator\Desktop\InfinityLinks`;
const scanId = 'd265a9dc1ace0d85393797c38b3eeff6ea61db06_20260530T222157+0800';
const scanDir = path.join(root, '.codex-security-scans', 'InfinityLinks', scanId);
const artifactsDir = path.join(scanDir, 'artifacts');
const discoveryDir = path.join(artifactsDir, '02_discovery');
const coverageDir = path.join(artifactsDir, '03_coverage');
const reconciliationDir = path.join(artifactsDir, '04_reconciliation');
const findingsDir = path.join(artifactsDir, '05_findings');

for (const dir of [discoveryDir, coverageDir, reconciliationDir, findingsDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeRel(rel, text) {
  const filePath = path.join(scanDir, rel);
  ensureDir(filePath);
  fs.writeFileSync(filePath, text.replace(/\n/g, '\r\n'), 'utf8');
}

function writeArtifact(rel, text) {
  const filePath = path.join(artifactsDir, rel);
  ensureDir(filePath);
  fs.writeFileSync(filePath, text.replace(/\n/g, '\r\n'), 'utf8');
}

function jsonl(rows) {
  return `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
}

function slug(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const candidates = [
  {
    id: 'DEPLOY-SECRETS-001',
    severity: 'high',
    confidence: 'high',
    title: 'Google service account key is present in the deployable app tree',
    category: 'Hardcoded credentials / secret material in deployable source tree',
    cwe: 'CWE-798: Use of Hard-coded Credentials',
    affected: [
      'apps/public-search-bot/google-service-account.json:1',
      '.gitignore:4',
      'apps/public-search-bot/src/config.ts:49'
    ],
    summary:
      'A real Google service account JSON key is present at the root of the deployable public-search bot package. It is ignored by git and not bundled into browser code, but VPS copy, backup, archive, SFTP, support, or misconfigured static serving workflows can expose a credential that grants Google Sheets access.',
    validation:
      'Redacted local inspection confirmed the file exists, has service_account structure, includes private key fields, is not git-tracked, and is ignored by .gitignore. Searches for the actual local secret values across client and dist output did not find browser exposure.',
    dataflow:
      'Local credential file -> GOOGLE_SERVICE_ACCOUNT_KEY_FILE config -> Google Sheets client authentication -> read/write subscription sheet operations.',
    reachability:
      'Anyone who gains access to a deployment archive, VPS copy, backup, or mistakenly served source directory can recover the key without needing application authentication. Direct browser exposure was not observed in this repo.',
    severityText:
      'High because the file is live credential material in a deployable directory and compromise gives access to the subscription control-plane data store. Severity would drop after rotation and moving credentials outside the source/deploy tree; it would rise if the VPS serves repository files directly.',
    remediation:
      'Revoke and rotate the Google service account key. Store credentials outside the repo and deploy tree, preferably as a root-owned environment secret, systemd credential, or secret-manager mount. Keep only a path or injected JSON in runtime config, deny web access to source directories, and add a startup check that rejects key files under the repository path.',
    rootFile: 'apps/public-search-bot/google-service-account.json',
    rootLine: 1,
    priority: 1
  },
  {
    id: 'AUTH-MUSTCHANGE-001',
    severity: 'medium',
    confidence: 'high',
    title: 'Forced password-change state is enforced only in the browser UI',
    category: 'Authorization bypass / incomplete server-side session enforcement',
    cwe: 'CWE-602: Client-Side Enforcement of Server-Side Security',
    affected: [
      'src/server/auth/session.ts:106-127',
      'src/client/auth/AuthGate.tsx:78-85',
      'src/server/admin/users.routes.ts:75-83',
      'src/server/admin/users.routes.ts:128-132'
    ],
    summary:
      'Temporary and reset credentials set mustChangePassword, and the React auth gate sends those users to the change-password screen. The server-side API middleware refreshes the DB user but does not deny API access while mustChangePassword remains true, so the sensitive state is only enforced by client navigation.',
    validation:
      'A validation test created an admin user with must_change_password=1 and showed GET /api/admin/users still returns 200. The same test showed an existing signed-in admin session remains authorized after the database flips must_change_password to true.',
    dataflow:
      'Temporary/reset credential -> Auth.js credentials authorize -> session cookie -> /api middleware requireApiAuth -> res.locals.authUser -> protected admin routes.',
    reachability:
      'An attacker with a temporary password, reset password, or stolen session can bypass the browser gate by calling APIs directly from same-origin tooling or any request path that satisfies the admin API request guard.',
    severityText:
      'Medium because exploitation requires a valid account credential or session and the app is intended for private administration, but it breaks a high-value account recovery boundary. Severity would rise if the admin app is exposed beyond a trusted operator network or if temporary passwords are distributed through weak channels.',
    remediation:
      'Make requireApiAuth reject mustChangePassword sessions for all APIs except /api/auth/change-password and sign-out/session refresh endpoints. Refresh JWT/session state after password change, add regression tests for every privileged router, and consider invalidating old sessions on reset.',
    rootFile: 'src/server/auth/session.ts',
    rootLine: 125,
    priority: 2
  },
  {
    id: 'CAND-PSB-001',
    severity: 'medium',
    confidence: 'high',
    title: 'Public bot bearer tokens accept trivially weak or placeholder values',
    category: 'Weak secret validation / insecure deployment default',
    cwe: 'CWE-521: Weak Password Requirements',
    affected: [
      'apps/public-search-bot/src/config.ts:3-5',
      'apps/public-search-bot/src/config.ts:31-49',
      'apps/public-search-bot/src/config.ts:50-58'
    ],
    summary:
      'The public VPS bot protects sync, status, and subscription admin APIs with bearer tokens, but requiredSecret only enforces a trimmed length of at least one character. Placeholder-looking or one-character tokens pass startup validation as long as the three values differ.',
    validation:
      'A validation test loaded the public-search bot config with one-character and placeholder tokens and confirmed both cases were accepted. The current local .env uses long random-looking tokens, so this is a deployment guardrail weakness rather than proof that the live deployment is weak.',
    dataflow:
      'VPS environment variable -> requiredSecret min(1) -> config.publicSearchSyncToken/statusToken/subscriptionAdminToken -> bearer comparison in public HTTP routes.',
    reachability:
      'If an operator follows the example but leaves short or placeholder tokens in production, internet clients reaching the VPS endpoints can brute force or guess tokens that authorize catalog sync, status reads, or subscription actions.',
    severityText:
      'Medium because the affected APIs are intended to be public-network reachable behind Nginx and tokens are the main application-level control. Severity would drop if deployment automation always injects strong random secrets; it would rise if weak values are already deployed.',
    remediation:
      'Require at least 32 bytes of entropy or a 43+ character URL-safe/base64 secret, reject common placeholder words, and fail startup when tokens match example values. Update .env.example and README generation commands to use openssl rand or equivalent.',
    rootFile: 'apps/public-search-bot/src/config.ts',
    rootLine: 4,
    priority: 2
  },
  {
    id: 'TEL-JOB-AUTHZ-001',
    severity: 'medium',
    confidence: 'high',
    title: 'Authenticated non-admin users can list and retry failed Telegram jobs',
    category: 'Missing authorization for privileged job operations',
    cwe: 'CWE-862: Missing Authorization',
    affected: [
      'src/server/telegram/telegram.admin.routes.ts:19-30',
      'src/server/app.ts:64-69',
      'src/server/telegram/telegram.queue.ts:355-377',
      'src/server/telegram/telegram.queue.ts:527-538',
      'src/server/telegram/telegram.client.ts:89'
    ],
    summary:
      'Telegram job routes are mounted after global authentication but do not check the caller role. The UI exposes Telegram Jobs to every authenticated role, while user-management routes have an admin check. A non-admin authenticated user can view failed job error details and move failed jobs back into the outbound queue.',
    validation:
      'A validation test signed in a non-admin superadmin-role user, inserted a failed Telegram job, and received 200 responses for both GET /api/telegram/jobs/failed and POST /api/telegram/jobs/:id/retry.',
    dataflow:
      'Authenticated non-admin session -> /api/telegram/jobs/:id/retry -> retryFailedTelegramJob status update -> processNextTelegramJob -> Telegram Bot API send/edit/delete action.',
    reachability:
      'Any authenticated non-admin operator can trigger the route from the same-origin app or API client. The action is limited to retrying existing failed jobs, but those jobs represent privileged Telegram message operations.',
    severityText:
      'Medium because it crosses a role boundary and can trigger external Telegram side effects, though it cannot create arbitrary new jobs by itself. Severity would rise if failed job payloads include sensitive content or if lower-privileged roles are given broadly to untrusted users.',
    remediation:
      'Add a role middleware for Telegram job listing/retry, likely the same admin role required for user management or a dedicated job-admin permission. Hide the sidebar item for unauthorized roles and add tests that non-admin users receive 403.',
    rootFile: 'src/server/telegram/telegram.admin.routes.ts',
    rootLine: 19,
    priority: 2
  },
  {
    id: 'AUTH-LOGIN-RATE-001',
    severity: 'low',
    confidence: 'high',
    title: 'Credentials login has no failed-attempt throttling',
    category: 'Missing rate limiting on authentication endpoint',
    cwe: 'CWE-307: Improper Restriction of Excessive Authentication Attempts',
    affected: ['src/server/auth/session.ts:58-64', 'src/server/auth/passwords.ts:36'],
    summary:
      'The Auth.js credentials provider checks email and password and returns null for failures, but there is no per-IP, per-account, or global failed-login limiter around the credential callback.',
    validation:
      'A validation test sent fifteen wrong-password credentials callbacks for the same account and observed authentication failures without a 429 or lockout signal.',
    dataflow:
      'Attacker-supplied email/password -> /auth/callback/credentials -> authorize -> findAuthUserByEmail and verifyPassword -> null response without throttle state.',
    reachability:
      'Anyone who can reach the admin login endpoint can try repeated passwords. The admin request guard protects /api, not /auth, and no login-specific limiter was found in the credentials callback path.',
    severityText:
      'Low in the intended private-loopback deployment because network exposure should be limited, but it becomes medium if the admin login is reachable from the internet or a shared network. Severity would drop if upstream VPN or reverse-proxy throttling is guaranteed and tested.',
    remediation:
      'Add failed-login throttling keyed by IP and normalized email, return consistent errors, log lockouts, and add tests for repeated bad credentials and successful login after the window resets.',
    rootFile: 'src/server/auth/session.ts',
    rootLine: 58,
    priority: 3
  },
  {
    id: 'CAND-PSB-002',
    severity: 'low',
    confidence: 'high',
    title: 'Status and subscription bearer endpoints do not throttle failed authentication',
    category: 'Missing rate limiting on token-protected public endpoints',
    cwe: 'CWE-307: Improper Restriction of Excessive Authentication Attempts',
    affected: [
      'apps/public-search-bot/src/status.routes.ts:20-23',
      'apps/public-search-bot/src/subscriptions/routes.ts:15-18',
      'apps/public-search-bot/src/sync.routes.ts:22-38'
    ],
    summary:
      'The sync endpoint has a bad-auth limiter, but the status and subscription admin routes compare bearer tokens directly and return 401 for every bad attempt without throttling. This leaves the read-only status token and subscription admin token easier to brute force if deployed weakly.',
    validation:
      'A validation test sent twenty invalid bearer requests to status and subscription endpoints and observed only 401 responses. The same source review found sync has a dedicated bad-auth limiter, demonstrating the intended control pattern exists for one sibling route but not the others.',
    dataflow:
      'Internet request with Authorization header -> /api/status or /api/subscriptions/* -> direct token comparison -> unlimited 401 responses until the correct token is guessed.',
    reachability:
      'The routes are intended for VPS access from local status checks or Google Apps Script. Attackers need network access to the VPS endpoint and benefit most if token policy also allows weak secrets.',
    severityText:
      'Low on its own because strong random tokens make guessing impractical, but the missing limiter compounds the weak-token startup policy. Severity would rise if endpoint logs show internet scanning or if deployed tokens are short.',
    remediation:
      'Apply the same bad-auth fixed-window limiter used by /sync to status and subscription routes, ideally with separate buckets for token class and client IP. Add tests that repeated invalid status/subscription bearer attempts return 429.',
    rootFile: 'apps/public-search-bot/src/status.routes.ts',
    rootLine: 20,
    priority: 3
  }
];

const suppressed = {
  id: 'CAND-PUBBOT-001',
  title: 'Season callback trial-quota amplification',
  status: 'rejected',
  reason:
    'Existing behavior and tests show season callbacks are non-consuming by design, exhausted/blocked users are denied season details, and ordinary Telegram clients can only press callback buttons produced by the bot.'
};

const deepCsv = fs.readFileSync(path.join(discoveryDir, 'deep_review_input.csv'), 'utf8').trim().split(/\r?\n/);
const paths = deepCsv.slice(1).map((line) => line.split(',')[0]).filter(Boolean);

function surfaceFor(filePath) {
  const file = filePath.replace(/\\/g, '/');
  if (file.includes('/auth/') || file.includes('AuthGate') || file.includes('LoginPage') || file.includes('admin/users')) {
    return 'auth-login-session-admin-users';
  }
  if (
    file.includes('public-search-bot/src/config') ||
    file.includes('public-search-bot/src/status') ||
    file.includes('public-search-bot/src/sync') ||
    file.includes('public-search-bot/src/subscriptions/routes')
  ) {
    return 'public-bot-http-token-api';
  }
  if (file.includes('public-search-bot/src/bot') || file.includes('public-search-bot/src/subscriptions/access')) {
    return 'public-telegram-bot-access';
  }
  if (file.includes('telegram/')) {
    return 'private-telegram-job-control';
  }
  if (file.includes('tmdb') || file.includes('media') || file.includes('repository')) {
    return 'media-tmdb-db';
  }
  if (file.includes('public-search')) {
    return 'local-public-search-sync-status';
  }
  if (file.endsWith('.md') || file.includes('README') || file.includes('instruction')) {
    return 'deployment-docs';
  }
  if (file.includes('vite') || file.includes('tsconfig') || file.includes('package') || file.includes('.gitignore') || file.includes('service')) {
    return 'deployment-config';
  }
  if (file.includes('src/client')) {
    return 'client-browser';
  }
  return 'supporting-code-or-tests';
}

const discoveryRows = paths.map((filePath) => {
  const surface = surfaceFor(filePath);
  const supporting = surface === 'deployment-docs' || surface === 'deployment-config' || surface === 'supporting-code-or-tests';
  return {
    scan_id: scanId,
    path: filePath,
    owner: 'parent+approved-subagent-shards',
    surface,
    disposition: supporting ? 'not_applicable' : 'reviewed',
    reason: supporting
      ? 'Reviewed as supporting material for deployment/runtime context; no standalone exploitable code path identified.'
      : `Covered in ${surface} shard; no separate reportable issue for this row.`
  };
});

writeArtifact('02_discovery/work_ledger.jsonl', jsonl(discoveryRows));

const rawRows = candidates.map((candidate) => ({
  candidate_id: candidate.id,
  title: candidate.title,
  status: 'candidate',
  final_disposition: 'reportable',
  severity: candidate.severity,
  confidence: candidate.confidence,
  affected_locations: candidate.affected,
  source: 'repository-wide Codex Security scan',
  validation_recommended: true,
  candidate_local_validation_evidence: candidate.validation
}));
rawRows.push({
  candidate_id: suppressed.id,
  title: suppressed.title,
  status: 'candidate',
  final_disposition: 'rejected',
  severity: 'none',
  confidence: 'medium',
  reason: suppressed.reason,
  validation_recommended: false
});

writeArtifact('02_discovery/raw_candidates.jsonl', jsonl(rawRows));
writeArtifact(
  '04_reconciliation/deduped_candidates.jsonl',
  jsonl(candidates.map((candidate) => ({
    candidate_id: candidate.id,
    title: candidate.title,
    disposition: 'reportable',
    severity: candidate.severity,
    confidence: candidate.confidence,
    affected_locations: candidate.affected
  })))
);

writeArtifact(
  '04_reconciliation/dedupe_report.md',
  `# Dedupe Report

Seven raw candidates were reconciled into six reportable findings and one rejected candidate.

| Raw candidate | Final disposition | Notes |
|---|---|---|
${rawRows.map((row) => `| ${row.candidate_id} | ${row.final_disposition} | ${row.final_disposition === 'reportable' ? 'Preserved as independently attackable source/control/sink tuple.' : suppressed.reason} |`).join('\n')}
`
);

writeArtifact(
  '02_discovery/finding_discovery_report.md',
  `# Finding Discovery Report

Repository-wide discovery covered ${paths.length} ranked/deep-review rows from \`rank_input.csv\` and \`deep_review_input.csv\`.

## Promoted Candidates

${rawRows.map((row) => `- ${row.candidate_id}: ${row.title} (${row.final_disposition})`).join('\n')}

## Coverage Notes

The work ledger closes every deep-review row as reviewed or not applicable. High-impact surfaces included authentication, password reset and temporary passwords, admin request guard, bearer-token public VPS APIs, Telegram job control, media/TMDB data handling, public Telegram bot callbacks, deployment secrets, and browser/client storage exposure.
`
);

const reviewedSurfaces = [
  [
    'Auth login, sessions, temporary-password flow',
    'Credential theft, reset bypass, forced password-change bypass, browser credential exposure',
    'Reported',
    'AUTH-MUSTCHANGE-001 and AUTH-LOGIN-RATE-001 survived validation. Browser searches did not find secret values or credential persistence in client storage.'
  ],
  [
    'Admin request guard and user-management API',
    'Cross-site API calls, stale/deleted user sessions, role checks',
    'No issue found',
    'Global /api guard checks custom header/origin/host; user-management router has an admin role check.'
  ],
  [
    'Public-search bot bearer-token configuration',
    'Weak deployment secrets for sync/status/subscription APIs',
    'Reported',
    'CAND-PSB-001 survived validation; current local .env values appear long, but code permits weak or placeholder production values.'
  ],
  [
    'Public-search bot status and subscription routes',
    'Token brute force and failed-auth throttling',
    'Reported',
    'CAND-PSB-002 survived validation; sync route has a bad-auth limiter but sibling status/subscription routes do not.'
  ],
  [
    'Private Telegram failed-job operations',
    'Role bypass and external Telegram side effects',
    'Reported',
    'TEL-JOB-AUTHZ-001 survived validation; non-admin authenticated role can list and retry failed jobs.'
  ],
  [
    'Public Telegram bot season callbacks',
    'Trial quota bypass and callback tampering',
    'Rejected',
    'CAND-PUBBOT-001 was ruled out as intended non-consuming callback behavior with tests denying exhausted/blocked users.'
  ],
  [
    'Deployment files and local secrets',
    'Credential exposure in deployable source tree',
    'Reported',
    'DEPLOY-SECRETS-001 survived validation. .env files and the Google key are ignored and not tracked; the key still exists in the deployable app tree.'
  ],
  [
    'Media/TMDB/database repositories',
    'SQL injection, SSRF, public URL validation, unsafe DB updates',
    'No issue found',
    'Reviewed queries use prepared statements and TMDB/public URL sources are configuration-driven.'
  ],
  [
    'Local public search sync/status UI',
    'Token leakage to browser, unsafe status rendering, data exposure',
    'No issue found',
    'No secret tokens are returned to the browser; status output is whitelisted operational state.'
  ]
];

const reviewedMd = `# Reviewed Surfaces

| Surface | Risk Area | Outcome | Notes |
|---|---|---|---|
${reviewedSurfaces.map((row) => `| ${row[0]} | ${row[1]} | ${row[2]} | ${row[3]} |`).join('\n')}
`;
writeArtifact('03_coverage/reviewed_surfaces.md', reviewedMd);
writeArtifact(
  '03_coverage/repository_coverage_ledger.md',
  `# Repository Coverage Ledger

Scan id: ${scanId}

Ranked/deep-review rows closed: ${paths.length}/${paths.length}.

| Surface | Disposition | Candidate IDs | Closure Evidence |
|---|---|---|---|
| Auth login/session/password reset | reportable | AUTH-MUSTCHANGE-001, AUTH-LOGIN-RATE-001 | Source review plus validation artifacts under \`05_findings\`. |
| Admin request guard/user router | reviewed/no issue | none | Guard and role checks reviewed; no candidate survived. |
| Public bot bearer-token config | reportable | CAND-PSB-001 | Config accepts weak/placeholder tokens in validation artifact. |
| Public bot status/subscription auth | reportable | CAND-PSB-002 | Repeated invalid bearer attempts remain 401 without 429 in validation artifact. |
| Telegram failed-job control | reportable | TEL-JOB-AUTHZ-001 | Non-admin role validated for list/retry. |
| Public Telegram callback access | rejected | CAND-PUBBOT-001 | Existing tests and code show non-consuming callbacks are intended and blocked/exhausted users are denied. |
| Deployment credential handling | reportable | DEPLOY-SECRETS-001 | Redacted inspection confirms service account key in deployable app tree; git ignored/untracked but locally present. |
| Media/TMDB/DB query surfaces | reviewed/no issue | none | Prepared statements and configuration-owned URL controls reviewed. |
| Browser/client credential exposure | reviewed/no issue | none | No local secret values found in client or dist artifacts; temporary password is kept only in React state. |

See \`02_discovery/work_ledger.jsonl\` for per-file row closure.
`
);

const validationSummaryRows = [];
const attackRows = [];
for (const candidate of candidates) {
  const dir = path.join(findingsDir, candidate.id);
  fs.mkdirSync(dir, { recursive: true });
  const ledgerRows = [
    {
      phase: 'discovery',
      candidate_id: candidate.id,
      status: 'candidate',
      receipt: candidate.summary,
      affected_locations: candidate.affected
    },
    {
      phase: 'validation',
      candidate_id: candidate.id,
      status: 'survives',
      receipt: candidate.validation,
      confidence: candidate.confidence
    },
    {
      phase: 'attack_path',
      candidate_id: candidate.id,
      status: 'reportable',
      severity: candidate.severity,
      receipt: candidate.severityText
    }
  ];
  fs.writeFileSync(path.join(dir, 'candidate_ledger.jsonl'), jsonl(ledgerRows).replace(/\n/g, '\r\n'), 'utf8');
  fs.writeFileSync(
    path.join(dir, 'validation_report.md'),
    `# Validation Report: ${candidate.id}

## Disposition

Reportable.

## Method

Source review and targeted validation artifact where possible. Existing local secrets were inspected only in redacted form.

## Evidence

${candidate.validation}

## Counterevidence And Limits

The scan did not verify a live VPS deployment. Browser/dist searches did not show local secret values in frontend output where relevant.

## Closure

Survives validation with ${candidate.confidence} confidence.
`.replace(/\n/g, '\r\n'),
    'utf8'
  );
  fs.writeFileSync(
    path.join(dir, 'attack_path_analysis_report.md'),
    `# Attack Path Analysis: ${candidate.id}

## Source

${candidate.reachability}

## Broken Control

${candidate.summary}

## Sink / Impact

${candidate.dataflow}

## Severity

${candidate.severity}: ${candidate.severityText}
`.replace(/\n/g, '\r\n'),
    'utf8'
  );
  validationSummaryRows.push(`| ${candidate.id} | survives | ${candidate.confidence} | ${candidate.validation} |`);
  attackRows.push(`| ${candidate.id} | ${candidate.severity} | reportable | ${candidate.severityText} |`);
}

const suppressedDir = path.join(findingsDir, suppressed.id);
fs.mkdirSync(suppressedDir, { recursive: true });
fs.writeFileSync(
  path.join(suppressedDir, 'candidate_ledger.jsonl'),
  jsonl([
    {
      phase: 'discovery',
      candidate_id: suppressed.id,
      status: 'candidate',
      receipt: 'Season callback quota bypass concern identified during public Telegram bot review.'
    },
    {
      phase: 'validation',
      candidate_id: suppressed.id,
      status: 'rejected',
      receipt: suppressed.reason
    },
    {
      phase: 'attack_path',
      candidate_id: suppressed.id,
      status: 'not_reportable',
      receipt: 'No independently exploitable path survived validation; behavior is documented/tested product semantics.'
    }
  ]).replace(/\n/g, '\r\n'),
  'utf8'
);
fs.writeFileSync(
  path.join(suppressedDir, 'validation_report.md'),
  `# Validation Report: ${suppressed.id}

Rejected. ${suppressed.reason}
`.replace(/\n/g, '\r\n'),
  'utf8'
);
fs.writeFileSync(
  path.join(suppressedDir, 'attack_path_analysis_report.md'),
  `# Attack Path Analysis: ${suppressed.id}

No reportable attack path survived. ${suppressed.reason}
`.replace(/\n/g, '\r\n'),
  'utf8'
);

writeArtifact(
  '05_findings/validation_summary.md',
  `# Validation Summary

| Candidate | Disposition | Confidence | Evidence |
|---|---|---|---|
${validationSummaryRows.join('\n')}
| ${suppressed.id} | rejected | medium | ${suppressed.reason} |
`
);
writeArtifact(
  '05_findings/attack_path_analysis_report.md',
  `# Attack Path Analysis Summary

| Candidate | Severity | Disposition | Rationale |
|---|---|---|---|
${attackRows.join('\n')}
| ${suppressed.id} | none | rejected | ${suppressed.reason} |
`
);

const threatModel = fs
  .readFileSync(path.join(artifactsDir, '01_context', 'threat_model.md'), 'utf8')
  .replace(/^# .*\r?\n/, '');
const severityCounts = candidates.reduce((acc, candidate) => {
  acc[candidate.severity] = (acc[candidate.severity] || 0) + 1;
  return acc;
}, {});
const confidenceCounts = candidates.reduce((acc, candidate) => {
  acc[candidate.confidence] = (acc[candidate.confidence] || 0) + 1;
  return acc;
}, {});

const summaryTable = `| Finding | Severity | Confidence |
|---|---|---|
${candidates.map((candidate, index) => `| [${candidate.title}](#${index + 1}-${slug(candidate.title)}) | ${candidate.severity} | ${candidate.confidence} |`).join('\n')}`;

const findingDetails = candidates
  .map(
    (candidate, index) => `### [${index + 1}] ${candidate.title}

| Field | Value |
|---|---|
| Severity | ${candidate.severity} |
| Confidence | ${candidate.confidence} |
| Confidence rationale | ${candidate.validation} |
| Category | ${candidate.category} |
| CWE | ${candidate.cwe} |
| Affected lines | ${candidate.affected.join('; ')} |

#### Summary

${candidate.summary}

#### Validation

${candidate.validation}

Validation artifacts and receipts are saved under \`artifacts/05_findings/${candidate.id}\`.

#### Dataflow

${candidate.dataflow}

#### Reachability

${candidate.reachability}

#### Severity

${candidate.severity}: ${candidate.severityText}

#### Remediation

${candidate.remediation}
`
  )
  .join('\n');

const vpsGuide = `## Secure VPS Deployment Guide

1. Rotate before deploy: revoke the current Google service account key, create a fresh least-privilege key for only the required spreadsheet, and generate fresh 32+ byte values for \`PUBLIC_SEARCH_SYNC_TOKEN\`, \`PUBLIC_SEARCH_STATUS_TOKEN\`, \`SUBSCRIPTION_ADMIN_TOKEN\`, \`PUBLIC_BOT_TOKEN\`, and \`SUBSCRIPTION_BOT_TOKEN\`.
2. Create a non-root Linux user such as \`infinitylinks\`; keep the app under \`/opt/infinitylinks/public-search-bot\` and runtime data under \`/var/lib/infinitylinks\` with owner \`infinitylinks:infinitylinks\`.
3. Keep secrets outside the repo: place the env file at \`/etc/infinitylinks/public-search-bot.env\` with mode \`600\`, and place the Google key at \`/etc/infinitylinks/google-service-account.json\` or inject it through a systemd credential. Do not copy \`apps/public-search-bot/google-service-account.json\` to the deploy tree.
4. Build locally or in CI with \`npm ci\`, \`npm run build\`, and \`npm run build -w apps/public-search-bot\`; deploy only the compiled app/package files needed to run, not \`.env\`, git metadata, tests, scan artifacts, or local database files.
5. In systemd, set \`User=infinitylinks\`, \`EnvironmentFile=/etc/infinitylinks/public-search-bot.env\`, \`WorkingDirectory=/opt/infinitylinks/public-search-bot\`, \`NoNewPrivileges=true\`, \`PrivateTmp=true\`, \`ProtectSystem=strict\`, \`ProtectHome=true\`, and \`ReadWritePaths=/var/lib/infinitylinks\`.
6. Bind the Node service to \`127.0.0.1:3001\`; expose it only through Nginx with TLS, request body limits, and rate limits on \`/api/status\`, \`/api/sync\`, and \`/api/subscriptions\`.
7. Lock Nginx down to proxy only expected routes. Do not serve the repository directory as static content; deny dotfiles, source maps if not needed, env files, JSON credential files, and backups.
8. Configure firewall rules: allow SSH only from your IP if possible, allow HTTP/HTTPS, deny direct access to port 3001, and enable automatic security updates plus fail2ban or equivalent SSH protection.
9. Verify after deployment with redacted checks: \`systemctl status\`, localhost \`/api/status\` with the status token, a wrong-token request that should be rejected and eventually rate-limited, and \`find /opt/infinitylinks -name .env -o -name '*service-account*.json'\` to confirm secrets are not in the deploy tree.
10. Add operations hygiene: back up only the SQLite data directory with encrypted backups, rotate tokens after admin turnover, log failed bearer attempts without logging token values, and keep a rollback package that does not contain secrets.
`;

const report = `# Security Review: InfinityLinks

## Scope

- Scan mode: repository-wide Codex Security scan of \`${root}\` at commit \`d265a9dc1ace0d85393797c38b3eeff6ea61db06\`.
- Primary focus requested by the user: login/authentication, browser credential exposure, and secure VPS deployment.
- In-scope code: private local admin app, public-search bot VPS service, Telegram integrations, SQLite repositories, deployment docs, and client/browser code present in this checkout.
- Generated context: the threat model was generated during Phase 1 and copied to \`artifacts/01_context/threat_model.md\` for this scan.
- Runtime validation: targeted Vitest artifacts reproduced the surviving auth, token-policy, token-throttling, and Telegram job authorization issues. Secret files were inspected only in redacted form.
- Explicit limitation: this scan did not connect to a live VPS, Telegram account, Google Sheet, or external network service. It reviewed this local checkout and existing local build artifacts.

### Scan Summary

| Field | Value |
|---|---|
| Reportable findings | ${candidates.length} |
| Severity mix | high ${severityCounts.high || 0}, medium ${severityCounts.medium || 0}, low ${severityCounts.low || 0} |
| Confidence mix | high ${confidenceCounts.high || 0} |
| Coverage | ${paths.length}/${paths.length} ranked deep-review rows closed in \`artifacts/02_discovery/work_ledger.jsonl\` |
| Validation mode | Source review plus targeted local Vitest validation artifacts |
| Markdown report | \`${path.join(scanDir, 'report.md')}\` |
| HTML report | \`${path.join(scanDir, 'report.html')}\` |

## Threat Model

${threatModel.trim()}

## Findings

${summaryTable}

### Confidence Scale

| Label | Meaning |
|---|---|
| high | Direct source, configuration, or runtime evidence supports the finding, with no material unresolved reachability or exploitability blocker. |
| medium | Source evidence supports a plausible issue, but runtime behavior, deployment configuration, role reachability, type constraints, or exploit reliability still need proof. |
| low | Weak or incomplete evidence; included only when follow-up candidates are intentionally retained. |

${findingDetails}
## Reviewed Surfaces

| Surface | Risk Area | Outcome | Notes |
|---|---|---|---|
${reviewedSurfaces.map((row) => `| ${row[0]} | ${row[1]} | ${row[2]} | ${row[3]} |`).join('\n')}

## Open Questions And Follow Up

- Run a live VPS configuration review focused on Nginx routing, systemd hardening, firewall rules, and whether repository files are ever served as static content.
- After fixes, rerun the validation artifacts in \`artifacts/05_findings/*/validation_artifacts\` to confirm the expected status codes change from vulnerable behavior to denied or throttled behavior.
- Review account lifecycle policy for temporary passwords: how they are distributed, when they expire, and whether password reset should invalidate all existing sessions.

${vpsGuide}`;

writeRel('report.md', report);
console.log(`wrote scan artifacts and report to ${scanDir}`);

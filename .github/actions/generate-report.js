/**
 * Reads axe-results.json, pa11y-results.json, and lighthouse-reports/*.json
 * Merges + deduplicates findings and writes a11y-report/report.md
 */

const fs   = require('fs');
const path = require('path');

// Lods raw outputs

function safeRead(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
}

const axeRaw   = safeRead('axe-results.json')  || [];
const pa11yRaw = safeRead('pa11y-results.json') || [];
const lhDir    = 'lighthouse-reports';

const allUrls = new Set([
  ...axeRaw.map(r => r.url),
  ...pa11yRaw.map(r => r.pageUrl),
]);

// Normalize and deduplicate findinds

function normalizeHtml(html) {
  return (html || '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

const findings = new Map();

function upsert(ruleId, description, impact, helpUrl, source, html, target) {
  const key = `${ruleId}::${normalizeHtml(html)}`;
  if (!findings.has(key)) {
    findings.set(key, { ruleId, description, impact, helpUrl, sources: new Set(), nodes: [] });
  }
  const f = findings.get(key);
  f.sources.add(source);
  if (!f.nodes.some(n => normalizeHtml(n.html) === normalizeHtml(html))) {
    f.nodes.push({ html: html || '', target: target || '' });
  }
}

for (const result of axeRaw) {
  for (const v of (result.violations || [])) {
    for (const node of (v.nodes || [])) {
      upsert(v.id, v.help || v.description || '', v.impact || 'unknown',
        v.helpUrl || '', 'axe', node.html,
        Array.isArray(node.target) ? node.target.join(', ') : (node.target || ''));
    }
  }
}

for (const result of pa11yRaw) {
  for (const issue of (result.issues || [])) {
    upsert(issue.code, issue.message || '',
      issue.type === 'error' ? 'serious' : 'minor',
      'https://www.w3.org/TR/WCAG21/', 'pa11y',
      issue.context || '', issue.selector || '');
  }
}

const impactOrder = { critical: 0, serious: 1, moderate: 2, minor: 3, warning: 4, unknown: 5 };
const allFindings = [...findings.values()]
  .sort((a, b) => (impactOrder[a.impact] ?? 5) - (impactOrder[b.impact] ?? 5));

// Handle LightHouse Score

const lhScores = {};
if (fs.existsSync(lhDir)) {
  for (const file of fs.readdirSync(lhDir)) {
    if (!file.endsWith('.json')) continue;
    const lh = safeRead(path.join(lhDir, file));
    if (!lh) continue;
    const url = lh.finalUrl || lh.requestedUrl || file.replace('.json', '');
    lhScores[url] = Math.round((lh.categories?.accessibility?.score ?? 0) * 100);
  }
}

const scoreValues    = Object.values(lhScores);
const aggregateScore = scoreValues.length
  ? Math.round(scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length)
  : null;

// Markdown related configs

const IMPACT_EMOJI = {
  critical: '🔴', serious: '🟠', moderate: '🟡',
  minor: '🟢', warning: '⚪', unknown: '⚫',
};

function scoreLine(score) {
  if (score === null) return 'N/A';
  if (score >= 90) return `${score}/100 🟢 Pass`;
  if (score >= 50) return `${score}/100 🟡 Needs Improvement`;
  return                 `${score}/100 🔴 Critical Fail`;
}

function fence(code) {
  return '```\n' + String(code).replace(/`{3}/g, '\\`\\`\\`') + '\n```';
}

const countByImpact = {};
for (const f of allFindings) countByImpact[f.impact] = (countByImpact[f.impact] || 0) + 1;
const totalErrors   = (countByImpact.critical || 0) + (countByImpact.serious || 0);
const totalWarnings = (countByImpact.moderate || 0) + (countByImpact.minor || 0) + (countByImpact.warning || 0);

// Build the final markdown

const lines = [];

lines.push(
  `# A11y Compliance Report`,
  ``,
  `> **Generated:** ${new Date().toUTCString()}  `,
  `> **URLs audited:** ${allUrls.size}  `,
  `> **Tools:** Axe-core · Pa11y · Lighthouse`,
  ``,
  `---`,
  ``,
);

// Score section
lines.push(`## Lighthouse Score`);
if (aggregateScore !== null) {
  lines.push(``, `**Overall (average across all URLs):** ${scoreLine(aggregateScore)}`, ``);
} else {
  lines.push(``, `_No Lighthouse data found._`, ``);
}

if (Object.keys(lhScores).length > 0) {
  lines.push(`| URL | Score |`, `|-----|-------|`);
  for (const [url, score] of Object.entries(lhScores)) {
    lines.push(`| ${url} | ${scoreLine(score)} |`);
  }
  lines.push(``);
}

lines.push(
  `> [How is the Lighthouse accessibility score calculated?](https://developer.chrome.com/docs/lighthouse/accessibility/scoring)`,
  ``,
  `---`,
  ``,
);

// Summary section
lines.push(
  `## Summary`,
  ``,
  `| Metric | Count |`,
  `|--------|-------|`,
  `| 🔴 Errors (critical + serious) | **${totalErrors}** |`,
  `| 🟡 Warnings (moderate + minor) | **${totalWarnings}** |`,
  `| 🔵 Unique violations (deduplicated) | **${allFindings.length}** |`,
  ``,
  `---`,
  ``,
);

// Findings section
lines.push(`## Findings`);

if (allFindings.length === 0) {
  lines.push(``, `✅ **No violations found across all tools.**`, ``);
} else {
  lines.push(``, `_Sorted by impact severity. Each entry is deduplicated across Axe and Pa11y._`, ``);

  for (const f of allFindings) {
    const icon    = IMPACT_EMOJI[f.impact] || '⚫';
    const sources = [...f.sources].join(', ');

    lines.push(
      ``,
      `### ${icon} \`${f.ruleId}\``,
      ``,
      `| Field | Value |`,
      `|-------|-------|`,
      `| **Impact** | ${f.impact} |`,
      `| **Source(s)** | ${sources} |`,
      `| **Description** | ${f.description} |`,
    );
    if (f.helpUrl) lines.push(`| **Reference** | [More info](${f.helpUrl}) |`);

    lines.push(``, `**Affected elements** (${f.nodes.length}):`);

    for (const [i, node] of f.nodes.entries()) {
      lines.push(``);
      if (node.target) lines.push(`_Target ${i + 1}:_ \`${node.target}\``);
      if (node.html)   lines.push(fence(node.html));
    }
  }
}

lines.push(
  ``,
  `---`,
  ``,
  `*Report generated by Axe-core, Pa11y, and Lighthouse via GitHub Actions.*  `,
  `*[Lighthouse Scoring Documentation](https://developer.chrome.com/docs/lighthouse/accessibility/scoring)*`,
);

// ─── 6. Write output ─────────────────────────────────────────────────────────

fs.mkdirSync('a11y-report', { recursive: true });
fs.writeFileSync('a11y-report/report.md', lines.join('\n'), 'utf8');
console.log(`✅ Report written → a11y-report/report.md`);
console.log(`   Unique violations : ${allFindings.length}`);
console.log(`   Errors            : ${totalErrors}`);
console.log(`   Warnings          : ${totalWarnings}`);
if (aggregateScore !== null) console.log(`   Lighthouse Score  : ${scoreLine(aggregateScore)}`);

/**
 * Reads outputs from three a11y tools and writes a single merged Markdown report.
 *
 * Inputs (produced by the workflow steps before this one):
 *   axe-results.json      > [{ url, violations[], passes[] }]
 *   pa11y-results.json    > [{ pageUrl, issues[] }]
 *   lighthouse-reports/   > one .json per URL
 *
 * Output:
 *   a11y-report/report.md
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const AXE_FILE   = 'axe-results.json';
const PA11Y_FILE = 'pa11y-results.json';
const LH_DIR     = 'lighthouse-reports';
const OUT_FILE   = 'a11y-report/report.md';

const IMPACT_ORDER = { critical: 0, serious: 1, moderate: 2, minor: 3, warning: 4, unknown: 5 };

const IMPACT_EMOJI = {
  critical: '🔴',
  serious:  '🟠',
  moderate: '🟡',
  minor:    '🟢',
  warning:  '⚪',
  unknown:  '⚫',
};


function safeRead(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function normalizeHtml(html) {
  return (html || '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

function mdEscape(str) {
  return String(str || '')
    .replace(/</g, '\\<')
    .replace(/>/g, '\\>')
    .replace(/\|/g, '\\|');
}

function fence(code) {
  return '```\n' + String(code).replace(/`{3}/g, '\\`\\`\\`') + '\n```';
}

function scoreLine(score) {
  if (score === null)  return 'N/A';
  if (score >= 90)     return `${score}/100 🟢 Pass`;
  if (score >= 50)     return `${score}/100 🟡 Needs Improvement`;
  return                      `${score}/100 🔴 Critical Fail`;
}

const axeRaw   = safeRead(AXE_FILE)   || [];
const pa11yRaw = safeRead(PA11Y_FILE) || [];

const allUrls = new Set([
  ...axeRaw.map(r => r.url),
  ...pa11yRaw.map(r => r.pageUrl),
]);

const findings = new Map();

function upsert(ruleId, description, impact, helpUrl, source, html, target, url) {
  if (!findings.has(ruleId)) {
    findings.set(ruleId, {
      ruleId,
      description,
      impact,
      helpUrl,
      sources: new Set(),
      nodes:   [],
    });
  }

  const finding = findings.get(ruleId);
  finding.sources.add(source);

  const isDuplicate = finding.nodes.some(
    n => normalizeHtml(n.html) === normalizeHtml(html)
  );
  if (!isDuplicate) {
    finding.nodes.push({ html: html || '', target: target || '', url: url || '' });
  }
}

for (const result of axeRaw) {
  for (const violation of (result.violations || [])) {
    for (const node of (violation.nodes || [])) {
      upsert(
        violation.id,
        violation.help || violation.description || '',
        violation.impact || 'unknown',
        violation.helpUrl || '',
        'axe',
        node.html,
        Array.isArray(node.target) ? node.target.join(', ') : (node.target || ''),
        result.url,
      );
    }
  }
}

for (const result of pa11yRaw) {
  for (const issue of (result.issues || [])) {
    upsert(
      issue.code,
      issue.message || '',
      issue.type === 'error' ? 'serious' : 'minor',
      'https://www.w3.org/TR/WCAG21/',
      'pa11y',
      issue.context  || '',
      issue.selector || '',
      result.pageUrl,
    );
  }
}

const allFindings = [...findings.values()]
  .sort((a, b) => (IMPACT_ORDER[a.impact] ?? 5) - (IMPACT_ORDER[b.impact] ?? 5));

const lhScores = {};

if (fs.existsSync(LH_DIR)) {
  for (const file of fs.readdirSync(LH_DIR)) {
    if (!file.endsWith('.json')) continue;
    const lh = safeRead(path.join(LH_DIR, file));
    if (!lh) continue;
    const url = lh.finalUrl || lh.requestedUrl || file.replace('.json', '');
    lhScores[url] = Math.round((lh.categories?.accessibility?.score ?? 0) * 100);
  }
}

const scoreValues    = Object.values(lhScores);
const aggregateScore = scoreValues.length
  ? Math.round(scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length)
  : null;

const countByImpact = {};
for (const f of allFindings) {
  countByImpact[f.impact] = (countByImpact[f.impact] || 0) + 1;
}

const totalErrors   = (countByImpact.critical || 0) + (countByImpact.serious || 0);
const totalWarnings = (countByImpact.moderate || 0) + (countByImpact.minor   || 0)
                    + (countByImpact.warning  || 0);

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

lines.push(`## Lighthouse Score`);
lines.push(
  ``,
  aggregateScore !== null ? `**Overall (average):** ${scoreLine(aggregateScore)}` : `_No Lighthouse data found._`,
  ``,
);

if (Object.keys(lhScores).length) {
  lines.push(`| URL | Score |`, `|-----|-------|`);
  for (const [url, score] of Object.entries(lhScores)) {
    lines.push(`| ${url} | ${scoreLine(score)} |`);
  }
  lines.push(``);
}

lines.push(
  `> [Lighthouse Scoring Documentation](https://developer.chrome.com/docs/lighthouse/accessibility/scoring)`,
  ``,
  `---`,
  ``,
);

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

lines.push(`## Findings`);

if (allFindings.length === 0) {
  lines.push(``, `✅ **No violations found across all tools.**`, ``);
} else {
  lines.push(``, `_Sorted by impact severity. Deduplicated across Axe and Pa11y._`, ``);

  for (const finding of allFindings) {
    const emoji   = IMPACT_EMOJI[finding.impact] || '⚫';
    const sources = [...finding.sources].join(', ');

    lines.push(
      ``,
      `### ${emoji} \`${finding.ruleId}\``,
      ``,
      `| Field | Value |`,
      `|-------|-------|`,
      `| **Impact** | ${finding.impact} |`,
      `| **Source(s)** | ${sources} |`,
      `| **Description** | ${mdEscape(finding.description)} |`,
    );

    if (finding.helpUrl) {
      lines.push(`| **Reference** | [More info](${finding.helpUrl}) |`);
    }

    lines.push(``, `**Affected elements** (${finding.nodes.length}):`);

    for (const [i, node] of finding.nodes.entries()) {
      lines.push(``);
      if (node.url)    lines.push(`_URL:_ ${node.url}\n`);
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
);

fs.mkdirSync('a11y-report', { recursive: true });
fs.writeFileSync(OUT_FILE, lines.join('\n'), 'utf8');

console.log(`✅ Report written → ${OUT_FILE}`);
console.log(`   Unique violations : ${allFindings.length}`);
console.log(`   Errors            : ${totalErrors}`);
console.log(`   Warnings          : ${totalWarnings}`);
if (aggregateScore !== null) {
  console.log(`   Lighthouse Score  : ${scoreLine(aggregateScore)}`);
}

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  REQUIRED_RELEASE_EVIDENCE,
  buildConstitutionalReleaseCandidate
} from '../src/matchEngine/releaseCandidate.js';

const outputDirectory = new URL('../calibration/generated/', import.meta.url);

async function readJson(filename) {
  try {
    return JSON.parse(await readFile(new URL(filename, outputDirectory), 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

const evidence = {};
for (const requirement of REQUIRED_RELEASE_EVIDENCE) {
  evidence[requirement.key] = await readJson(requirement.filename);
}

const report = buildConstitutionalReleaseCandidate({
  evidence,
  commitSha: process.env.GITHUB_SHA || process.env.COMMIT_REF || 'local'
});

function markdown(result) {
  const lines = [
    '# Constitutional Engine Release Candidate',
    '',
    `- Version: \`${result.version}\``,
    `- Candidate: \`${result.candidate}\``,
    `- Commit: \`${result.commit_sha}\``,
    `- Default engine mode: \`${result.engine_mode}\``,
    `- Rollback mode: \`${result.fallback_mode}\``,
    `- Accepted: **${result.accepted ? 'PASS' : 'FAIL'}**`,
    '',
    '## Release evidence',
    '',
    '| Evidence | Version | Present | Accepted |',
    '|---|---|---:|---:|'
  ];
  for (const artifact of result.artifacts) {
    lines.push(`| ${artifact.description} | ${artifact.version || 'missing'} | ${artifact.present ? 'yes' : 'no'} | ${artifact.accepted ? 'yes' : 'no'} |`);
  }
  lines.push('', '## Acceptance checks', '');
  for (const [check, passed] of Object.entries(result.checks)) lines.push(`- ${passed ? '✅' : '❌'} ${check}`);
  lines.push(
    '',
    '## Rollback',
    '',
    result.rollback.activation,
    '',
    `Scope: ${result.rollback.scope}`,
    '',
    '## Monitoring',
    ''
  );
  for (const metric of result.monitoring.metrics) lines.push(`- \`${metric}\``);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

await mkdir(outputDirectory, { recursive: true });
await writeFile(new URL('constitutional-release-candidate.json', outputDirectory), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(new URL('constitutional-release-candidate.md', outputDirectory), markdown(report));

console.log(JSON.stringify({
  accepted: report.accepted,
  candidate: report.candidate,
  engine_mode: report.engine_mode,
  fallback_mode: report.fallback_mode,
  outputs: [
    'calibration/generated/constitutional-release-candidate.json',
    'calibration/generated/constitutional-release-candidate.md'
  ]
}, null, 2));

if (!report.accepted) process.exitCode = 1;

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { GradleParseOutput } from './gradleParser';

function generateUnifiedDiff(oldText: string, newText: string, fileRelPath: string): string {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  // Simple whole-file diff hunk
  const oldCount = oldLines.length;
  const newCount = newLines.length;
  const header = `--- a/${fileRelPath}\n+++ b/${fileRelPath}\n`;
  const hunkHeader = `@@ -1,${oldCount} +1,${newCount} @@\n`;
  const body = [hunkHeader];
  const max = Math.max(oldCount, newCount);
  for (let i = 0; i < max; i++) {
    const o = i < oldCount ? oldLines[i] : null;
    const n = i < newCount ? newLines[i] : null;
    if (o === n) {
      body.push(` ${o ?? ''}`);
    } else {
      if (o !== null) body.push(`-${o}`);
      if (n !== null) body.push(`+${n}`);
    }
  }
  return header + body.join('\n') + '\n';
}

function replaceNexusWithArtifactory(content: string, artifactoryUrl: string): { updated: string; changes: number } {
  let changes = 0;
  let updated = content.replace(/(url\s+['\"])https?:\/\/[^'\"]*(nexus|sonatype)[^'\"]*(['\"])/gi, (_m, p1, _mid, p3) => {
    changes++;
    return `${p1}${artifactoryUrl}${p3}`;
  });
  // Also replace legacy 'nexusUrl' variables
  updated = updated.replace(/(nexusUrl\s*=\s*['\"]).*?(['\"])/gi, (_m, p1, p2) => {
    changes++;
    return `${p1}${artifactoryUrl}${p2}`;
  });
  return { updated, changes };
}

export class TransformationPlanner {
  constructor(private channel: vscode.OutputChannel, private metaDir: string) {}

  async generatePatches(parse: GradleParseOutput, projectRoot: string): Promise<{ patchText: string; filesChanged: string[]; riskSummary: string }>{
    const artifactoryUrl = 'https://artifactory.example.com/artifactory/libs-release';
    const diffs: string[] = [];
    const filesChanged: string[] = [];
    let highRisk = 0, mediumRisk = 0, lowRisk = 0;

    const visited = new Set<string>();
    for (const mod of parse.modules) {
      for (const fileRel of mod.files) {
        const filePath = path.join(projectRoot, fileRel);
        if (visited.has(fileRel) || !fs.existsSync(filePath)) continue;
        visited.add(fileRel);
        const original = fs.readFileSync(filePath, 'utf-8');
        const { updated, changes } = replaceNexusWithArtifactory(original, artifactoryUrl);

        if (changes > 0) {
          const diff = generateUnifiedDiff(original, updated, fileRel.replace(/\\/g, '/'));
          diffs.push(diff);
          filesChanged.push(fileRel);
          // Risk classification: publishing blocks are medium, repository URLs low, unknown patterns high
          if (/publishing\s*\{[\s\S]*?\}/.test(original)) mediumRisk++; else lowRisk++;
        }
        // If module has nexusReferences but we didn't detect URL changes, flag high risk
        if (mod.nexusReferences && changes === 0) {
          highRisk++;
        }
      }
    }

    const riskSummary = `low:${lowRisk}, medium:${mediumRisk}, high:${highRisk}`;
    const patchText = diffs.join('\n');

    // Save planner meta
    const meta = { filesChanged, riskSummary, artifactoryUrl };
    fs.writeFileSync(path.join(this.metaDir, 'planner.json'), JSON.stringify(meta, null, 2));
    this.channel.appendLine(`[transformationPlanner] Generated diffs for ${filesChanged.length} files. Risk: ${riskSummary}`);

    return { patchText, filesChanged, riskSummary };
  }
}
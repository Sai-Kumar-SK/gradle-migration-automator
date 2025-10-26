import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { GradleParseOutput } from './gradleParser';

function generateUnifiedDiff(oldText: string, newText: string, fileRelPath: string): string {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
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
  updated = updated.replace(/(nexusUrl\s*=\s*['\"]).*?(['\"])/gi, (_m, p1, p2) => {
    changes++;
    return `${p1}${artifactoryUrl}${p2}`;
  });
  return { updated, changes };
}

const SETTINGS_GROOVY_BLOCK = `pluginManagement {
    repositories {
        maven {
          url 'https://artifactory.org.com/artifactory/plugins-release'
          credentials {
            username = '\${System.properties.getProperty("gradle.wrapperUser")}'
            password = '\${System.properties.getProperty("gradle.wrapperUser")}'
          }
          authentication {
            basic(BasicAuthentication)
          }
        }
        maven {
          url 'https://artifactory.org.com/artifactory/libs-release'
          credentials {
            username = '\${System.properties.getProperty("gradle.wrapperUser")}'
            password = '\${System.properties.getProperty("gradle.wrapperUser")}'
          }
          authentication {
            basic(BasicAuthentication)
          }
        }
    }
}

dependencyResolutionManagement {
    repositories {
        maven {
          url 'https://artifactory.org.com/artifactory/plugins-release'
          credentials {
            username = '\${System.properties.getProperty("gradle.wrapperUser")}'
            password = '\${System.properties.getProperty("gradle.wrapperUser")}'
          }
          authentication {
            basic(BasicAuthentication)
          }
        }
        maven {
          url 'https://artifactory.org.com/artifactory/libs-release'
          credentials {
            username = '\${System.properties.getProperty("gradle.wrapperUser")}'
            password = '\${System.properties.getProperty("gradle.wrapperUser")}'
          }
          authentication {
            basic(BasicAuthentication)
          }
        }
    }
}`;

export class TransformationPlanner {
  constructor(private channel: vscode.OutputChannel, private metaDir: string) {}

  async generatePatches(parse: GradleParseOutput, projectRoot: string): Promise<{ patchText: string; filesChanged: string[]; riskSummary: string }>{
    const artifactoryUrl = 'https://artifactory.org.com/artifactory/libs-release';
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
          if (/publishing\s*\{[\s\S]*?\}/.test(original)) mediumRisk++; else lowRisk++;
        }
        if (mod.nexusReferences && changes === 0) {
          highRisk++;
        }
      }
    }

    // Inject settings.gradle block at line 1 if present and not already injected
    const settingsGradlePath = path.join(projectRoot, 'settings.gradle');
    if (fs.existsSync(settingsGradlePath)) {
      const original = fs.readFileSync(settingsGradlePath, 'utf-8');
      const alreadyHas = /artifactory\.org\.com\/artifactory\/(libs-release|plugins-release)/.test(original) || /pluginManagement\s*\{/.test(original);
      if (!alreadyHas) {
        const updated = `${SETTINGS_GROOVY_BLOCK}\n\n${original}`;
        const diff = generateUnifiedDiff(original, updated, 'settings.gradle');
        diffs.push(diff);
        filesChanged.push('settings.gradle');
        mediumRisk++;
      }
    } else {
      // If only Kotlin DSL settings file exists, flag higher risk as manual conversion may be needed
      const settingsKtsPath = path.join(projectRoot, 'settings.gradle.kts');
      if (fs.existsSync(settingsKtsPath)) {
        highRisk++;
      }
    }

    // If wrapper distributionUrl is detected and points to services.gradle.org, note risk for future change
    if (parse.wrapper?.distributionUrl && /services\.gradle\.org/.test(parse.wrapper.distributionUrl)) {
      // We do not change distributionUrl without an explicit target; flag medium risk for follow-up
      mediumRisk++;
    }

    const riskSummary = `low:${lowRisk}, medium:${mediumRisk}, high:${highRisk}`;
    const patchText = diffs.join('\n');

    const meta = { filesChanged, riskSummary, artifactoryUrl };
    fs.writeFileSync(path.join(this.metaDir, 'planner.json'), JSON.stringify(meta, null, 2));
    this.channel.appendLine(`[transformationPlanner] Generated diffs for ${filesChanged.length} files. Risk: ${riskSummary}`);

    return { patchText, filesChanged, riskSummary };
  }
}
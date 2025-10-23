import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export type ModuleMetadata = {
  path: string;
  dsl: 'groovy' | 'kotlin' | 'unknown';
  plugins: string[];
  repositories: string[];
  publishing: Record<string, unknown> | null;
  nexusReferences: boolean;
  files: string[];
};

export type GradleParseOutput = { modules: ModuleMetadata[] };

function findGradleFiles(root: string): string[] {
  const files: string[] = [];
  const stack: string[] = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (/^(build|settings)\.gradle(\.kts)?$/.test(e.name)) files.push(full);
    }
  }
  return files;
}

function detectDsl(file: string): 'groovy' | 'kotlin' | 'unknown' {
  return file.endsWith('.kts') ? 'kotlin' : file.endsWith('.gradle') ? 'groovy' : 'unknown';
}

function extractPlugins(content: string): string[] {
  const plugins: string[] = [];
  // plugins { id "foo" version "x" }
  const idRegex = /id\s+['\"]([\w.:-]+)['\"]/g;
  let m: RegExpExecArray | null;
  while ((m = idRegex.exec(content))) {
    plugins.push(m[1]);
  }
  // apply plugin: 'java'
  const applyRegex = /apply\s+plugin:\s*['\"]([\w.-]+)['\"]/g;
  while ((m = applyRegex.exec(content))) {
    plugins.push(m[1]);
  }
  return Array.from(new Set(plugins));
}

function extractRepositories(content: string): string[] {
  const repos: string[] = [];
  const repoBlockRegex = /(repositories\s*\{[\s\S]*?\})/g;
  let block: RegExpExecArray | null;
  while ((block = repoBlockRegex.exec(content))) {
    const b = block[1];
    const urlRegex = /url\s+['\"]([^'\"]+)['\"]/g;
    let u: RegExpExecArray | null;
    while ((u = urlRegex.exec(b))) repos.push(u[1]);
    if (/mavenCentral\s*\(\s*\)/.test(b)) repos.push('mavenCentral');
    if (/google\s*\(\s*\)/.test(b)) repos.push('google');
    const mavenRegex = /maven\s*\{[\s\S]*?\}/g;
    if (mavenRegex.test(b) && repos.length === 0) repos.push('maven');
  }
  return Array.from(new Set(repos));
}

function extractPublishing(content: string): Record<string, unknown> | null {
  const pubBlockRegex = /(publishing\s*\{[\s\S]*?\})/g;
  const match = pubBlockRegex.exec(content);
  if (!match) return null;
  const block = match[1];
  const repoUrls: string[] = [];
  const urlRegex = /url\s+['\"]([^'\"]+)['\"]/g;
  let u: RegExpExecArray | null;
  while ((u = urlRegex.exec(block))) repoUrls.push(u[1]);
  return { repoUrls };
}

function detectNexus(content: string): boolean {
  return /(nexus|sonatype|Nexus)/i.test(content);
}

export class GradleParser {
  constructor(private channel: vscode.OutputChannel, private metaDir: string) {}

  async parseProject(projectRoot: string): Promise<GradleParseOutput> {
    const files = findGradleFiles(projectRoot);
    const modules: ModuleMetadata[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      modules.push({
        path: path.relative(projectRoot, path.dirname(file)) || '.',
        dsl: detectDsl(file),
        plugins: extractPlugins(content),
        repositories: extractRepositories(content),
        publishing: extractPublishing(content),
        nexusReferences: detectNexus(content),
        files: [path.relative(projectRoot, file)]
      });
    }

    const output = { modules };
    fs.writeFileSync(path.join(this.metaDir, 'gradleParser.json'), JSON.stringify(output, null, 2));
    this.channel.appendLine(`[gradleParser] Parsed ${files.length} Gradle files.`);
    return output;
  }
}
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export type GradleFileInfo = {
  path: string;
  dsl: 'groovy';
  plugins: string[];
  repositories: string[];
  publishingBlocks: boolean;
};

export type WrapperInfo = {
  distributionUrl?: string;
  propertiesPath?: string;
};

export type GradleParseOutput = {
  modules: Array<{
    dir: string;
    files: string[];
    nexusReferences?: boolean;
  }>;
  gradleProperties?: Record<string, string>;
  wrapper?: WrapperInfo;
};

function readFileSafe(file: string): string | null {
  try { return fs.readFileSync(file, 'utf-8'); } catch { return null; }
}

function detectDSL(filePath: string): 'groovy' {
  return 'groovy';
}

function extractPlugins(content: string): string[] {
  const plugins: string[] = [];
  const pluginBlock = content.match(/plugins\s*\{([\s\S]*?)\}/);
  if (pluginBlock) {
    const ids = pluginBlock[1].match(/id\s+['\"]([\w\-.]+)['\"]/g) || [];
    for (const id of ids) {
      const m = id.match(/id\s+['\"]([\w\-.]+)['\"]/);
      if (m) plugins.push(m[1]);
    }
  }
  return plugins;
}

function extractRepositories(content: string): string[] {
  const repos: string[] = [];
  const blocks = content.match(/repositories\s*\{([\s\S]*?)\}/g) || [];
  for (const b of blocks) {
    const urls = b.match(/url\s+['\"]([^'\"]+)['\"]/g) || [];
    for (const u of urls) {
      const m = u.match(/url\s+['\"]([^'\"]+)['\"]/);
      if (m) repos.push(m[1]);
    }
  }
  return repos;
}

function hasPublishing(content: string): boolean {
  return /publishing\s*\{[\s\S]*?\}/.test(content);
}

function detectNexus(content: string): boolean {
  return /(nexus|sonatype)/i.test(content);
}

function parseProperties(filePath: string): Record<string, string> | undefined {
  const text = readFileSafe(filePath);
  if (!text) return undefined;
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([^#=]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1].trim()] = m[2].trim();
  }
  return out;
}

export async function findGradleFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const stack: string[] = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (/build\.gradle(\.kts)?$/.test(e.name)) {
        files.push(full);
      }
    }
  }
  return files;
}

export async function parseGradleProject(root: string): Promise<GradleParseOutput> {
  const buildFiles = await findGradleFiles(root);
  const modules: GradleParseOutput['modules'] = [];
  const seenModuleDirs = new Set<string>();

  for (const file of buildFiles) {
    const content = readFileSafe(file) || '';
    const info: GradleFileInfo = {
      path: path.relative(root, file),
      dsl: detectDSL(file),
      plugins: extractPlugins(content),
      repositories: extractRepositories(content),
      publishingBlocks: hasPublishing(content),
    };
    const dir = path.dirname(file);
    if (!seenModuleDirs.has(dir)) {
      seenModuleDirs.add(dir);
      modules.push({ dir: path.relative(root, dir), files: [info.path], nexusReferences: detectNexus(content) });
    } else {
      const m = modules.find(m => path.join(root, m.dir) === dir);
      if (m) {
        m.files.push(info.path);
        if (!m.nexusReferences) m.nexusReferences = detectNexus(content);
      }
    }
  }

  const gradlePropsPath = path.join(root, 'gradle.properties');
  const gradleProps = parseProperties(gradlePropsPath);

  let wrapper: WrapperInfo | undefined;
  const wrapperPropsPath = path.join(root, 'gradle', 'wrapper', 'gradle-wrapper.properties');
  const wrapperProps = parseProperties(wrapperPropsPath);
  if (wrapperProps) {
    wrapper = {
      distributionUrl: wrapperProps['distributionUrl'],
      propertiesPath: path.relative(root, wrapperPropsPath),
    };
  }

  return { modules, gradleProperties: gradleProps, wrapper };
}

export class GradleParser {
  constructor(private channel: vscode.OutputChannel, private metaDir: string) {}

  async parseProject(projectRoot: string): Promise<GradleParseOutput> {
    const output = await parseGradleProject(projectRoot);
    this.channel.appendLine(`[gradleParser] Parsed ${output.modules.length} modules.`);
    return output;
  }
}
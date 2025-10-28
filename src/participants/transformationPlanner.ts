import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { GradleParseOutput } from './gradleParser'

// Configuration: Dependencies to exclude from libs.versions.toml
const EXCLUDED_DEPENDENCIES = [
  'gradle-nexus-plugin',
  'scalatest',
  // Add more dependencies to exclude here
]

// Configuration: Version keys to exclude from libs.versions.toml
const EXCLUDED_VERSION_KEYS = [
  'uploadArchivesUrl',
  'nexusUsername', 
  'nexusPassword',
  'nexusUrl',
  'nexusRepo',
  'nexusSnapshots',
  'nexusReleases',
  'artifactoryUrl',
  'artifactoryUsername',
  'artifactoryPassword',
  'publishUrl',
  'publishUsername',
  'publishPassword',
  'mavenUrl',
  'mavenUsername',
  'mavenPassword',
  'repositoryUrl',
  'repositoryUsername',
  'repositoryPassword'
]

// Configuration: Gradle-platform plugins to add to libs.versions.toml
const GRADLE_PLATFORM_PLUGINS = [
  {
    alias: 'plugin.publishing.artifactory',
    module: 'ops.org.publishing-artifactory:ops.org.publishing-artifactory.gradle.plugin',
    versionRef: 'plasmaGradlePlugins'
  },
  {
    alias: 'plugin.repositories.artifactory', 
    module: 'ops.org.repositories-artifactory:ops.org.repositories-artifactory.gradle.plugin',
    versionRef: 'plasmaGradlePlugins'
  },
  // Add more gradle-platform plugins here
]

// Configuration: Gradle-platform version
const GRADLE_PLATFORM_VERSION = '1.0.1-30'

function generateUnifiedDiff(oldText: string, newText: string, fileRelPath: string): string {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const oldCount = oldLines.length
  const newCount = newLines.length
  const header = `--- a/${fileRelPath}\n+++ b/${fileRelPath}\n`
  const hunkHeader = `@@ -1,${oldCount} +1,${newCount} @@\n`
  const body = [hunkHeader]
  const max = Math.max(oldCount, newCount)
  for (let i = 0; i < max; i++) {
    const o = i < oldCount ? oldLines[i] : null
    const n = i < newCount ? newLines[i] : null
    if (o === n) {
      body.push(` ${o ?? ''}`)
    } else {
      if (o !== null) body.push(`-${o}`)
      if (n !== null) body.push(`+${n}`)
    }
  }
  return header + body.join('\n') + '\n'
}

function generateAddFileDiff(fileRelPath: string, newText: string): string {
  const newLines = newText.split('\n')
  const newCount = newLines.length
  const header = `--- /dev/null\n+++ b/${fileRelPath}\n`
  const hunkHeader = `@@ -0,0 +1,${newCount} @@\n`
  const body = [hunkHeader]
  for (const n of newLines) body.push(`+${n}`)
  return header + body.join('\n') + '\n'
}

function generateDeleteFileDiff(fileRelPath: string, oldText: string): string {
  const oldLines = oldText.split('\n')
  const oldCount = oldLines.length
  const header = `--- a/${fileRelPath}\n+++ /dev/null\n`
  const hunkHeader = `@@ -1,${oldCount} +0,0 @@\n`
  const body = [hunkHeader]
  for (const o of oldLines) body.push(`-${o}`)
  return header + body.join('\n') + '\n'
}

function stripRepositoriesAndWrapper(content: string): { updated: string; changes: number } {
  let changes = 0
  let updated = content
  
  // Remove repositories blocks in any scope
  const repoRegex = /repositories\s*\{[\s\S]*?\}/g
  updated = updated.replace(repoRegex, () => { changes++; return '' })
  
  // Remove entire publishing blocks (including repositories and publications)
  const publishingRegex = /publishing\s*\{[\s\S]*?\}/g
  updated = updated.replace(publishingRegex, () => { changes++; return '' })
  
  // Remove uploadArchives tasks and configurations
  const uploadArchivesRegex = /(uploadArchives\s*\{[\s\S]*?\}|task\s+uploadArchives[\s\S]*?\})/g
  updated = updated.replace(uploadArchivesRegex, () => { changes++; return '' })
  
  // Remove modifyPom configurations
  const modifyPomRegex = /modifyPom\s*\{[\s\S]*?\}/g
  updated = updated.replace(modifyPomRegex, () => { changes++; return '' })
  
  // Remove nexus-related configurations and properties
  const nexusConfigRegex = /(nexus\s*\{[\s\S]*?\}|nexusStaging\s*\{[\s\S]*?\})/g
  updated = updated.replace(nexusConfigRegex, () => { changes++; return '' })
  
  // Remove signing configurations
  const signingRegex = /signing\s*\{[\s\S]*?\}/g
  updated = updated.replace(signingRegex, () => { changes++; return '' })
  
  // Remove wrapper tasks/blocks
  const wrapperTaskRegex = /(task\s+wrapper\b[\s\S]*?\}|tasks\.register\(\s*['"]wrapper['"][\s\S]*?\}|\bwrapper\s*\{[\s\S]*?\})/g
  updated = updated.replace(wrapperTaskRegex, () => { changes++; return '' })
  
  // Remove apply from versions.gradle and ext blocks
  const applyVersionsRegex = /apply\s+from:\s*['"]versions\.gradle['"]/g
  updated = updated.replace(applyVersionsRegex, () => { changes++; return '' })
  const extBlockRegex = /(^|\n)\s*ext\s*\{[\s\S]*?\}/g
  updated = updated.replace(extBlockRegex, () => { changes++; return '' })
  
  // Remove nexus-related property assignments
  const nexusPropsRegex = /(uploadArchivesUrl\s*=.*|nexusUsername\s*=.*|nexusPassword\s*=.*|nexusUrl\s*=.*)/g
  updated = updated.replace(nexusPropsRegex, () => { changes++; return '' })
  
  // Remove maven-publish plugin applications
  const mavenPublishPluginRegex = /apply\s+plugin:\s*['"]maven-publish['"]/g
  updated = updated.replace(mavenPublishPluginRegex, () => { changes++; return '' })
  
  return { updated, changes }
}

function ensureCommonLibPlugin(content: string): { updated: string; changes: number } {
  let changes = 0
  let updated = content
  const hasPluginsBlock = /plugins\s*\{[\s\S]*?\}/.test(updated)
  const hasCommonLib = /plugins\s*\{[\s\S]*?id\s+['"]common\.lib['"][\s\S]*?\}/.test(updated)
  if (!hasCommonLib) {
    changes++
    if (hasPluginsBlock) {
      updated = updated.replace(/plugins\s*\{/, (m) => `${m}\n    id 'common.lib'`)
    } else {
      updated = `plugins {\n    id 'common.lib'\n}\n\n${updated}`
    }
  }
  return { updated, changes }
}

function normalizeAlias(group: string, artifact: string): string {
  // Readable alias: group and artifact simplified
  const g = group.replace(/^[a-z]+\./, '').replace(/\./g, '-')
  const a = artifact.replace(/\./g, '-')
  return `${g}.${a}`
}

function extractVersionsFromExt(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  const blocks = text.match(/ext\s*\{([\s\S]*?)\}/g) || []
  for (const b of blocks) {
    const body = b.replace(/^[^{]*\{/, '').replace(/\}[^}]*$/, '')
    const lines = body.split(/\r?\n/)
    for (const line of lines) {
      const m = line.match(/^(\s*)([A-Za-z0-9_\.\-]+)\s*[:=]\s*['"]([^'"]+)['"]/)
      if (m) {
        out[m[2]] = m[3]
      }
    }
  }
  // project.ext assignments
  const projAssign = text.match(/project\.ext\.([A-Za-z0-9_\.\-]+)\s*=\s*['"]([^'"]+)['"]/g) || []
  for (const a of projAssign) {
    const m = a.match(/project\.ext\.([A-Za-z0-9_\.\-]+)\s*=\s*['"]([^'"]+)['"]/)
    if (m) out[m[1]] = m[2]
  }
  return out
}

function extractDependencies(text: string): Array<{ conf: string; group?: string; artifact?: string; version?: string; raw: string }>{
  const out: Array<{ conf: string; group?: string; artifact?: string; version?: string; raw: string }> = []
  const blocks = text.match(/dependencies\s*\{([\s\S]*?)\}/g) || []
  for (const b of blocks) {
    const body = b.replace(/^[^{]*\{/, '').replace(/\}[^}]*$/, '')
    const lines = body.split(/\r?\n/)
    for (const line of lines) {
      const m = line.match(/^(\s*)([A-Za-z]+)\s+(['"])((?:@?)[A-Za-z0-9_\-.]+):([A-Za-z0-9_\-.]+)(?::([A-Za-z0-9_\-.]+))?\3/)
      if (m) {
        out.push({ conf: m[2], group: m[4], artifact: m[5], version: m[6], raw: line })
      } else {
        const m2 = line.match(/^(\s*)([A-Za-z]+)\s+project\(['"][^'"]+['"]\)/)
        if (m2) {
          out.push({ conf: m2[2], raw: line })
        }
      }
    }
  }
  return out
}

function buildToml(
  versions: Record<string, string>, 
  deps: Array<{ group?: string; artifact?: string; version?: string }>,
  referenceContext?: { libsVersions?: any; buildPatterns?: string[] }
): string {
  const lines: string[] = []
  
  // Add versions section
  lines.push('[versions]')
  
  // Add gradle-platform version
  lines.push(`plasmaGradlePlugins = "${GRADLE_PLATFORM_VERSION}"`)
  
  // Merge reference versions with extracted versions (reference takes precedence)
  const mergedVersions = { ...versions };
  if (referenceContext?.libsVersions?.versions) {
    Object.assign(mergedVersions, referenceContext.libsVersions.versions);
  }

  // Add extracted versions (excluding any that match excluded dependencies or version keys)
  for (const [k, v] of Object.entries(mergedVersions)) {
    const shouldExcludeDep = EXCLUDED_DEPENDENCIES.some(excluded => 
      k.toLowerCase().includes(excluded.toLowerCase()) || 
      v.toLowerCase().includes(excluded.toLowerCase())
    )
    const shouldExcludeKey = EXCLUDED_VERSION_KEYS.some(excluded => 
      k.toLowerCase().includes(excluded.toLowerCase())
    )
    if (!shouldExcludeDep && !shouldExcludeKey) {
      lines.push(`${k} = "${v}"`)
    }
  }
  
  lines.push('\n[libraries]')
  
  // Add gradle-platform plugins as libraries
  for (const plugin of GRADLE_PLATFORM_PLUGINS) {
    lines.push(`${plugin.alias} = { module = "${plugin.module}", version.ref = "${plugin.versionRef}" }`)
  }
  
  // Add reference libraries if available
  if (referenceContext?.libsVersions?.libraries) {
    for (const [alias, libDef] of Object.entries(referenceContext.libsVersions.libraries)) {
      lines.push(`${alias} = ${JSON.stringify(libDef).replace(/"/g, '"')}`)
    }
  }
  
  // Add extracted dependencies (excluding unwanted ones)
  for (const d of deps) {
    if (!d.group || !d.artifact) continue
    
    // Check if this dependency should be excluded
    const shouldExclude = EXCLUDED_DEPENDENCIES.some(excluded => 
      d.group?.toLowerCase().includes(excluded.toLowerCase()) || 
      d.artifact?.toLowerCase().includes(excluded.toLowerCase())
    )
    
    if (!shouldExclude) {
      const alias = normalizeAlias(d.group, d.artifact)
      const version = d.version && versions[d.version] ? `, version.ref = "${d.version}"` : (d.version ? `, version = "${d.version}"` : '')
      lines.push(`${alias} = { group = "${d.group}", name = "${d.artifact}"${version} }`)
    }
  }
  
  lines.push('\n[plugins]')
  lines.push('publishing.artifactory = { id = "com.org.publishing-artifactory", version = "1.0.0" }')
  lines.push('repositories.artifactory = { id = "com.org.repositories-artifactory", version = "1.0.0" }')
  lines.push('scoverage = { id = "org.scoverage", version = "8.1.3" }')
  return lines.join('\n') + '\n'
}

export class TransformationPlanner {
  constructor(
    private channel: vscode.OutputChannel, 
    private metaDir: string, 
    private referenceProjectUrl?: string,
    private projectRoot?: string
  ) {}

  async provideWorkflowInstructions(): Promise<void> {
    const instructions = [
      '# @transformationPlanner - Complete Migration Workflow',
      '',
      '## 🎯 WORKFLOW ORCHESTRATION',
      'I control the complete Gradle migration workflow. Follow these steps:',
      '',
      '### STEP 1: REPOSITORY SETUP',
      '**Use @gitAgent to clone the target repository:**',
      '```',
      '@gitAgent clone <repository-url>',
      '```',
      '',
      '### STEP 2: REPOSITORY ANALYSIS', 
      '**Use @gradleParser to analyze the repository structure:**',
      '```',
      '@gradleParser analyze',
      '```',
      '',
      '### STEP 3: EXECUTE MIGRATION',
      '**Use @transformationPlanner to perform the migration:**',
      '```',
      '@transformationPlanner executeStepByStepMigration',
      '```',
      '',
      '### STEP 4: COMMIT CHANGES',
      '**After migration completes, use @gitAgent to commit:**',
      '```',
      '@gitAgent commit -m "Phase 1: Gradle migration - buildSrc + libs.versions.toml"',
      '```',
      '',
      '## 📋 IMPORTANT NOTES',
      '- Each step must complete before proceeding to the next',
      '- @transformationPlanner handles all migration steps automatically',
      '- Follow the exact commands provided above',
      '- Copilot guidelines in `.copilot/meta/copilot.md` support this workflow',
      '',
      '## 🚀 TO START THE MIGRATION:',
      'Begin with Step 1 (repository setup) and follow the sequence.',
      ''
    ];

    console.log(instructions.join('\n'));
  }

  private async cloneReferenceProject(): Promise<string | null> {
    if (!this.referenceProjectUrl) {
      return null;
    }

    try {
      const { execSync } = require('child_process');
      const referenceDir = path.join(this.metaDir, 'reference-project');
      
      // Remove existing reference directory if it exists
      if (fs.existsSync(referenceDir)) {
        fs.rmSync(referenceDir, { recursive: true, force: true });
      }

      this.channel.appendLine(`[transformationPlanner] Cloning reference project: ${this.referenceProjectUrl}`);
      execSync(`git clone "${this.referenceProjectUrl}" "${referenceDir}"`, { stdio: 'inherit' });
      
      this.channel.appendLine(`[transformationPlanner] ✓ Reference project cloned to ${referenceDir}`);
      return referenceDir;
    } catch (error) {
      this.channel.appendLine(`[transformationPlanner] ⚠️ Failed to clone reference project: ${error}`);
      return null;
    }
  }

  private async analyzeReferenceProject(referenceDir: string): Promise<{ libsVersions?: any; buildPatterns?: string[] }> {
    try {
      const libsVersionsPath = path.join(referenceDir, 'gradle', 'libs.versions.toml');
      const buildGradlePath = path.join(referenceDir, 'build.gradle');
      
      const result: { libsVersions?: any; buildPatterns?: string[] } = {};

      // Parse reference libs.versions.toml if it exists
      if (fs.existsSync(libsVersionsPath)) {
        const libsContent = fs.readFileSync(libsVersionsPath, 'utf-8');
        result.libsVersions = this.parseTomlContent(libsContent);
        this.channel.appendLine(`[transformationPlanner] ✓ Analyzed reference libs.versions.toml`);
      }

      // Extract build patterns from reference build.gradle
      if (fs.existsSync(buildGradlePath)) {
        const buildContent = fs.readFileSync(buildGradlePath, 'utf-8');
        result.buildPatterns = this.extractBuildPatterns(buildContent);
        this.channel.appendLine(`[transformationPlanner] ✓ Extracted build patterns from reference project`);
      }

      return result;
    } catch (error) {
      this.channel.appendLine(`[transformationPlanner] ⚠️ Failed to analyze reference project: ${error}`);
      return {};
    }
  }

  private parseTomlContent(content: string): any {
    // Simple TOML parser for libs.versions.toml
    const result: any = { versions: {}, libraries: {}, plugins: {} };
    let currentSection = '';
    
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        currentSection = trimmed.slice(1, -1);
      } else if (trimmed.includes('=') && currentSection) {
        const [key, value] = trimmed.split('=', 2);
        const cleanKey = key.trim();
        const cleanValue = value.trim().replace(/['"]/g, '');
        if (result[currentSection]) {
          result[currentSection][cleanKey] = cleanValue;
        }
      }
    }
    return result;
  }

  private extractBuildPatterns(content: string): string[] {
    const patterns: string[] = [];
    
    // Extract common patterns like plugin applications, dependency configurations, etc.
    const pluginMatches = content.match(/id\s+['"][^'"]+['"]/g);
    if (pluginMatches) {
      patterns.push(...pluginMatches);
    }
    
    const dependencyMatches = content.match(/implementation\s+libs\.[a-zA-Z0-9.-]+/g);
    if (dependencyMatches) {
      patterns.push(...dependencyMatches);
    }
    
    return patterns;
  }

  async executeStepByStepMigration(parse: GradleParseOutput, projectRoot: string): Promise<{ filesChanged: string[]; riskSummary: string }>{
    const filesChanged: string[] = []
    let highRisk = 0, mediumRisk = 0, lowRisk = 0

    this.channel.appendLine(`[transformationPlanner] Starting step-by-step Gradle migration for: ${projectRoot}`)

    // Step 0: Clone and analyze reference project if provided
    let referenceContext: { libsVersions?: any; buildPatterns?: string[] } = {};
    if (this.referenceProjectUrl) {
      this.channel.appendLine(`[transformationPlanner] Step 0: Analyzing reference project for context`)
      const referenceDir = await this.cloneReferenceProject();
      if (referenceDir) {
        referenceContext = await this.analyzeReferenceProject(referenceDir);
        this.channel.appendLine(`[transformationPlanner] ✓ Reference project analysis complete`)
      }
    }

    // Step 1: Update settings.gradle - keep only rootProject.name and include lines
    this.channel.appendLine(`[transformationPlanner] Step 1: Updating settings.gradle`)
    const settingsGradlePath = path.join(projectRoot, 'settings.gradle')
    if (fs.existsSync(settingsGradlePath)) {
      const original = fs.readFileSync(settingsGradlePath, 'utf-8')
      const rootNameLineMatch = original.match(/^\s*rootProject\.name\s*=\s*.*$/m)
      const includeLines = original.match(/^\s*include\s+.*$/gm) || []
      const defaultRootName = `rootProject.name = '${path.basename(projectRoot)}'`
      const rootNameLine = rootNameLineMatch?.[0] || defaultRootName
      const minimal = [rootNameLine, ...includeLines].filter(Boolean).join('\n') + '\n'
      if (minimal !== original) {
        fs.writeFileSync(settingsGradlePath, minimal)
        filesChanged.push('settings.gradle')
        lowRisk++
        this.channel.appendLine(`[transformationPlanner] ✓ Updated settings.gradle`)
      } else {
        this.channel.appendLine(`[transformationPlanner] ✓ settings.gradle already minimal`)
      }
    }

    // Step 2: Copy buildSrc from .copilot/meta/buildSrc
    this.channel.appendLine(`[transformationPlanner] Step 2: Copying buildSrc folder`)
    const metaBuildSrcPath = path.join(this.metaDir, 'buildSrc')
    const projectBuildSrcPath = path.join(projectRoot, 'buildSrc')

    if (fs.existsSync(metaBuildSrcPath)) {
      this.copyBuildSrcFromMetaDirectly(metaBuildSrcPath, projectBuildSrcPath, filesChanged)
      lowRisk += 3
      this.channel.appendLine(`[transformationPlanner] ✓ Copied buildSrc folder`)
    } else {
      this.channel.appendLine(`[transformationPlanner] ⚠ Warning: .copilot/meta/buildSrc not found, skipping buildSrc scaffolding`)
    }

    // Step 3: Generate gradle/libs.versions.toml
    this.channel.appendLine(`[transformationPlanner] Step 3: Generating libs.versions.toml`)
    const buildFiles = this.findAllBuildGradleFiles(projectRoot)
    const allText = buildFiles.map(p => fs.readFileSync(p, 'utf-8')).join('\n\n')
    const versions = extractVersionsFromExt(allText)
    const deps = extractDependencies(allText)
    const toml = buildToml(versions, deps, referenceContext)

    const tomlRel = 'gradle/libs.versions.toml'
    const tomlAbs = path.join(projectRoot, tomlRel)
    fs.mkdirSync(path.dirname(tomlAbs), { recursive: true })
    fs.writeFileSync(tomlAbs, toml)
    filesChanged.push(tomlRel)
    mediumRisk++
    this.channel.appendLine(`[transformationPlanner] ✓ Generated libs.versions.toml`)

    // Step 4: Update gradle-wrapper.properties with version preservation
    this.channel.appendLine(`[transformationPlanner] Step 4: Updating gradle-wrapper.properties`)
    this.updateGradleWrapperProperties(projectRoot, filesChanged)
    lowRisk++
    this.channel.appendLine(`[transformationPlanner] ✓ Updated gradle-wrapper.properties`)

    // Step 5: libs.versions.toml customization is already included in buildToml function

    // Step 6: Update subproject build.gradle files
    this.channel.appendLine(`[transformationPlanner] Step 5: Updating build.gradle files`)
    const rootBuildPath = path.join(projectRoot, 'build.gradle')
    if (fs.existsSync(rootBuildPath)) {
      fs.unlinkSync(rootBuildPath)
      filesChanged.push('build.gradle')
      lowRisk++
      this.channel.appendLine(`[transformationPlanner] ✓ Deleted root build.gradle`)
    }

    // Delete versions.gradle if it exists
    const versionsGradlePath = path.join(projectRoot, 'versions.gradle')
    if (fs.existsSync(versionsGradlePath)) {
      fs.unlinkSync(versionsGradlePath)
      filesChanged.push('versions.gradle')
      lowRisk++
      this.channel.appendLine(`[transformationPlanner] ✓ Deleted versions.gradle`)
    }

    for (const fileAbs of buildFiles) {
      const rel = path.relative(projectRoot, fileAbs)
      if (rel === 'build.gradle') continue // already removed
      const original = fs.readFileSync(fileAbs, 'utf-8')
      let { updated, changes } = stripRepositoriesAndWrapper(original)
      const addRes = ensureCommonLibPlugin(updated)
      updated = addRes.updated
      changes += addRes.changes
      if (changes > 0 && updated !== original) {
        fs.writeFileSync(fileAbs, updated)
        filesChanged.push(rel)
        mediumRisk++
        this.channel.appendLine(`[transformationPlanner] ✓ Updated ${rel}`)
      }
    }

    // Step 6 & 7: Write Copilot guidance for custom files and nexus cleanup
    this.channel.appendLine(`[transformationPlanner] Step 6-7: Writing Copilot guidance`)
    this.writeCopilotGuidance()
    this.validateBuildSrcTemplates([], filesChanged)
    
    // Validate the migration results
    this.validateMigrationCompliance(projectRoot)

    const riskSummary = `low=${lowRisk}, medium=${mediumRisk}, high=${highRisk}`
    this.channel.appendLine(`[transformationPlanner] ✓ Migration completed. Risk summary: ${riskSummary}`)
    
    return { filesChanged, riskSummary }
  }

  // Keep the old method for backward compatibility but mark it as deprecated
  async generatePatches(parse: GradleParseOutput, projectRoot: string): Promise<{ patchText: string; filesChanged: string[]; riskSummary: string }>{
    this.channel.appendLine(`[transformationPlanner] Warning: generatePatches is deprecated. Use executeStepByStepMigration instead.`)
    const result = await this.executeStepByStepMigration(parse, projectRoot)
    return { patchText: '', filesChanged: result.filesChanged, riskSummary: result.riskSummary }
  }

  private writeCopilotGuidance(): void {
    try {
      const guidance = [
        '# Gradle Migration - Phase 1 Complete',
        '',
        '## ✅ MIGRATION STEPS COMPLETED',
        'The @transformationPlanner has successfully executed all migration steps.',
        '',
        '## 🎯 WORKFLOW CONTROL: @transformationPlanner',
        'This chatParticipant controls the migration workflow. Follow these instructions:',
        '',
        '### IMMEDIATE NEXT STEPS:',
        '1. **Review the validation results above** (look for ✅/❌ indicators)',
        '2. **If validation passed:** Proceed to commit the changes',
        '3. **If validation failed:** Report the specific failures',
        '',
        '### TO COMMIT CHANGES:',
        '**Use @gitAgent with this exact command:**',
        '```',
        '@gitAgent commit -m "Phase 1: Gradle migration - buildSrc + libs.versions.toml"',
        '```',
        '',
        '### WHAT WAS ACCOMPLISHED:',
        '- ✅ Root `settings.gradle` cleaned (only rootProject.name + includes)',
        '- ✅ `buildSrc/` folder copied from meta template',
        '- ✅ `gradle/libs.versions.toml` generated from existing versions',
        '- ✅ Root `build.gradle` deleted (dependencies moved to buildSrc)',
        '- ✅ Subproject `build.gradle` files updated with common.lib plugin',
        '',
        '## ⚠️ PHASE 1 COMPLETE - PHASE 2 PENDING',
        '- Dependencies remain in old format (implementation "group:artifact:version")',
        '- Phase 2 will convert to libs.* format later',
        '- **DO NOT manually convert dependencies now**',
        '',
        '## 🔍 VALIDATION RESULTS',
        'Check the output above for validation results:',
        '',
        '## For the root settings.gradle in the project:',
        'Remove all repository, plugin and custom configuration blocks (such as gradle.allprojects, ext.PlasmaNexus, buildscript.repositories, etc).',
        'Only keep the essential lines:',
        "- rootProject.name = '<project-name>'",
        '- Any include statements for subprojects, if present',
        'Do not keep any other configuration, comments or custom logic.',
        '',
        '## Then, copy the entire buildSrc folder:',
        'Copy the entire buildSrc folder (including settings.gradle, build.gradle and common.lib.gradle) from .copilot/meta/buildSrc into this repo, overwriting any existing files.',
        '',
        '## Handle Custom Gradle Files (Step 6):',
        'See detailed instructions in: .copilot/meta/custom-gradle-files-prompt.md',
        '',
        '## Remove Nexus URLs and Related Configs (Step 7):',
        'See detailed instructions in: .copilot/meta/nexus-cleanup-prompt.md',
      ].join('\n')
      const outPath = path.join(this.metaDir, 'copilot-guidance.md')
      fs.writeFileSync(outPath, guidance)
      this.channel.appendLine(`[transformationPlanner] Wrote strict guidance: ${outPath}`)

      // Write detailed prompt files for steps 6 and 7
      this.writeCustomGradleFilesPrompt()
      this.writeNexusCleanupPrompt()
      
      // Ensure copilot.md is available in target project
      this.ensureCopilotInstructions()
    } catch {}
  }

  private ensureCopilotInstructions(): void {
    try {
      const copilotMdPath = path.join(this.metaDir, 'copilot.md')
      
      // Check if copilot.md already exists in target project
      if (!fs.existsSync(copilotMdPath)) {
        // Copy from extension's meta folder
        const extensionCopilotPath = path.join(__dirname, '../../.copilot/.meta/copilot.md')
        if (fs.existsSync(extensionCopilotPath)) {
          fs.copyFileSync(extensionCopilotPath, copilotMdPath)
          this.channel.appendLine(`[transformationPlanner] Copied copilot.md to target project: ${copilotMdPath}`)
        } else {
          this.channel.appendLine(`[transformationPlanner] Warning: copilot.md not found in extension meta folder`)
        }
      }
    } catch (error) {
      this.channel.appendLine(`[transformationPlanner] Error ensuring copilot.md: ${error}`)
    }
  }

  private writeCustomGradleFilesPrompt(): void {
    try {
      const prompt = [
        '# Custom Gradle Files Migration Prompt',
        '',
        '## Objective',
        'Intelligently handle custom gradle files (publish.gradle, compilation.gradle, dependencies.gradle, versions.gradle, etc.) during Gradle migration by preserving essential build logic while removing outdated patterns.',
        '',
        '## Instructions',
        '',
        '### 1. Discovery Phase',
        'Search the entire project for custom gradle files with these patterns:',
        '- `*.gradle` files that are NOT `build.gradle` or `settings.gradle`',
        '- Common names: `publish.gradle`, `compilation.gradle`, `dependencies.gradle`, `versions.gradle`, `common.gradle`, `plugins.gradle`',
        '- Look in both root directory and all subdirectories',
        '',
        '### 2. Analysis Phase',
        'For each custom gradle file found, categorize the content:',
        '',
        '**Essential Logic (PRESERVE):**',
        '- Dependency declarations (`implementation`, `testImplementation`, etc.)',
        '- Plugin applications and configurations',
        '- Custom build tasks and task configurations',
        '- Source set definitions',
        '- Compiler options and build configurations',
        '- Test configurations',
        '- JAR/WAR packaging configurations',
        '',
        '**Outdated Logic (DISCARD):**',
        '- Repository blocks (will be handled by buildSrc)',
        '- Nexus URL configurations',
        '- Old-style plugin applications (`apply plugin:`)',
        '- ext.* variable definitions that duplicate libs.versions.toml',
        '- buildscript blocks',
        '- Legacy wrapper configurations',
        '',
        '### 3. Migration Phase',
        'For files with essential logic:',
        '1. **Extract and merge** essential parts into the appropriate `build.gradle` file',
        '2. **Convert references**: Change `ext.someVersion` to `libs.versions.someVersion`',
        '3. **Update syntax**: Convert old-style to new-style where applicable',
        '4. **Avoid duplicates**: Don\'t add configurations that already exist in target build.gradle',
        '',
        '### 4. Cleanup Phase',
        'After processing each file:',
        '- **Delete the custom gradle file** (regardless of whether content was preserved)',
        '- **Update any references** to the deleted file in other gradle files',
        '- **Log the action** taken for each file',
        '',
        '## Success Criteria',
        '- All custom gradle files are processed and deleted',
        '- Essential build logic is preserved in appropriate build.gradle files',
        '- No broken references remain',
        '- Build functionality is maintained',
        '- Project uses only standard gradle file structure'
      ].join('\n')
      
      const outPath = path.join(this.metaDir, 'custom-gradle-files-prompt.md')
      fs.writeFileSync(outPath, prompt)
      this.channel.appendLine(`[transformationPlanner] Wrote custom gradle files prompt: ${outPath}`)
    } catch {}
  }

  private writeNexusCleanupPrompt(): void {
    try {
      const prompt = [
        '# Nexus URLs and Repository Cleanup Prompt',
        '',
        '## Objective',
        'Remove all internal nexus repository configurations and related legacy settings from Gradle build files while preserving legitimate external repositories.',
        '',
        '## Instructions',
        '',
        '### 1. Discovery Phase',
        'Search through ALL gradle files in the project:',
        '- Root `build.gradle` (if it exists)',
        '- All subproject `build.gradle` files',
        '- Any remaining custom gradle files',
        '- `settings.gradle` files',
        '',
        '### 2. Target Patterns to Remove',
        '',
        '**Repository Blocks with Nexus URLs:**',
        '```gradle',
        'repositories {',
        '    maven {',
        '        url "http://nexus.company.com/repository/maven-public/"',
        '        // or https://nexus.internal.com/...',
        '        // or any internal nexus server',
        '    }',
        '}',
        '```',
        '',
        '**ext.* Variables for Nexus:**',
        '```gradle',
        'ext {',
        '    nexusUrl = "http://nexus.company.com"',
        '    nexusUsername = "..."',
        '    nexusPassword = "..."',
        '}',
        '```',
        '',
        '### 3. Patterns to PRESERVE',
        '',
        '**Standard Public Repositories:**',
        '```gradle',
        'repositories {',
        '    mavenCentral()',
        '    gradlePluginPortal()',
        '    google()',
        '}',
        '```',
        '',
        '### 4. Common Nexus URL Patterns',
        'Look for these patterns in URLs:',
        '- `nexus.company.com`',
        '- `nexus.internal.com`',
        '- `artifactory.company.com`',
        '- Any URL with internal domain names',
        '- URLs starting with `http://` (often internal)',
        '',
        '## Success Criteria',
        '- All internal nexus repository configurations removed',
        '- All related ext.* variables removed',
        '- Legitimate external repositories preserved',
        '- Build functionality maintained through buildSrc configuration'
      ].join('\n')
      
      const outPath = path.join(this.metaDir, 'nexus-cleanup-prompt.md')
      fs.writeFileSync(outPath, prompt)
      this.channel.appendLine(`[transformationPlanner] Wrote nexus cleanup prompt: ${outPath}`)
    } catch {}
  }

  private copyBuildSrcFromMeta(metaBuildSrcPath: string, projectBuildSrcPath: string, projectRoot: string, diffs: string[], filesChanged: string[]): void {
    const copyRecursively = (srcDir: string, destDir: string, relativeBase: string = '') => {
      const entries = fs.readdirSync(srcDir, { withFileTypes: true })
      
      for (const entry of entries) {
        const srcPath = path.join(srcDir, entry.name)
        const destPath = path.join(destDir, entry.name)
        const relativePath = path.join(relativeBase, entry.name).replace(/\\/g, '/')
        
        if (entry.isDirectory()) {
          // Ensure directory exists
          if (!fs.existsSync(destPath)) {
            fs.mkdirSync(destPath, { recursive: true })
          }
          copyRecursively(srcPath, destPath, relativePath)
        } else {
          // Copy file and generate diff
          const content = fs.readFileSync(srcPath, 'utf-8')
          const projectRelativePath = path.relative(projectRoot, destPath).replace(/\\/g, '/')
          
          if (!fs.existsSync(destPath)) {
            diffs.push(generateAddFileDiff(projectRelativePath, content))
            filesChanged.push(projectRelativePath)
          } else {
            const original = fs.readFileSync(destPath, 'utf-8')
            if (original !== content) {
              diffs.push(generateUnifiedDiff(original, content, projectRelativePath))
              filesChanged.push(projectRelativePath)
            }
          }
        }
      }
    }
    
    // Ensure buildSrc directory exists
    if (!fs.existsSync(projectBuildSrcPath)) {
      fs.mkdirSync(projectBuildSrcPath, { recursive: true })
    }
    
    copyRecursively(metaBuildSrcPath, projectBuildSrcPath, 'buildSrc')
  }

  private copyBuildSrcFromMetaDirectly(metaBuildSrcPath: string, projectBuildSrcPath: string, filesChanged: string[]): void {
    const copyRecursively = (srcDir: string, destDir: string) => {
      const entries = fs.readdirSync(srcDir, { withFileTypes: true })
      
      for (const entry of entries) {
        const srcPath = path.join(srcDir, entry.name)
        const destPath = path.join(destDir, entry.name)
        
        if (entry.isDirectory()) {
          // Ensure directory exists
          if (!fs.existsSync(destPath)) {
            fs.mkdirSync(destPath, { recursive: true })
          }
          copyRecursively(srcPath, destPath)
        } else {
          // Copy file directly
          const content = fs.readFileSync(srcPath, 'utf-8')
          fs.writeFileSync(destPath, content)
          const relativePath = path.relative(projectBuildSrcPath, destPath).replace(/\\/g, '/')
          filesChanged.push(`buildSrc/${relativePath}`)
        }
      }
    }
    
    // Ensure buildSrc directory exists
    if (!fs.existsSync(projectBuildSrcPath)) {
      fs.mkdirSync(projectBuildSrcPath, { recursive: true })
    }
    
    copyRecursively(metaBuildSrcPath, projectBuildSrcPath)
  }

  private updateGradleWrapperProperties(projectRoot: string, filesChanged: string[]): void {
    const currentWrapperPath = path.join(projectRoot, 'gradle', 'wrapper', 'gradle-wrapper.properties')
    const metaWrapperPath = path.join(this.metaDir, 'gradle-wrapper.properties')
    
    if (!fs.existsSync(metaWrapperPath)) {
      this.channel.appendLine(`[transformationPlanner] ⚠ Warning: .copilot/meta/gradle-wrapper.properties not found, skipping wrapper update`)
      return
    }
    
    let currentVersion = '6.8' // default fallback
    
    // Extract current Gradle version if wrapper exists
    if (fs.existsSync(currentWrapperPath)) {
      try {
        const currentContent = fs.readFileSync(currentWrapperPath, 'utf-8')
        const versionMatch = currentContent.match(/distributionUrl=.*gradle-([0-9]+\.[0-9]+(?:\.[0-9]+)?)-/)
        if (versionMatch) {
          currentVersion = versionMatch[1]
          this.channel.appendLine(`[transformationPlanner] Preserving Gradle version: ${currentVersion}`)
        }
      } catch (error) {
        this.channel.appendLine(`[transformationPlanner] Warning: Could not read current wrapper properties: ${error}`)
      }
    }
    
    // Read meta wrapper properties and update version
    try {
      const metaContent = fs.readFileSync(metaWrapperPath, 'utf-8')
      const updatedContent = metaContent.replace(
        /distributionUrl=.*gradle-[0-9]+\.[0-9]+(?:\.[0-9]+)?-/,
        `distributionUrl=https\\://services.gradle.org/distributions/gradle-${currentVersion}-`
      )
      
      // Ensure wrapper directory exists
      fs.mkdirSync(path.dirname(currentWrapperPath), { recursive: true })
      fs.writeFileSync(currentWrapperPath, updatedContent)
      
      const relPath = path.relative(projectRoot, currentWrapperPath)
      filesChanged.push(relPath)
      
    } catch (error) {
      this.channel.appendLine(`[transformationPlanner] Error updating gradle-wrapper.properties: ${error}`)
    }
  }

  private findAllBuildGradleFiles(projectRoot: string): string[] {
    const buildFiles: string[] = []
    const stack: string[] = [projectRoot]
    
    // Also check for versions.gradle in root
    const versionsGradlePath = path.join(projectRoot, 'versions.gradle')
    if (fs.existsSync(versionsGradlePath)) {
      buildFiles.push(versionsGradlePath)
    }
    
    while (stack.length) {
      const dir = stack.pop()!
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const e of entries) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) {
          // Skip typical build outputs
          if (e.name === '.git' || e.name === '.copilot' || e.name === 'build' || e.name === '.gradle') continue
          stack.push(full)
        } else if (/build\.gradle$/.test(e.name)) {
          buildFiles.push(full)
        }
      }
    }
    return buildFiles
  }

  private validateBuildSrcTemplates(diffs: string[], filesChanged: string[]): void {
    const buildSrcFiles = filesChanged.filter(f => f.startsWith('buildSrc/'))
    if (buildSrcFiles.length > 0) {
      this.channel.appendLine('✓ buildSrc copied from .copilot/meta/buildSrc')
      this.channel.appendLine('✓ No custom buildSrc content generated - using exact meta content')
    }
  }

  private validateMigrationCompliance(projectRoot: string): void {
    this.channel.appendLine(`[transformationPlanner] 🔍 Validating migration compliance...`)
    
    const validationResults: string[] = []
    
    try {
      // Check if settings.gradle is properly cleaned
      const settingsPath = path.join(projectRoot, 'settings.gradle')
      if (fs.existsSync(settingsPath)) {
        const content = fs.readFileSync(settingsPath, 'utf-8')
        if (content.includes('repositories') || content.includes('gradle.allprojects') || content.includes('buildscript')) {
          validationResults.push('❌ settings.gradle still contains forbidden blocks (repositories, gradle.allprojects, buildscript)')
        } else {
          validationResults.push('✅ settings.gradle properly cleaned')
        }
      }
      
      // Check if buildSrc exists
      const buildSrcPath = path.join(projectRoot, 'buildSrc')
      if (fs.existsSync(buildSrcPath)) {
        validationResults.push('✅ buildSrc folder exists')
        
        // Check for required buildSrc files
        const requiredFiles = ['settings.gradle', 'build.gradle', 'src/main/groovy/common.lib.gradle']
        for (const file of requiredFiles) {
          if (fs.existsSync(path.join(buildSrcPath, file))) {
            validationResults.push(`✅ buildSrc/${file} exists`)
          } else {
            validationResults.push(`❌ buildSrc/${file} missing`)
          }
        }
      } else {
        validationResults.push('❌ buildSrc folder missing')
      }
      
      // Check if libs.versions.toml exists
      const libsVersionsPath = path.join(projectRoot, 'gradle/libs.versions.toml')
      if (fs.existsSync(libsVersionsPath)) {
        validationResults.push('✅ gradle/libs.versions.toml exists')
      } else {
        validationResults.push('❌ gradle/libs.versions.toml missing')
      }
      
      // Check if root build.gradle is deleted
      const rootBuildGradlePath = path.join(projectRoot, 'build.gradle')
      if (!fs.existsSync(rootBuildGradlePath)) {
        validationResults.push('✅ Root build.gradle deleted')
      } else {
        validationResults.push('❌ Root build.gradle still exists')
      }
      
      // Check if copilot.md is available
      const copilotMdPath = path.join(this.metaDir, 'copilot.md')
      if (fs.existsSync(copilotMdPath)) {
        validationResults.push('✅ copilot.md instructions available')
      } else {
        validationResults.push('❌ copilot.md instructions missing')
      }
      
      // Log all validation results
      this.channel.appendLine(`[transformationPlanner] Validation Results:`)
      validationResults.forEach(result => this.channel.appendLine(`[transformationPlanner] ${result}`))
      
      const failedChecks = validationResults.filter(r => r.startsWith('❌')).length
      if (failedChecks > 0) {
        this.channel.appendLine(`[transformationPlanner] ⚠️ ${failedChecks} validation checks failed - review copilot.md for strict instructions`)
      } else {
        this.channel.appendLine(`[transformationPlanner] ✅ All validation checks passed`)
      }
      
    } catch (error) {
      this.channel.appendLine(`[transformationPlanner] Error during validation: ${error}`)
    }
  }
}
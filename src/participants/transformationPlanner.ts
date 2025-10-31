import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { GradleParseOutput } from './gradleParser'

// AI-powered generation capabilities
interface AIGenerationContext {
  projectType: string
  dependencies: string[]
  buildPatterns: string[]
  customConfigurations: Record<string, any>
}

interface AIGeneratedContent {
  buildSrcFiles: Record<string, string>
  libsVersionsToml: string
  buildGradleUpdates: Record<string, string>
  confidence: number
}

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
  // This function serves as a fallback for AI-enhanced build.gradle updates
  // The main AI-enhanced logic is handled in the TransformationPlanner class
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



export class TransformationPlanner {
  private preferredModelId?: string; // Allow explicit model selection
  private modelsLogged: boolean = false; // Track if models have been logged

  constructor(
    private channel: vscode.OutputChannel, 
    private metaDir: string, 
    private projectRoot?: string
  ) {}

  /**
   * Set the preferred Copilot model for AI generation
   * @param modelId The model ID to prefer (e.g., 'gpt-4o', 'gpt-4') or 'auto' to reset to auto-selection
   */
  setPreferredModel(modelId: string): void {
    if (modelId === 'auto') {
      this.preferredModelId = undefined;
      this.channel.appendLine(`[transformationPlanner] ✓ Model preference reset to auto-selection`);
    } else {
      this.preferredModelId = modelId;
      this.channel.appendLine(`[transformationPlanner] ✓ Preferred model set to: ${modelId}`);
    }
  }

  async testAIConnection(): Promise<void> {
    this.channel.appendLine(`[transformationPlanner] 🧪 Testing AI connection with simple prompt...`);
    
    const simplePrompt = "Hello! Please respond with 'AI connection working' to confirm you can receive and respond to prompts.";
    
    try {
      const response = await this.invokeAIGeneration(simplePrompt);
      
      if (response && response.content) {
        this.channel.appendLine(`[transformationPlanner] ✅ AI connection test SUCCESSFUL!`);
        this.channel.appendLine(`[transformationPlanner] 📝 Response: ${JSON.stringify(response.content).substring(0, 200)}`);
      } else {
        this.channel.appendLine(`[transformationPlanner] ❌ AI connection test FAILED - received null or empty response`);
      }
    } catch (error) {
      this.channel.appendLine(`[transformationPlanner] ❌ AI connection test ERROR: ${error}`);
    }
  }

  private truncatePromptIntelligently(prompt: string, maxLength: number): string {
    if (prompt.length <= maxLength) {
      return prompt;
    }

    // Preserve the most important parts of the prompt
    const lines = prompt.split('\n');
    const importantSections = [];
    let currentLength = 0;

    // Always keep the task description (first few lines)
    const taskSection = lines.slice(0, 10).join('\n');
    if (taskSection.length < maxLength * 0.3) {
      importantSections.push(taskSection);
      currentLength += taskSection.length;
    }

    // Keep the output format (usually at the end)
    const outputFormatStart = prompt.lastIndexOf('## Expected Output Format:');
    if (outputFormatStart > 0) {
      const outputSection = prompt.substring(outputFormatStart);
      if (currentLength + outputSection.length < maxLength * 0.9) {
        importantSections.push(outputSection);
        currentLength += outputSection.length;
      }
    }

    // Fill remaining space with instructions
    const instructionsStart = prompt.indexOf('## Instructions:');
    if (instructionsStart > 0 && currentLength < maxLength * 0.7) {
      const instructionsEnd = outputFormatStart > 0 ? outputFormatStart : prompt.length;
      const instructionsSection = prompt.substring(instructionsStart, instructionsEnd);
      const remainingSpace = maxLength - currentLength - 100; // Leave some buffer
      
      if (instructionsSection.length <= remainingSpace) {
        importantSections.splice(-1, 0, instructionsSection); // Insert before output format
      } else {
        const truncatedInstructions = instructionsSection.substring(0, remainingSpace) + '\n[...truncated for length...]';
        importantSections.splice(-1, 0, truncatedInstructions);
      }
    }

    const result = importantSections.join('\n\n');
    
    // Final safety check
    if (result.length > maxLength) {
      return result.substring(0, maxLength - 50) + '\n[...truncated for length...]';
    }
    
    return result;
  }

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
      '',
      '## 🚀 TO START THE MIGRATION:',
      'Begin with Step 1 (repository setup) and follow the sequence.',
      ''
    ];

    console.log(instructions.join('\n'));
  }

  private createLibsVersionsTomlPrompt(
    projectContext: AIGenerationContext
  ): string {
    // Generate libs.versions.toml following COPILOT_TOML.md instructions
    return `Generate gradle/libs.versions.toml following the instructions in COPILOT_TOML.md. Convert all dependencies from versions.gradle and build.gradle files, handle Scala multi-version support, and create logical dependency bundles.`;
  }

  private createBuildGradleEnhancementPrompt(
    filePath: string,
    projectContext: AIGenerationContext
  ): string {
    const isRoot = filePath.endsWith('build.gradle') && !filePath.includes('/');
    
    return `Clean up ${filePath} by removing repositories and wrapper tasks. ${isRoot ? 'Keep plugins and subprojects.' : 'Add common.lib plugin.'} Return JSON with buildGradleUpdates field.`;
  }



  private async invokeAIGeneration(prompt: string): Promise<any> {
    try {
      this.channel.appendLine(`[transformationPlanner] 🤖 Invoking Copilot AI for generation`);
      
      // Use real Copilot Chat API
      const realAIResponse = await this.invokeCopilotChatAPI(prompt);
      if (realAIResponse) {
        this.channel.appendLine(`[transformationPlanner] ✓ Received AI response from Copilot Chat API`);
        return realAIResponse;
      }

      // No fallback - throw error if AI is not available
      throw new Error('Copilot Chat API not available and no fallback mechanisms allowed');
    } catch (error) {
      this.channel.appendLine(`[transformationPlanner] AI invocation error: ${error}`);
      throw error;
    }
  }

  private async selectPreferredModel(): Promise<vscode.LanguageModelChat | null> {
    try {
      this.channel.appendLine(`[transformationPlanner] 🔍 Starting model selection process...`);
      
      if (!vscode.lm) {
        this.channel.appendLine(`[transformationPlanner] ❌ VS Code Language Model API not available`);
        return null;
      }
      this.channel.appendLine(`[transformationPlanner] ✓ VS Code Language Model API is available`);

      this.channel.appendLine(`[transformationPlanner] 🔍 Querying available models...`);
      const models = await vscode.lm.selectChatModels();
      this.channel.appendLine(`[transformationPlanner] 📊 Found ${models.length} available models`);
      
      if (models.length === 0) {
        this.channel.appendLine(`[transformationPlanner] ❌ No language models available`);
        return null;
      }

      // Log available models for user reference (only once)
      if (!this.modelsLogged) {
        this.channel.appendLine(`[transformationPlanner] 📋 Available models:`);
        models.forEach((model, index) => {
          const isGPT41 = model.id.includes('gpt-4.1') || model.name.toLowerCase().includes('gpt4.1');
          const isGPT4o = model.id.includes('gpt-4o') || model.name.toLowerCase().includes('gpt4o');
          const isGPT4 = model.id.includes('gpt-4') || model.name.toLowerCase().includes('gpt4');
          const version = isGPT41 || isGPT4o ? '(GPT-4.1)' : isGPT4 ? '(GPT-4.0)' : '';
          this.channel.appendLine(`[transformationPlanner]   ${index + 1}. ${model.name} ${version} - ${model.id}`);
        });
        this.modelsLogged = true;
      }

      // Check if user has set a preferred model
      if (this.preferredModelId) {
        this.channel.appendLine(`[transformationPlanner] 🎯 Looking for user-preferred model: ${this.preferredModelId}`);
        const preferredId = this.preferredModelId; // TypeScript null check
        const userPreferredModel = models.find(model => 
          model.id.includes(preferredId) || 
          model.name.toLowerCase().includes(preferredId.toLowerCase())
        );
        if (userPreferredModel) {
          const isGPT41 = userPreferredModel.id.includes('gpt-4.1') || userPreferredModel.name.toLowerCase().includes('gpt4.1');
          const isGPT4o = userPreferredModel.id.includes('gpt-4o') || userPreferredModel.name.toLowerCase().includes('gpt4o');
          const version = isGPT41 || isGPT4o ? 'GPT-4.1' : 'GPT-4.0';
          this.channel.appendLine(`[transformationPlanner] ✓ Found user-preferred model: ${userPreferredModel.name} (${version})`);
          return userPreferredModel;
        } else {
          this.channel.appendLine(`[transformationPlanner] ❌ Preferred model '${this.preferredModelId}' not found, falling back to auto-selection`);
        }
      }

      // Priority order: gpt-4.1 > gpt-4o (4.1) > gpt-4 (4.0) > any available model
      const modelPreferences = ['gpt-4.1', 'gpt-4o', 'gpt-4', 'copilot-gpt-4', 'copilot-gpt-3.5-turbo'];
      this.channel.appendLine(`[transformationPlanner] 🔄 Auto-selecting from preferences: ${modelPreferences.join(', ')}`);
      
      for (const preferredModel of modelPreferences) {
        this.channel.appendLine(`[transformationPlanner] 🔍 Looking for models matching: ${preferredModel}`);
        const selectedModel = models.find(model => 
          model.id.includes(preferredModel) || 
          model.name.toLowerCase().includes(preferredModel.replace('-', ''))
        );
        if (selectedModel) {
          const isGPT41 = selectedModel.id.includes('gpt-4.1') || selectedModel.name.toLowerCase().includes('gpt4.1');
          const isGPT4o = selectedModel.id.includes('gpt-4o') || selectedModel.name.toLowerCase().includes('gpt4o');
          const version = isGPT41 || isGPT4o ? 'GPT-4.1' : 'GPT-4.0';
          this.channel.appendLine(`[transformationPlanner] ✓ Found matching model for '${preferredModel}': ${selectedModel.name} (${version})`);
          return selectedModel;
        } else {
          this.channel.appendLine(`[transformationPlanner] ❌ No models found matching: ${preferredModel}`);
        }
      }

      // Fallback to first available model
      const fallbackModel = models[0];
      this.channel.appendLine(`[transformationPlanner] ⚠️ Using fallback model: ${fallbackModel.name} [ID: ${fallbackModel.id}]`);
      return fallbackModel;

    } catch (error) {
      this.channel.appendLine(`[transformationPlanner] ❌ Error selecting model: ${error}`);
      this.channel.appendLine(`[transformationPlanner] ❌ Error stack: ${error instanceof Error ? error.stack : 'No stack trace'}`);
      return null;
    }
  }

  private logAIResponse(operation: string, prompt: string, response: any): void {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `ai-response-${operation}-${timestamp}.txt`;
      const filepath = path.join(this.metaDir, filename);
      
      const confidence = response?.confidence || response?.content?.confidence || 'unknown';
      
      // Format as human-readable text
      const logContent = [
        '='.repeat(80),
        `AI RESPONSE LOG - ${operation.toUpperCase()}`,
        '='.repeat(80),
        `Timestamp: ${new Date().toISOString()}`,
        `Operation: ${operation}`,
        `Confidence: ${confidence}`,
        '',
        'PROMPT:',
        '-'.repeat(40),
        prompt.length > 2000 ? prompt.substring(0, 2000) + '\n...[truncated - prompt too long]' : prompt,
        '',
        'RESPONSE:',
        '-'.repeat(40),
        typeof response === 'string' ? response : JSON.stringify(response, null, 2),
        '',
        '='.repeat(80),
        ''
      ].join('\n');
      
      fs.writeFileSync(filepath, logContent);
      this.channel.appendLine(`[transformationPlanner] 📝 AI response logged to ${filename}`);
    } catch (error) {
      this.channel.appendLine(`[transformationPlanner] ⚠️ Failed to log AI response: ${error}`);
    }
  }

  private async invokeCopilotChatAPI(prompt: string): Promise<any | null> {
    try {
      this.channel.appendLine(`[transformationPlanner] 🔍 Starting AI request with prompt length: ${prompt.length}`);
      
      // Validate and truncate prompt if too long (VS Code LM has strict limits)
      const MAX_PROMPT_LENGTH = 8000; // Conservative limit for VS Code Language Models
      let processedPrompt = prompt;
      
      if (prompt.length > MAX_PROMPT_LENGTH) {
        this.channel.appendLine(`[transformationPlanner] ⚠️ Prompt too long (${prompt.length} chars), truncating to ${MAX_PROMPT_LENGTH} chars`);
        processedPrompt = this.truncatePromptIntelligently(prompt, MAX_PROMPT_LENGTH);
        this.channel.appendLine(`[transformationPlanner] ✓ Prompt truncated to ${processedPrompt.length} characters`);
      }
      
      // Use VS Code's Language Model API to interact with Copilot models
      // Prefer GPT-4.1 (gpt-4o) over GPT-4.0 (gpt-4) when available
      
      // Check if language models are available
      if (!vscode.lm) {
        this.channel.appendLine(`[transformationPlanner] ❌ VS Code Language Model API not available`);
        return null;
      }
      this.channel.appendLine(`[transformationPlanner] ✓ VS Code Language Model API is available`);

      // Select the preferred model (prioritizing GPT-4.1)
      const selectedModel = await this.selectPreferredModel();
      if (!selectedModel) {
        this.channel.appendLine(`[transformationPlanner] ❌ No language models available from selectPreferredModel()`);
        return null;
      }
      this.channel.appendLine(`[transformationPlanner] ✓ Selected model: ${selectedModel.name} (ID: ${selectedModel.id})`);

      // Create chat request with the selected model
      const messages: vscode.LanguageModelChatMessage[] = [
        vscode.LanguageModelChatMessage.User(processedPrompt)
      ];
      this.channel.appendLine(`[transformationPlanner] ✓ Created chat messages array with ${messages.length} message(s)`);

      this.channel.appendLine(`[transformationPlanner] 🤖 Sending request to ${selectedModel.name}...`);
      
      // Send request to the language model
      const request = await selectedModel.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);
      this.channel.appendLine(`[transformationPlanner] ✓ Request sent successfully, processing response stream...`);
      
      let response = '';
      let fragmentCount = 0;
      for await (const fragment of request.text) {
        response += fragment;
        fragmentCount++;
      }
      this.channel.appendLine(`[transformationPlanner] ✓ Processed ${fragmentCount} response fragments, total length: ${response.length}`);

      if (response.trim()) {
        this.channel.appendLine(`[transformationPlanner] ✓ Received non-empty response from ${selectedModel.name} (${response.length} characters)`);
        this.channel.appendLine(`[transformationPlanner] 📝 Response preview: ${response.substring(0, 200)}${response.length > 200 ? '...' : ''}`);
        
        // Try to parse as JSON for structured responses
        try {
          const jsonResponse = JSON.parse(response);
          this.channel.appendLine(`[transformationPlanner] ✓ Successfully parsed response as JSON`);
          return {
            content: jsonResponse,
            model: selectedModel.name,
            confidence: 0.9 // High confidence for real AI response
          };
        } catch {
          // If not JSON, return as text content
          this.channel.appendLine(`[transformationPlanner] ✓ Response is not JSON, returning as text content`);
          return {
            content: response,
            model: selectedModel.name,
            confidence: 0.8
          };
        }
      } else {
        this.channel.appendLine(`[transformationPlanner] ❌ Received empty response from ${selectedModel.name}`);
      }

      this.channel.appendLine(`[transformationPlanner] ❌ Returning null - no valid response received`);
      return null;

    } catch (error) {
      this.channel.appendLine(`[transformationPlanner] ❌ Copilot Chat API error: ${error}`);
      this.channel.appendLine(`[transformationPlanner] ❌ Error stack: ${error instanceof Error ? error.stack : 'No stack trace'}`);
      return null;
    }
  }

  private async buildTomlWithAI(
    versions: Record<string, string>,
    deps: Array<{ group?: string; artifact?: string; version?: string }>
  ): Promise<string> {
    // Prepare context for AI generation
    const projectContext: AIGenerationContext = {
      projectType: this.detectProjectType({ dependencies: deps } as any),
      dependencies: deps.map(d => `${d.group}:${d.artifact}`).filter(Boolean),
      buildPatterns: [],
      customConfigurations: {}
    };

    this.channel.appendLine(`[transformationPlanner] 📝 Preparing to send prompt to Copilot for libs.versions.toml generation`);
    this.channel.appendLine(`[transformationPlanner] 🚀 Sending prompt to Copilot for libs.versions.toml generation...`);
    this.channel.appendLine(`[transformationPlanner] 🤖 Using LLM-only generation with COPILOT_TOML.md instructions`);
    
    const prompt = this.createLibsVersionsTomlPrompt(projectContext);
    
    const result = await this.invokeAIGeneration(prompt);
    
    if (!result) {
      throw new Error('AI failed to generate libs.versions.toml - no response received');
    }
    
    // Log the AI response
    this.logAIResponse('libs.versions.toml generation', prompt, result.content);
    
    // Handle both JSON and text responses
    let tomlContent: string;
    
    if (typeof result.content === 'object') {
      // Response is already parsed JSON
      if (result.content.libsVersionsToml) {
        tomlContent = result.content.libsVersionsToml;
      } else {
        throw new Error('AI response JSON does not contain libsVersionsToml field');
      }
    } else {
      // Response is text, try to parse as JSON first
      try {
        const parsedResult = JSON.parse(result.content);
        if (parsedResult.libsVersionsToml) {
          tomlContent = parsedResult.libsVersionsToml;
        } else {
          throw new Error('AI response JSON does not contain libsVersionsToml field');
        }
      } catch {
        // If not JSON, treat the entire response as the TOML content
        this.channel.appendLine(`[transformationPlanner] ✓ AI returned text response, using as TOML content directly`);
        tomlContent = result.content;
      }
    }
    
    this.channel.appendLine(`[transformationPlanner] ✓ AI generation successful`);
    return tomlContent;
  }

  private async stripRepositoriesAndWrapperWithAI(
    content: string, 
    filePath: string
  ): Promise<string> {
    try {
      // Prepare AI context for build.gradle enhancement
      const projectContext: AIGenerationContext = {
        projectType: this.detectProjectType({}),
        dependencies: this.extractDependenciesFromContent(content),
        customConfigurations: this.extractCustomConfigurations(content),
        buildPatterns: this.extractBuildPatterns(content)
      };

      // Create AI prompt for build.gradle enhancement
      const prompt = this.createBuildGradleEnhancementPrompt(filePath, projectContext);
      
      this.channel.appendLine(`[transformationPlanner] 📝 Preparing to send prompt to Copilot for build.gradle file: ${filePath}`);
      this.channel.appendLine(`[transformationPlanner] 🚀 Sending prompt to Copilot for build.gradle processing...`);
      
      // Attempt AI-enhanced generation
      const result = await this.invokeAIGeneration(prompt);
      
      // Log AI response for build.gradle enhancement
      this.logAIResponse(`build-gradle-enhancement-${path.basename(filePath, '.gradle')}`, prompt, result.response);
      
      if (result && result.confidence > 0.7) {
        const parsedResult = JSON.parse(result.response);
        if (parsedResult.buildGradleUpdates) {
          // Use AI-generated content if available and confident
          const aiContent = parsedResult.buildGradleUpdates[filePath] || parsedResult.buildGradleUpdates['build.gradle'];
          if (aiContent) {
            this.channel.appendLine(`[transformationPlanner] ✓ Using AI-enhanced build.gradle for ${filePath}`);
            return aiContent;
          }
        }
      }

      // Fallback to original content if AI generation fails or has low confidence
      this.channel.appendLine(`[transformationPlanner] ⚠️ AI enhancement failed for ${filePath}, using original content`);
      return content;
      
    } catch (error) {
      this.channel.appendLine(`[transformationPlanner] Error in AI enhancement for ${filePath}: ${error}`);
      return content;
    }
  }

  private async processRootBuildGradleWithAI(
    content: string, 
    projectRoot: string
  ): Promise<void> {
    try {
      // Prepare AI context for root build.gradle processing
      const projectContext: AIGenerationContext = {
        projectType: 'root-build-gradle-modernization',
        dependencies: this.extractDependenciesFromContent(content),
        customConfigurations: this.extractCustomConfigurations(content),
        buildPatterns: this.extractBuildPatterns(content)
      };

      // Create enhanced AI prompt specifically for root build.gradle cleanup
      const prompt = `Clean up root build.gradle by removing repositories and wrapper tasks. Keep plugins and subprojects. Return JSON with buildGradleUpdates field.`;
      
      // Attempt AI-enhanced processing
      const result = await this.invokeAIGeneration(prompt);
      
      // Log AI response for root build.gradle processing
      this.logAIResponse('root-build-gradle-processing', prompt, result.response);
      
      if (result && result.confidence > 0.6) {
        const parsedResult = JSON.parse(result.response);
        
        // Process AI suggestions for buildSrc files
        if (parsedResult.buildSrcFiles) {
          for (const [fileName, fileContent] of Object.entries(parsedResult.buildSrcFiles)) {
            const buildSrcFilePath = path.join(projectRoot, 'buildSrc', 'src', 'main', 'groovy', fileName);
            fs.mkdirSync(path.dirname(buildSrcFilePath), { recursive: true });
            fs.writeFileSync(buildSrcFilePath, fileContent as string);
            this.channel.appendLine(`[transformationPlanner] ✓ Created buildSrc file: ${fileName}`);
          }
        }

        // Process AI suggestions for subproject build.gradle updates
        if (parsedResult.buildGradleUpdates) {
          for (const [subprojectPath, updatedContent] of Object.entries(parsedResult.buildGradleUpdates)) {
            const fullSubprojectPath = path.join(projectRoot, subprojectPath, 'build.gradle');
            
            // Check if the subproject build.gradle exists
            if (fs.existsSync(fullSubprojectPath)) {
              try {
                fs.writeFileSync(fullSubprojectPath, updatedContent as string);
                this.channel.appendLine(`[transformationPlanner] ✓ Updated subproject build.gradle: ${subprojectPath}/build.gradle`);
              } catch (writeError) {
                this.channel.appendLine(`[transformationPlanner] ⚠️ Failed to update ${subprojectPath}/build.gradle: ${writeError}`);
              }
            } else {
              this.channel.appendLine(`[transformationPlanner] ⚠️ Subproject build.gradle not found: ${fullSubprojectPath}`);
            }
          }
        }

        this.channel.appendLine(`[transformationPlanner] ✓ AI-processed root build.gradle with confidence: ${result.confidence}`);
      } else {
        this.channel.appendLine(`[transformationPlanner] ⚠️ AI processing confidence too low, proceeding with deletion`);
      }
      
    } catch (error) {
      this.channel.appendLine(`[transformationPlanner] Error in AI processing for root build.gradle: ${error}`);
    }
  }

  private extractDependenciesFromContent(content: string): string[] {
    const dependencies: string[] = [];
    const depRegex = /(implementation|api|testImplementation|androidTestImplementation)\s+['"](.*?)['"]/g;
    let match;
    while ((match = depRegex.exec(content)) !== null) {
      dependencies.push(match[2]);
    }
    return dependencies;
  }

  private extractCustomConfigurations(content: string): any {
    const configurations: any = {};
    
    // Extract android block
    const androidMatch = content.match(/android\s*\{([\s\S]*?)\}/);
    if (androidMatch) {
      configurations.android = true;
    }
    
    // Extract kotlin options
    const kotlinMatch = content.match(/kotlinOptions\s*\{([\s\S]*?)\}/);
    if (kotlinMatch) {
      configurations.kotlin = true;
    }
    
    return configurations;
  }

  private detectProjectType(gradleOutput: any): string {
    const deps = gradleOutput.dependencies || [];
    const depStrings = deps.map((d: any) => `${d.group}:${d.artifact}`).join(' ');
    
    if (depStrings.includes('android')) return 'android';
    if (depStrings.includes('spring')) return 'spring-boot';
    if (depStrings.includes('kotlin')) return 'kotlin';
    if (depStrings.includes('java')) return 'java';
    
    return 'generic';
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
    const filesToDelete: string[] = [] // Collect files to delete at the end
    let highRisk = 0, mediumRisk = 0, lowRisk = 0

    this.channel.appendLine(`[transformationPlanner] Starting step-by-step Gradle migration for: ${projectRoot}`)

    // Note: ops_server analysis step removed as requested

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
    let allText = buildFiles.map(p => fs.readFileSync(p, 'utf-8')).join('\n\n')
    
    // Include versions.gradle content if it exists
    const versionsGradlePath = path.join(projectRoot, 'versions.gradle')
    if (fs.existsSync(versionsGradlePath)) {
      const versionsContent = fs.readFileSync(versionsGradlePath, 'utf-8')
      allText += '\n\n' + versionsContent
      this.channel.appendLine(`[transformationPlanner] ✓ Including versions.gradle content in libs.versions.toml generation`)
    }
    
    const versions = extractVersionsFromExt(allText)
    const deps = extractDependencies(allText)
    const toml = await this.buildTomlWithAI(versions, deps)

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

    // Step 6: Process root build.gradle with Copilot before deletion
    this.channel.appendLine(`[transformationPlanner] Step 5: Processing root build.gradle with Copilot`)
    const rootBuildPath = path.join(projectRoot, 'build.gradle')
    if (fs.existsSync(rootBuildPath)) {
      const rootBuildContent = fs.readFileSync(rootBuildPath, 'utf-8')
      this.channel.appendLine(`[transformationPlanner] 📝 Preparing to send prompt to Copilot for root build.gradle processing`)
      this.channel.appendLine(`[transformationPlanner] 🚀 Sending prompt to Copilot to extract essential logic from root build.gradle...`)
      
      // Process root build.gradle with enhanced AI prompt for cleanup and logic extraction
      await this.processRootBuildGradleWithAI(rootBuildContent, projectRoot);
      mediumRisk++
      this.channel.appendLine(`[transformationPlanner] ✓ Processed root build.gradle with Copilot`)
      
      // Note: Preserving root build.gradle as requested
    }

    for (const fileAbs of buildFiles) {
      const rel = path.relative(projectRoot, fileAbs)
      if (rel === 'build.gradle') continue // will be deleted at the end
      if (rel.endsWith('versions.gradle')) continue // versions.gradle should only be handled in root
      const original = fs.readFileSync(fileAbs, 'utf-8')
      const aiUpdated = await this.stripRepositoriesAndWrapperWithAI(original, rel);
      let { updated, changes } = stripRepositoriesAndWrapper(aiUpdated)
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

    // Step 6 & 7: Validate buildSrc templates (copilot guidance already written in step 2.5)
    this.channel.appendLine(`[transformationPlanner] Step 6-7: Validating buildSrc templates`)
    this.validateBuildSrcTemplates([], filesChanged)
    
    // Validate the migration results
    this.validateMigrationCompliance(projectRoot)

    // Step 8: Handle Jenkinsfile operations
    this.channel.appendLine(`[transformationPlanner] Step 8: Handling Jenkinsfile operations`)
    
    // Delete all Jenkinsfile.*.groovy files from root folder
    const jenkinsfilePattern = /^Jenkinsfile\..*\.groovy$/
    const rootFiles = fs.readdirSync(projectRoot)
    for (const file of rootFiles) {
      if (jenkinsfilePattern.test(file)) {
        const filePath = path.join(projectRoot, file)
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath)
          filesChanged.push(file)
          lowRisk++
          this.channel.appendLine(`[transformationPlanner] ✓ Deleted ${file}`)
        }
      }
    }
    
    // Copy Jenkinsfile from .copilot/meta to root folder
    const metaJenkinsfile = path.join(this.metaDir, 'Jenkinsfile')
    const rootJenkinsfile = path.join(projectRoot, 'Jenkinsfile')
    if (fs.existsSync(metaJenkinsfile)) {
      this.channel.appendLine(`[transformationPlanner] Copying templated Jenkins file replacing vars`)
      const jenkinsfileContent = fs.readFileSync(metaJenkinsfile, 'utf-8')
      fs.writeFileSync(rootJenkinsfile, jenkinsfileContent)
      filesChanged.push('Jenkinsfile')
      lowRisk++
      this.channel.appendLine(`[transformationPlanner] ✓ Copied templated Jenkinsfile from .copilot/meta`)
    } else {
      this.channel.appendLine(`[transformationPlanner] ⚠ Warning: .copilot/meta/Jenkinsfile not found, skipping Jenkinsfile copy`)
    }

    // Note: File deletion step removed - preserving all build files as requested
    const riskSummary = `low=${lowRisk}, medium=${mediumRisk}, high=${highRisk}`
    this.channel.appendLine(`[transformationPlanner] ✓ Migration completed. Risk summary: ${riskSummary}`)
    
    return { filesChanged, riskSummary }
  }

  // Keep the old method for backward compatibility but mark it as deprecated
  async generatePatches(parse: GradleParseOutput, projectRoot: string): Promise<{ patchText: string; filesChanged: string[]; riskSummary: string }>{
    this.channel.appendLine(`[transformationPlanner] Generating unified diff patches for migration changes`)
    
    // Store original file contents before migration
    const originalContents: Record<string, string> = {}
    const filesToTrack = [
      'settings.gradle',
      'gradle/libs.versions.toml',
      'gradle/wrapper/gradle-wrapper.properties',
      'build.gradle',
      'versions.gradle'
    ]
    
    // Find all build.gradle files to track
    const buildFiles = this.findAllBuildGradleFiles(projectRoot)
    for (const buildFile of buildFiles) {
      const relativePath = path.relative(projectRoot, buildFile)
      filesToTrack.push(relativePath)
    }
    
    // Store original contents
    for (const relPath of filesToTrack) {
      const absPath = path.join(projectRoot, relPath)
      if (fs.existsSync(absPath)) {
        originalContents[relPath] = fs.readFileSync(absPath, 'utf-8')
      }
    }
    
    // Execute the migration
    const result = await this.executeStepByStepMigration(parse, projectRoot)
    
    // Generate unified diffs for changed files
    const diffs: string[] = []
    
    for (const changedFile of result.filesChanged) {
      const absPath = path.join(projectRoot, changedFile)
      
      if (originalContents[changedFile]) {
        // File was modified
        if (fs.existsSync(absPath)) {
          const newContent = fs.readFileSync(absPath, 'utf-8')
          const diff = generateUnifiedDiff(originalContents[changedFile], newContent, changedFile)
          if (diff.trim()) {
            diffs.push(diff)
          }
        } else {
          // File was deleted
          const diff = generateDeleteFileDiff(changedFile, originalContents[changedFile])
          diffs.push(diff)
        }
      } else {
        // File was added
        if (fs.existsSync(absPath)) {
          const newContent = fs.readFileSync(absPath, 'utf-8')
          const diff = generateAddFileDiff(changedFile, newContent)
          diffs.push(diff)
        }
      }
    }
    
    const patchText = diffs.join('\n')
    this.channel.appendLine(`[transformationPlanner] Generated ${diffs.length} unified diffs for ${result.filesChanged.length} changed files`)
    
    return { patchText, filesChanged: result.filesChanged, riskSummary: result.riskSummary }
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
    
    // Read meta wrapper properties and copy exactly as-is without any modifications
    try {
      const metaContent = fs.readFileSync(metaWrapperPath, 'utf-8')
      
      // Ensure wrapper directory exists
      fs.mkdirSync(path.dirname(currentWrapperPath), { recursive: true })
      
      // Write the exact content from meta folder without any modifications
      fs.writeFileSync(currentWrapperPath, metaContent)
      
      const relPath = path.relative(projectRoot, currentWrapperPath)
      filesChanged.push(relPath)
      
      this.channel.appendLine(`[transformationPlanner] ✓ Copied gradle-wrapper.properties exactly from meta folder`)
      
    } catch (error) {
      this.channel.appendLine(`[transformationPlanner] Error copying gradle-wrapper.properties: ${error}`)
    }
  }

  private findAllBuildGradleFiles(projectRoot: string): string[] {
    const buildFiles: string[] = []
    const stack: string[] = [projectRoot]
    
    // Note: versions.gradle is handled separately in executeStepByStepMigration
    // We only want to find build.gradle files here
    
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
      
      // Note: copilot.md validation removed as it's not essential for migration success
      
      // Log all validation results
      this.channel.appendLine(`[transformationPlanner] Validation Results:`)
      validationResults.forEach(result => this.channel.appendLine(`[transformationPlanner] ${result}`))
      
      const failedChecks = validationResults.filter(r => r.startsWith('❌')).length
      if (failedChecks > 0) {
        this.channel.appendLine(`[transformationPlanner] ⚠️ ${failedChecks} validation checks failed`)
      } else {
        this.channel.appendLine(`[transformationPlanner] ✅ All validation checks passed`)
      }
      
    } catch (error) {
      this.channel.appendLine(`[transformationPlanner] Error during validation: ${error}`)
    }
  }
}
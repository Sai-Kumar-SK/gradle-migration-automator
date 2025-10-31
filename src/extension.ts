import * as vscode from 'vscode';
import { GitAgent } from './participants/gitAgent';
import * as path from 'path';
import * as fs from 'fs';
import { GradleParser } from './participants/gradleParser';
import { TransformationPlanner } from './participants/transformationPlanner';

// Simple telemetry collector
class Telemetry {
  constructor(private channel: vscode.OutputChannel) {}
  public info(event: string, details?: any) {
    try {
      const payload = { time: new Date().toISOString(), event, level: 'info', ...details };
      this.channel.appendLine(`[telemetry] ${JSON.stringify(payload)}`);
    } catch (err) {
      // Channel might be closed during workspace updates - ignore silently
    }
  }
  public error(event: string, err: unknown, details?: any) {
    try {
      const payload = { time: new Date().toISOString(), event, level: 'error', error: String(err), ...details };
      this.channel.appendLine(`[telemetry] ${JSON.stringify(payload)}`);
    } catch (err) {
      // Channel might be closed during workspace updates - ignore silently
    }
  }
}

export async function activate(context: vscode.ExtensionContext) {
  const channel = vscode.window.createOutputChannel('Gradle Migration Automator');
  const telemetry = new Telemetry(channel);

  // Register chat participants if API is available
  const chat: any = (vscode as any).chat;
  if (chat && typeof chat.createChatParticipant === 'function') {
    try {
      const gitAgentParticipant = chat.createChatParticipant('gitAgent', async (request: any) => {
      channel.show(true);
      telemetry.info('chat_gitAgent_invoked');
      const text = String(request?.prompt ?? request?.message ?? '');
      try {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        const metaDir = 'C:\\Copilot\\.copilot\\meta';
        fs.mkdirSync(metaDir, { recursive: true });
        const agent = new GitAgent(channel, metaDir);
        const commitMsgMatch = text.match(/commitMessage:\s*\"([^\"]+)\"/i);
        if (/apply|commit|push/i.test(text)) {
          const patchPath = path.join(metaDir, 'patches.diff');
          const commitMessage = commitMsgMatch?.[1] ?? 'chore: migrate Nexus to JFrog Artifactory';
          await agent.applyCommitAndPush({ patchPath, commitMessage });
        } else {
          const gitUrlMatch = text.match(/gitUrl:\s*(\S+)/i);
          const baseBranchMatch = text.match(/baseBranch:\s*(\S+)/i);
          if (gitUrlMatch && baseBranchMatch) {
            await agent.cloneAndPrepare({ gitUrl: gitUrlMatch[1], baseBranch: baseBranchMatch[1] });
          } else {
            channel.appendLine('[gitAgent] Provide gitUrl and baseBranch or ask to commit/push.');
          }
        }
      } catch (err) {
        telemetry.error('chat_gitAgent_error', err);
      }
    }, { name: 'gitAgent', description: 'Repository operations (clone, branch, commit, push).' });
    context.subscriptions.push(gitAgentParticipant);

    const gradleParserParticipant = chat.createChatParticipant('gradleParser', async (_request: any) => {
      channel.show(true);
      telemetry.info('chat_gradleParser_invoked');
      try {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        const metaDir = 'C:\\Copilot\\.copilot\\meta';
        fs.mkdirSync(metaDir, { recursive: true });
        const gitMetaPath = path.join(metaDir, 'gitAgent.json');
        let workspacePath = workspaceRoot;
        try { workspacePath = JSON.parse(fs.readFileSync(gitMetaPath, 'utf-8')).workspacePath || workspacePath; } catch {}
        const parser = new GradleParser(channel, metaDir);
        const output = await parser.parseProject(workspacePath);
        fs.writeFileSync(path.join(metaDir, 'gradle-ast.json'), JSON.stringify(output, null, 2));
      } catch (err) {
        telemetry.error('chat_gradleParser_error', err);
      }
    }, { name: 'gradleParser', description: 'Parse Gradle build files to JSON AST.' });
    context.subscriptions.push(gradleParserParticipant);

    const plannerParticipant = chat.createChatParticipant('transformationPlanner', async (request: any, context: any, stream: any) => {
      channel.show(true);
      telemetry.info('chat_transformationPlanner_invoked');
      try {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        const metaDir = 'C:\\Copilot\\.copilot\\meta';
        fs.mkdirSync(metaDir, { recursive: true });
        
        const planner = new TransformationPlanner(channel, metaDir);
        
        // Handle setPreferredModel command
        const prompt = request.prompt?.trim() || '';
        if (prompt.startsWith('setPreferredModel ')) {
          const modelId = prompt.replace('setPreferredModel ', '').trim();
          planner.setPreferredModel(modelId);
          stream.markdown(`✅ **Preferred Copilot model set to:** \`${modelId}\`\n\nThis model will be used for AI-enhanced Gradle migration generation. Available models:\n- \`gpt-4o\` (GPT-4.1) - Recommended\n- \`gpt-4\` (GPT-4.0)\n\nTo reset to auto-selection, use: \`@transformationPlanner setPreferredModel auto\``);
          return;
        }
        
        // Handle testAI command
        if (prompt === 'testAI' || prompt === 'test') {
          stream.markdown(`🧪 **Testing AI Connection...**\n\nRunning a simple connectivity test with the selected language model.`);
          await planner.testAIConnection();
          stream.markdown(`\n✅ **Test completed!** Check the transformationPlanner output channel for detailed results.`);
          return;
        }
        
        // Handle regular migration workflow
        const gitMetaPath = path.join(metaDir, 'gitAgent.json');
        let workspacePath = workspaceRoot;
        try { workspacePath = JSON.parse(fs.readFileSync(gitMetaPath, 'utf-8')).workspacePath || workspacePath; } catch {}
        const astPath = path.join(metaDir, 'gradle-ast.json');
        let ast: any = undefined;
        try { ast = JSON.parse(fs.readFileSync(astPath, 'utf-8')); } catch {}
        const result = await planner.executeStepByStepMigration(ast, workspacePath);
        fs.writeFileSync(path.join(metaDir, 'planner.json'), JSON.stringify({ filesChanged: result.filesChanged, riskSummary: result.riskSummary }, null, 2));
      } catch (err) {
        telemetry.error('chat_transformationPlanner_error', err);
      }
    }, { name: 'transformationPlanner', description: 'Generate Artifactory migration patches and risk summary.' });
    context.subscriptions.push(plannerParticipant);
    
    } catch (error) {
      channel.appendLine(`[error] Failed to register chat participants: ${error}`);
      telemetry.error('chat_participant_registration_error', error);
    }
  } else {
    channel.appendLine('[info] Chat Participants API not available; using command workflow.');
  }

  const migrateCmd = vscode.commands.registerCommand('gradle-migration-automator.migrate', async () => {
    try {
      // Always use the default meta folder path
      const originalWorkspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || path.join(process.cwd(), 'workspace');
      
      // Check if we're already in a cloned repo workspace (after restart)
      let workspaceRoot = originalWorkspaceRoot;
      let metaDir = 'C:\\Copilot\\.copilot\\meta';
      
      // If the current workspace looks like a cloned repo, still use the default meta folder
      if (originalWorkspaceRoot.includes('\\workspace\\') || originalWorkspaceRoot.includes('/workspace/')) {
        // Extract the migration root (parent of workspace folder)
        const migrationRoot = originalWorkspaceRoot.split(path.sep + 'workspace' + path.sep)[0];
        // metaDir remains the same fixed path
        channel.appendLine(`[MIGRATION] Detected cloned repo workspace, migration root: ${migrationRoot}, using default meta folder: ${metaDir}`);
      }
      
      const stateFile = path.join(metaDir, 'migration-state.json');
      
      // Check if we're resuming from an extension host restart
      channel.appendLine(`[MIGRATION] Original workspace root: ${originalWorkspaceRoot}`);
      channel.appendLine(`[MIGRATION] Meta directory: ${metaDir}`);
      channel.appendLine(`[MIGRATION] Checking for migration state file: ${stateFile}`);
      channel.appendLine(`[MIGRATION] State file exists: ${fs.existsSync(stateFile)}`);
      
      if (fs.existsSync(stateFile)) {
        try {
          const stateContent = fs.readFileSync(stateFile, 'utf-8');
          channel.appendLine(`[MIGRATION] State file content length: ${stateContent.length} chars`);
          
          const migrationState = JSON.parse(stateContent);
          const timeDiff = Date.now() - migrationState.timestamp;
          
          channel.appendLine(`[MIGRATION] State timestamp: ${new Date(migrationState.timestamp)}`);
          channel.appendLine(`[MIGRATION] Time difference: ${Math.round(timeDiff/1000)} seconds`);
          channel.appendLine(`[MIGRATION] State step: ${migrationState.step}`);
          
          // If state file is recent (less than 5 minutes), we likely restarted
          if (timeDiff < 5 * 60 * 1000) {
            channel.appendLine(`[MIGRATION] DETECTED RESTART: Found recent migration state from ${new Date(migrationState.timestamp)}`);
            channel.appendLine(`[MIGRATION] Resuming migration from step: ${migrationState.step}`);
            
            // Resume migration from where we left off
            if (migrationState.step === 'workspace_updated') {
              channel.appendLine(`[MIGRATION] Resuming after workspace update...`);
              channel.appendLine(`[MIGRATION] Workspace path: ${migrationState.workspacePath}`);
              channel.appendLine(`[MIGRATION] Meta dir: ${migrationState.metaDir}`);
              // Continue with step 2 (gradleParser)
              await resumeMigrationFromStep2(migrationState, channel, telemetry);
              return;
            } else {
              channel.appendLine(`[MIGRATION] Unknown step: ${migrationState.step} - starting fresh`);
            }
          } else {
            channel.appendLine(`[MIGRATION] Found old migration state (${Math.round(timeDiff/1000/60)} minutes old) - starting fresh`);
            fs.unlinkSync(stateFile);
          }
        } catch (err) {
          channel.appendLine(`[MIGRATION] Error reading migration state: ${err} - starting fresh`);
          try { fs.unlinkSync(stateFile); } catch {}
        }
      } else {
        channel.appendLine(`[MIGRATION] No migration state file found - starting fresh migration`);
      }
      
      channel.show(true);
      vscode.window.showInformationMessage('Gradle Migration Automator: Starting migration workflow...');
      telemetry.info('workflow_start');

      const gitUrl = await vscode.window.showInputBox({ prompt: 'Git URL of the repository', ignoreFocusOut: true });
      if (!gitUrl) { throw new Error('Git URL is required'); }

      const baseBranch = await vscode.window.showInputBox({ prompt: 'Base branch name (e.g., master)', ignoreFocusOut: true, value: 'master' });
      if (!baseBranch) { throw new Error('Base branch is required'); }

      const commitMessage = await vscode.window.showInputBox({ prompt: 'Commit message for migration changes', ignoreFocusOut: true, value: 'chore: migrate Nexus to JFrog Artifactory' });
      if (!commitMessage) { throw new Error('Commit message is required'); }

      // For fresh migration, use the default meta directory
      if (!originalWorkspaceRoot.includes('\\workspace\\') && !originalWorkspaceRoot.includes('/workspace/')) {
        workspaceRoot = originalWorkspaceRoot;
        // metaDir remains the same fixed path
      }
      // If we're already in a cloned repo, metaDir was set correctly above
      fs.mkdirSync(metaDir, { recursive: true });

      // Note: ops_server dependency removed as requested

      // Initialize participants (dependency injection style)
      const gitAgent = new GitAgent(channel, metaDir);
      const gradleParser = new GradleParser(channel, metaDir);
      const planner = new TransformationPlanner(channel, metaDir);

      // 1) gitAgent: clone and prepare workspace/branch
      channel.appendLine('[MIGRATION] Step 1: Starting gitAgent clone and prepare...');
      vscode.window.showInformationMessage('gitAgent: Cloning repository and preparing branch...');
      telemetry.info('gitAgent_clone_start', { gitUrl, baseBranch });
      
      const gitResult = await gitAgent.cloneAndPrepare({ gitUrl, baseBranch });
      channel.appendLine(`[MIGRATION] Step 1 completed: gitAgent.json written, workspacePath: ${gitResult.workspacePath}`);
      telemetry.info('gitAgent_clone_done', gitResult);

      // Open the cloned repo as workspace folder if not already open
      channel.appendLine('[MIGRATION] Step 1.5: Checking workspace folder status...');
      const repoFolder = vscode.Uri.file(gitResult.workspacePath);
      const isAlreadyOpen = vscode.workspace.workspaceFolders?.some(f => 
        path.resolve(f.uri.fsPath) === path.resolve(gitResult.workspacePath)
      );
      
      channel.appendLine(`[MIGRATION] Workspace already open: ${isAlreadyOpen}`);
      
      if (!isAlreadyOpen) {
        // Warn user that workspace will be updated (may cause extension host restart)
        channel.appendLine(`[MIGRATION] CRITICAL: About to update workspace folders - this WILL cause extension host restart`);
        channel.appendLine(`[MIGRATION] Adding workspace folder: ${gitResult.workspacePath}`);
        channel.appendLine(`[MIGRATION] Note: Extension will restart after this operation`);
        
        // Save state before workspace update since extension host will restart
        const stateFile = path.join(metaDir, 'migration-state.json');
        const migrationState = {
          step: 'workspace_updated',
          gitResult,
          gitUrl,
          baseBranch,
          commitMessage,
          workspacePath: gitResult.workspacePath,
          metaDir: metaDir,
          timestamp: Date.now()
        };
        fs.writeFileSync(stateFile, JSON.stringify(migrationState, null, 2));
        channel.appendLine(`[MIGRATION] Saved migration state to: ${stateFile}`);
        
        try {
          channel.appendLine(`[MIGRATION] Executing workspace.updateWorkspaceFolders...`);
          await vscode.workspace.updateWorkspaceFolders(0, null, { uri: repoFolder });
          channel.appendLine(`[MIGRATION] Workspace update call completed`);
          
          // If we reach here, extension host didn't restart - continue normally
          await new Promise(resolve => setTimeout(resolve, 1000));
          channel.appendLine(`[MIGRATION] Extension host did not restart - continuing...`);
        } catch (err) {
          // Workspace update might fail if extension host is restarting - this is expected
          channel.appendLine(`[MIGRATION] Workspace update error (may be expected): ${err}`);
          return; // Exit early since extension host is likely restarting
        }
      }

      // 2) gradleParser: parse build files
      channel.appendLine('[MIGRATION] Step 2: Starting gradleParser...');
      vscode.window.showInformationMessage('gradleParser: Parsing Gradle build files...');
      telemetry.info('gradleParser_parse_start', { repo: gitResult.repo, branch: gitResult.branch });
      
      const parseOutput = await gradleParser.parseProject(gitResult.workspacePath);
      const parsePath = path.join(metaDir, 'gradle-ast.json');
      fs.writeFileSync(parsePath, JSON.stringify(parseOutput, null, 2));
      channel.appendLine(`[MIGRATION] Step 2 completed: gradle-ast.json written to ${parsePath}`);
      telemetry.info('gradleParser_parse_done', { outputPath: parsePath });

      // 3) transformationPlanner: plan unified diff patches
      channel.appendLine('[MIGRATION] Step 3: Starting transformationPlanner...');
      vscode.window.showInformationMessage('transformationPlanner: Generating migration patches...');
      telemetry.info('planner_generate_start');
      
      const planResult = await planner.generatePatches(parseOutput, gitResult.workspacePath);
      const patchPath = path.join(metaDir, 'patches.diff');
      fs.writeFileSync(patchPath, planResult.patchText);
      channel.appendLine(`[MIGRATION] Step 3 completed: patches.diff written to ${patchPath}`);
      telemetry.info('planner_generate_done', { patchPath, filesChanged: planResult.filesChanged.length, riskSummary: planResult.riskSummary });

      // 4) Ask user to review and commit changes
      channel.appendLine('[MIGRATION] Step 4: Migration changes ready for review');
      const summary = `Migration complete.\nRepo: ${gitResult.repo}\nBranch: ${gitResult.branch}\nFiles changed: ${planResult.filesChanged.join(', ') || 'None'}\nRisk scores: ${planResult.riskSummary}\nPatches: ${patchPath}\n\nNext steps:\n1. Review the changes in your working directory\n2. Test the migration (e.g., ./gradlew build)\n3. Commit and push when ready`;
      channel.appendLine(summary);
      
      // Show user options for next steps
      const action = await vscode.window.showInformationMessage(
        'Gradle Migration complete! Files have been modified in your working directory.',
        'Review Changes',
        'Apply Patches',
        'Open Terminal'
      );
      
      if (action === 'Review Changes') {
        // Open the Source Control view to show changes
        vscode.commands.executeCommand('workbench.view.scm');
      } else if (action === 'Apply Patches') {
        // Apply patches using git apply
        try {
          channel.appendLine('[MIGRATION] Applying patches via git apply...');
          telemetry.info('gitAgent_commit_start', { patchPath });
          const commitRes = await gitAgent.applyCommitAndPush({ patchPath, commitMessage });
          channel.appendLine(`[MIGRATION] Patches applied and changes committed`);
          telemetry.info('gitAgent_commit_done', commitRes);
          vscode.window.showInformationMessage('Migration patches applied and committed successfully!');
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          channel.appendLine(`[MIGRATION] Error applying patches: ${errorMsg}`);
          vscode.window.showErrorMessage(`Failed to apply patches: ${errorMsg}`);
        }
      } else if (action === 'Open Terminal') {
        // Open terminal for manual testing
        vscode.commands.executeCommand('workbench.action.terminal.new');
      }
    } catch (err) {
      telemetry.error('workflow_error', err);
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Gradle Migration Automator: ${message}`);
    }
  });

  context.subscriptions.push(migrateCmd, channel);
}

async function resumeMigrationFromStep2(migrationState: any, channel: vscode.OutputChannel, telemetry: any) {
  try {
    channel.show(true);
    
    // Initialize components
    const gitAgent = new GitAgent(channel, migrationState.metaDir);
    const gradleParser = new GradleParser(channel, migrationState.metaDir);
    const planner = new TransformationPlanner(channel, migrationState.metaDir);
    
    // Get paths from migration state
    const workspacePath = migrationState.workspacePath;
    const metaDir = migrationState.metaDir;
    const commitMessage = migrationState.commitMessage;
    
    channel.appendLine(`[MIGRATION] Resuming migration for workspace: ${workspacePath}`);
    
    // 2) gradleParser: parse build files
    channel.appendLine('[MIGRATION] Step 2: Starting gradleParser...');
    vscode.window.showInformationMessage('gradleParser: Parsing Gradle build files...');
    telemetry.info('gradleParser_parse_start_resumed', { workspacePath });
    
    const parseOutput = await gradleParser.parseProject(workspacePath);
    const parsePath = path.join(metaDir, 'gradle-ast.json');
    fs.writeFileSync(parsePath, JSON.stringify(parseOutput, null, 2));
    channel.appendLine(`[MIGRATION] Step 2 completed: gradle-ast.json written to ${parsePath}`);
    telemetry.info('gradleParser_parse_done_resumed', { outputPath: parsePath });

    // 3) transformationPlanner: plan unified diff patches
    channel.appendLine('[MIGRATION] Step 3: Starting transformationPlanner...');
    vscode.window.showInformationMessage('transformationPlanner: Generating migration patches...');
    telemetry.info('planner_generate_start_resumed');
    
    const planResult = await planner.generatePatches(parseOutput, workspacePath);
    const patchPath = path.join(metaDir, 'patches.diff');
    fs.writeFileSync(patchPath, planResult.patchText);
    channel.appendLine(`[MIGRATION] Step 3 completed: patches.diff written to ${patchPath}`);
    telemetry.info('planner_generate_done_resumed', { patchPath, filesChanged: planResult.filesChanged.length, riskSummary: planResult.riskSummary });

    // 4) Ask user to review and commit changes
    channel.appendLine('[MIGRATION] Step 4: Migration changes ready for review');
    const summary = `Migration complete.\nFiles changed: ${planResult.filesChanged.join(', ') || 'None'}\nRisk scores: ${planResult.riskSummary}\nPatches: ${patchPath}\n\nNext steps:\n1. Review the changes in your working directory\n2. Test the migration (e.g., ./gradlew build)\n3. Commit and push when ready`;
    channel.appendLine(summary);
    
    // Show user options for next steps
    const action = await vscode.window.showInformationMessage(
      'Gradle Migration complete! Files have been modified in your working directory.',
      'Review Changes',
      'Apply Patches',
      'Open Terminal'
    );
    
    if (action === 'Review Changes') {
      // Open the Source Control view to show changes
      vscode.commands.executeCommand('workbench.view.scm');
    } else if (action === 'Apply Patches') {
      // Apply patches using git apply
      try {
        channel.appendLine('[MIGRATION] Applying patches via git apply...');
        telemetry.info('gitAgent_commit_start_resumed', { patchPath });
        const commitRes = await gitAgent.applyCommitAndPush({ patchPath, commitMessage });
        channel.appendLine(`[MIGRATION] Patches applied and changes committed`);
        telemetry.info('gitAgent_commit_done_resumed', commitRes);
        vscode.window.showInformationMessage('Migration patches applied and committed successfully!');
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        channel.appendLine(`[MIGRATION] Error applying patches: ${errorMsg}`);
        vscode.window.showErrorMessage(`Failed to apply patches: ${errorMsg}`);
      }
    } else if (action === 'Open Terminal') {
      // Open terminal for manual testing
      vscode.commands.executeCommand('workbench.action.terminal.new');
    }

    // Clean up state file
    const stateFile = path.join(metaDir, 'migration-state.json');
    try {
      fs.unlinkSync(stateFile);
      channel.appendLine('[MIGRATION] Cleaned up migration state file');
    } catch {}

    // Summary
    const resumeSummary = `Migration complete (resumed).\nWorkspace: ${workspacePath}\nFiles changed: ${planResult.filesChanged.join(', ') || 'None'}\nRisk scores: ${planResult.riskSummary}\nNext steps: Run Gradle tasks in VS Code terminal (e.g., ./gradlew build).`;
    channel.appendLine(resumeSummary);
    vscode.window.showInformationMessage('Gradle Migration Automator: Migration complete (resumed). Check output channel for summary.');
    
  } catch (err) {
    telemetry.error('workflow_resume_error', err);
    const message = err instanceof Error ? err.message : String(err);
    channel.appendLine(`[MIGRATION] Resume error: ${message}`);
    vscode.window.showErrorMessage(`Gradle Migration Automator (resume): ${message}`);
  }
}

export function deactivate() {}
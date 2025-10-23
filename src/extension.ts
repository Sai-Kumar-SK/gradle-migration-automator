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
    const payload = { time: new Date().toISOString(), event, level: 'info', ...details };
    this.channel.appendLine(`[telemetry] ${JSON.stringify(payload)}`);
  }
  public error(event: string, err: unknown, details?: any) {
    const payload = { time: new Date().toISOString(), event, level: 'error', error: String(err), ...details };
    this.channel.appendLine(`[telemetry] ${JSON.stringify(payload)}`);
  }
}

export async function activate(context: vscode.ExtensionContext) {
  const channel = vscode.window.createOutputChannel('Gradle Migration Automator');
  const telemetry = new Telemetry(channel);

  const migrateCmd = vscode.commands.registerCommand('gradle-migration-automator.migrate', async () => {
    try {
      channel.show(true);
      vscode.window.showInformationMessage('Gradle Migration Automator: Starting migration workflow...');
      telemetry.info('workflow_start');

      const gitUrl = await vscode.window.showInputBox({ prompt: 'Git URL of the repository', ignoreFocusOut: true });
      if (!gitUrl) { throw new Error('Git URL is required'); }

      const baseBranch = await vscode.window.showInputBox({ prompt: 'Base branch name (e.g., main)', ignoreFocusOut: true, value: 'main' });
      if (!baseBranch) { throw new Error('Base branch is required'); }

      const commitMessage = await vscode.window.showInputBox({ prompt: 'Commit message for migration changes', ignoreFocusOut: true, value: 'chore: migrate Nexus to JFrog Artifactory' });
      if (!commitMessage) { throw new Error('Commit message is required'); }

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || path.join(process.cwd(), 'workspace');
      const metaDir = path.join(workspaceRoot, '.copilot', 'meta');
      fs.mkdirSync(metaDir, { recursive: true });

      // Initialize participants (dependency injection style)
      const gitAgent = new GitAgent(channel, metaDir);
      const gradleParser = new GradleParser(channel, metaDir);
      const planner = new TransformationPlanner(channel, metaDir);

      // 1) gitAgent: clone and prepare workspace/branch
      vscode.window.showInformationMessage('gitAgent: Cloning repository and preparing branch...');
      telemetry.info('gitAgent_clone_start', { gitUrl, baseBranch });
      const gitResult = await gitAgent.cloneAndPrepare({ gitUrl, baseBranch });
      telemetry.info('gitAgent_clone_done', gitResult);

      // Open the cloned repo as workspace folder if not already open
      const repoFolder = vscode.Uri.file(gitResult.workspacePath);
      if (!vscode.workspace.workspaceFolders?.some(f => f.uri.fsPath === gitResult.workspacePath)) {
        await vscode.workspace.updateWorkspaceFolders(0, null, { uri: repoFolder });
      }

      // 2) gradleParser: parse build files
      vscode.window.showInformationMessage('gradleParser: Parsing Gradle build files...');
      telemetry.info('gradleParser_parse_start', { repo: gitResult.repo, branch: gitResult.branch });
      const parseOutput = await gradleParser.parseProject(gitResult.workspacePath);
      const parsePath = path.join(metaDir, 'gradle-ast.json');
      fs.writeFileSync(parsePath, JSON.stringify(parseOutput, null, 2));
      telemetry.info('gradleParser_parse_done', { outputPath: parsePath });

      // 3) transformationPlanner: plan unified diff patches
      vscode.window.showInformationMessage('transformationPlanner: Generating migration patches...');
      telemetry.info('planner_generate_start');
      const planResult = await planner.generatePatches(parseOutput, gitResult.workspacePath);
      const patchPath = path.join(metaDir, 'patches.diff');
      fs.writeFileSync(patchPath, planResult.patchText);
      telemetry.info('planner_generate_done', { patchPath, filesChanged: planResult.filesChanged.length, riskSummary: planResult.riskSummary });

      // 4) gitAgent: apply patch, commit, and push
      vscode.window.showInformationMessage('gitAgent: Applying patches, committing, and pushing...');
      telemetry.info('gitAgent_commit_start', { patchPath });
      const commitRes = await gitAgent.applyCommitAndPush({ patchPath, commitMessage });
      telemetry.info('gitAgent_commit_done', commitRes);

      // Summary
      const summary = `Migration complete.\nRepo: ${gitResult.repo}\nBranch: ${gitResult.branch}\nFiles changed: ${planResult.filesChanged.join(', ') || 'None'}\nRisk scores: ${planResult.riskSummary}\nNext steps: Run Gradle tasks in VS Code terminal (e.g., ./gradlew build).`;
      channel.appendLine(summary);
      vscode.window.showInformationMessage('Gradle Migration Automator: Migration complete. Check output channel for summary.');
    } catch (err) {
      telemetry.error('workflow_error', err);
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Gradle Migration Automator: ${message}`);
    }
  });

  context.subscriptions.push(migrateCmd, channel);
}

export function deactivate() {}
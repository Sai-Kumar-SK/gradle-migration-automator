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

  // Register chat participants if API is available
  const chat: any = (vscode as any).chat;
  if (chat && typeof chat.createChatParticipant === 'function') {
    const gitAgentParticipant = chat.createChatParticipant('gitAgent', async (request: any) => {
      channel.show(true);
      telemetry.info('chat_gitAgent_invoked');
      const text = String(request?.prompt ?? request?.message ?? '');
      try {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        const metaDir = path.join(workspaceRoot, '.copilot', 'meta');
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
        const metaDir = path.join(workspaceRoot, '.copilot', 'meta');
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

    const plannerParticipant = chat.createChatParticipant('transformationPlanner', async (_request: any) => {
      channel.show(true);
      telemetry.info('chat_transformationPlanner_invoked');
      try {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        const metaDir = path.join(workspaceRoot, '.copilot', 'meta');
        fs.mkdirSync(metaDir, { recursive: true });
        const gitMetaPath = path.join(metaDir, 'gitAgent.json');
        let workspacePath = workspaceRoot;
        try { workspacePath = JSON.parse(fs.readFileSync(gitMetaPath, 'utf-8')).workspacePath || workspacePath; } catch {}
        const astPath = path.join(metaDir, 'gradle-ast.json');
        let ast: any = undefined;
        try { ast = JSON.parse(fs.readFileSync(astPath, 'utf-8')); } catch {}
        const planner = new TransformationPlanner(channel, metaDir);
        const plan = await planner.generatePatches(ast, workspacePath);
        fs.writeFileSync(path.join(metaDir, 'patches.diff'), plan.patchText);
        fs.writeFileSync(path.join(metaDir, 'planner.json'), JSON.stringify({ filesChanged: plan.filesChanged, riskSummary: plan.riskSummary }, null, 2));
      } catch (err) {
        telemetry.error('chat_transformationPlanner_error', err);
      }
    }, { name: 'transformationPlanner', description: 'Generate Artifactory migration patches and risk summary.' });
    context.subscriptions.push(plannerParticipant);
  } else {
    channel.appendLine('[info] Chat Participants API not available; using command workflow.');
  }

  const migrateCmd = vscode.commands.registerCommand('gradle-migration-automator.migrate', async () => {
    try {
      channel.show(true);
      vscode.window.showInformationMessage('Gradle Migration Automator: Starting migration workflow...');
      telemetry.info('workflow_start');

      const gitUrl = await vscode.window.showInputBox({ prompt: 'Git URL of the repository', ignoreFocusOut: true });
      if (!gitUrl) { throw new Error('Git URL is required'); }

      const baseBranch = await vscode.window.showInputBox({ prompt: 'Base branch name (e.g., master)', ignoreFocusOut: true, value: 'master' });
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
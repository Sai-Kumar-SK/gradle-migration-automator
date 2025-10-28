import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';

function run(cmd: string, cwd?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = exec(cmd, { cwd }, (error, stdout, stderr) => {
      resolve({ code: error ? (error as any).code ?? 1 : 0, stdout, stderr });
    });
  });
}

export interface GitAgentCloneParams { gitUrl: string; baseBranch: string; }
export interface GitAgentCloneResult { repo: string; branch: string; workspacePath: string; status: 'ready' | 'error'; }
export interface GitAgentCommitParams { patchPath: string; commitMessage: string; }

export class GitAgent {
  constructor(private channel: vscode.OutputChannel, private metaDir: string) {}

  /**
   * Clone repo, checkout base branch, create migration branch.
   */
  async cloneAndPrepare(params: GitAgentCloneParams): Promise<GitAgentCloneResult> {
    const { gitUrl, baseBranch } = params;
    const repoName = path.basename(gitUrl.replace(/\.git$/, ''));
    const workspaceRoot = path.resolve(path.join(this.metaDir, '..', '..'));
    
    // Debug logging
    this.channel.appendLine(`[gitAgent] Debug: metaDir = ${this.metaDir}`);
    this.channel.appendLine(`[gitAgent] Debug: workspaceRoot = ${workspaceRoot}`);
    this.channel.appendLine(`[gitAgent] Debug: repoName = ${repoName}`);
    
    // Check if workspace is empty or contains git repo
    const isGitRepo = fs.existsSync(path.join(workspaceRoot, '.git'));
    const allFiles = fs.readdirSync(workspaceRoot);
    const isEmpty = allFiles.length === 0;
    
    this.channel.appendLine(`[gitAgent] Debug: isGitRepo = ${isGitRepo}, isEmpty = ${isEmpty}`);
    this.channel.appendLine(`[gitAgent] Debug: files in workspace = ${JSON.stringify(allFiles)}`);

    let workspacePath: string;

    // Clone
    if (!isGitRepo && isEmpty) {
      // Clone into current directory if it's empty
      workspacePath = workspaceRoot;
      this.channel.appendLine(`[gitAgent] Cloning ${gitUrl} -> ${workspacePath}`);
      let res = await run(`git clone ${gitUrl} .`, workspacePath);
      if (res.code !== 0) throw new Error(`git clone failed: ${res.stderr}`);
    } else if (isGitRepo) {
      // Use existing git repo
      workspacePath = workspaceRoot;
      this.channel.appendLine(`[gitAgent] Git repo already exists at ${workspacePath}`);
      // Fetch latest changes
      let res = await run(`git fetch origin`, workspacePath);
      if (res.code !== 0) this.channel.appendLine(`[gitAgent] Warning: git fetch failed: ${res.stderr}`);
    } else {
      // Clone into subdirectory if workspace is not empty and not a git repo
      const workspaceDir = path.join(workspaceRoot, 'workspace');
      workspacePath = path.join(workspaceDir, repoName);
      this.channel.appendLine(`[gitAgent] Workspace not empty, cloning ${gitUrl} -> ${workspacePath}`);
      
      // Remove existing directory if it exists
      if (fs.existsSync(workspacePath)) {
        fs.rmSync(workspacePath, { recursive: true, force: true });
        this.channel.appendLine(`[gitAgent] Removed existing directory: ${workspacePath}`);
      }
      
      // Ensure parent directory exists
      fs.mkdirSync(workspaceDir, { recursive: true });
      
      // Clone into the workspace directory with the repo name as target folder
      let res = await run(`git clone ${gitUrl} ${repoName}`, workspaceDir);
      if (res.code !== 0) throw new Error(`git clone failed: ${res.stderr}`);
    }

    // Checkout base branch
    let res = await run(`git checkout ${baseBranch}`, workspacePath);
    if (res.code !== 0) throw new Error(`git checkout failed: ${res.stderr}`);

    // Create migration branch
    const migrationBranch = `feature/artifactory-migration-${Date.now()}`;
    res = await run(`git checkout -b ${migrationBranch}`, workspacePath);
    if (res.code !== 0) throw new Error(`git branch create failed: ${res.stderr}`);

    // Ensure .copilot/ is excluded from commits in this repo
    try {
      const gitExcludePath = path.join(workspacePath, '.git', 'info', 'exclude');
      fs.mkdirSync(path.dirname(gitExcludePath), { recursive: true });
      const excludeLine = '.copilot/\n';
      let existing = '';
      try { existing = fs.readFileSync(gitExcludePath, 'utf-8'); } catch {}
      if (!existing.includes('.copilot/')) {
        fs.appendFileSync(gitExcludePath, excludeLine);
        this.channel.appendLine('[gitAgent] Added .copilot/ to .git/info/exclude');
      }
    } catch (e) {
      this.channel.appendLine(`[gitAgent] Warning: could not update .git/info/exclude: ${String(e)}`);
    }

    const output = { repo: repoName, branch: migrationBranch, workspacePath, status: 'ready' as const };
    fs.writeFileSync(path.join(this.metaDir, 'gitAgent.json'), JSON.stringify(output, null, 2));
    return output;
  }

  /**
   * Apply unified diff patch via git apply, commit, and push.
   */
  async applyCommitAndPush(params: GitAgentCommitParams): Promise<{ pushed: boolean; remote: string }>{
    const meta = JSON.parse(fs.readFileSync(path.join(this.metaDir, 'gitAgent.json'), 'utf-8')) as GitAgentCloneResult;
    const cwd = meta.workspacePath;

    // Apply patch
    this.channel.appendLine(`[gitAgent] Applying patch ${params.patchPath}`);
    let res = await run(`git apply "${params.patchPath}"`, cwd);
    if (res.code !== 0) throw new Error(`git apply failed: ${res.stderr}`);

    // Stage changes, excluding .copilot/*
    res = await run(`git add -A`, cwd);
    if (res.code !== 0) throw new Error(`git add failed: ${res.stderr}`);
    // Defensive unstage in case .git/info/exclude was not respected
    await run(`git reset HEAD -- .copilot`, cwd);

    // Commit
    res = await run(`git commit -m "${params.commitMessage}"`, cwd);
    if (res.code !== 0) throw new Error(`git commit failed: ${res.stderr}`);

    // Push
    res = await run(`git push --set-upstream origin ${meta.branch}`, cwd);
    if (res.code !== 0) throw new Error(`git push failed: ${res.stderr}`);

    const remote = (await run('git remote get-url origin', cwd)).stdout.trim();
    return { pushed: true, remote };
  }
}
# Usage: Gradle Migration Automator

This guide shows two ways to run migrations from Nexus OSS to JFrog Artifactory:
- Command Palette workflow (guided, one-click)
- Copilot Chat workflow using the three custom chat participants with curated prompts

The extension leaves Gradle task execution (build/clean/publish) to the VS Code terminal.

## Prerequisites
- Git installed and available in `PATH`
- VS Code 1.93+ with Copilot Chat
- GitHub Copilot extension (for AI-enhanced generation)
- Network access to your Git remote
- An Artifactory repository and URL to target
- **ops_server reference project**: Must be available in `.copilot/meta/ops_server/` folder for migration context

## AI Model Selection

The extension automatically uses the best available Copilot model, with preference for **GPT-4.1** (gpt-4o) over GPT-4.0 (gpt-4).

**To check which model is being used:**
1. Open the Output Channel (`View > Output`)
2. Select "Gradle Migration Automator" from the dropdown
3. Look for model selection logs:
   ```
   [transformationPlanner] ✓ Auto-selected: Copilot (GPT-4o) (GPT-4.1)
   ```

**To manually set your preferred model:**
Use the `@transformationPlanner` participant in Copilot Chat:
```
@transformationPlanner setPreferredModel gpt-4o
```
or
```
@transformationPlanner setPreferredModel gpt-4
```

This ensures you're using GPT-4.1 for the most accurate Gradle migration analysis and code generation.

## Quick Start (Command Palette)
1. Open VS Code.
2. Run `Migrate Gradle Project to Artifactory` from the Command Palette.
3. Provide:
   - Git URL: e.g. `https://github.com/acme/gradle-repo.git`
   - Base branch: e.g. `main`
   - Commit message: e.g. `chore: migrate Nexus to JFrog Artifactory`
4. The extension will:
   - Clone and prepare a migration branch
   - Parse Gradle build files to JSON
   - Generate unified diffs to replace Nexus with Artifactory
   - Apply the patch, commit, and push
5. Check the Output Channel for summary and `.copilot/meta` for artifacts.
6. Open the VS Code terminal and run Gradle tasks, e.g. `./gradlew clean build publish`.

## Copilot Chat Workflow (Participants + Prompts)
The extension defines three chat participants. You can run them step-by-step for transparency and control.

Participants:
- `gitAgent` — clone, checkout, branch, commit, push
- `gradleParser` — parse Gradle build files (Groovy/Kotlin DSL)
- `transformationPlanner` — design unified-diff patches and risk levels

Artifacts are written to `.copilot/meta/`:
- `gitAgent.json` — `{ repo, branch, workspacePath, status }`
- `gradle-ast.json` — normalized Gradle model
- `patches.diff` — unified diffs for `git apply`
- `planner.json` — files changed and risk summary

### Step 1: gitAgent Prompt
Switch Copilot Chat to `gitAgent` participant and paste:

```
Clone the repository and prepare a migration branch.

Inputs:
- gitUrl: https://github.com/<org>/<repo>.git
- baseBranch: main

Actions:
- Clone the repo to a local workspace path
- Checkout the base branch
- Create a new branch: feature/artifactory-migration-<timestamp>
- Do not modify build logic

Output JSON:
{ "repo": "<repo-name>", "branch": "<branch-name>", "workspacePath": "<abs-path>", "status": "ready" }

Write the output to .copilot/meta/gitAgent.json
```

### Step 2: gradleParser Prompt
Switch to `gradleParser` and paste (use `workspacePath` from the previous step):

```
Parse Gradle files in the workspace.

Inputs:
- projectRoot: <abs-workspacePath-from-gitAgent>

Tasks:
- Scan build.gradle(.kts) and settings.gradle(.kts)
- Extract plugin IDs, repository definitions (including URLs), publishing configuration
- Detect references to Nexus/Sonatype

Output JSON (normalized):
{ "modules": [ { "path": "<submodule-or-.">, "dsl": "groovy|kotlin|unknown", "plugins": [...], "repositories": [...], "publishing": { ... } | null, "nexusReferences": true|false, "files": ["<relative-gradle-file>"] } ] }

Write the output to .copilot/meta/gradle-ast.json and show a summary in chat.
```

### Step 3: transformationPlanner Prompt
Switch to `transformationPlanner` and paste (point to Artifactory URL):

```
Generate migration patches from Nexus to Artifactory.

Inputs:
- gradleAstPath: ./.copilot/meta/gradle-ast.json
- projectRoot: <abs-workspacePath-from-gitAgent>
- artifactoryUrl: https://artifactory.example.com/artifactory/libs-release

Tasks:
- For modules referencing Nexus/Sonatype, replace repository/publishing URLs with Artifactory equivalents
- Preserve syntax style and indentation
- Classify risk: low|medium|high per file based on publishing blocks and unknown patterns

Outputs:
- Unified diff patches in a single file: ./.copilot/meta/patches.diff
- Risk summary and changed files: ./.copilot/meta/planner.json
- Display a textual summary: files changed and risk counts
```

### Step 4: gitAgent Commit & Push Prompt
Switch back to `gitAgent` and paste:

```
Apply the generated patches, commit, and push.

Inputs:
- patchPath: ./.copilot/meta/patches.diff
- commitMessage: "chore: migrate Nexus to JFrog Artifactory"

Tasks:
- Apply the patch via git apply
- Stage changes (git add -A)
- Commit with the provided message
- Push the branch to origin and set upstream

Display the remote URL and branch name.
```

### Step 5: Run Gradle Tasks (Terminal)
Open the VS Code terminal and run:

```
./gradlew clean
./gradlew build
./gradlew publish
```

Use the default VS Code terminal executor; the extension does not run Gradle tasks.

## Prompt Templates (Copy/Paste)
You can use these parameterized templates directly in Copilot Chat.

- gitAgent (clone & branch):
```
Clone: <GIT_URL>
Base: <BASE_BRANCH>
Output JSON to .copilot/meta/gitAgent.json and do not touch build files.
```

- gradleParser (parse):
```
Parse Gradle under <WORKSPACE_PATH> and write normalized JSON to .copilot/meta/gradle-ast.json.
Include plugins[], repositories[], publishing{}, nexusReferences.
```

- transformationPlanner (patch):
```
Use .copilot/meta/gradle-ast.json and <WORKSPACE_PATH>.
Generate unified diffs into .copilot/meta/patches.diff targeting <ARTIFACTORY_URL>.
Classify risk and write .copilot/meta/planner.json.
```

- gitAgent (commit & push):
```
Apply .copilot/meta/patches.diff, commit with "<COMMIT_MESSAGE>", push branch to origin.
```

## Configuration
- Replace the placeholder Artifactory URL with your actual endpoint and repository path.
- If your environment requires authentication in Gradle, review your publishing credentials block after migration.

## Logging and Artifacts
- Output Channel: "Gradle Migration Automator" — telemetry and progress
- `.copilot/meta/` — all intermediate JSON and diff files

## Troubleshooting
- Git authentication: ensure your credentials/SSH keys are configured
- Patch failures: check `.copilot/meta/patches.diff` formatting and working tree state
- Line endings on Windows: if patch application fails, consider `git config core.autocrlf false` or re-create patches on Windows
- Complex Gradle logic: refine `transformationPlanner` rules or manually adjust generated diffs

## Next Steps
- Open a PR with the migration branch
- Run CI against the branch using your standard pipeline
- Iterate on patches if tests reveal integration nuances
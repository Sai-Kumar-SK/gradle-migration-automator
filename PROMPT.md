# Copilot Agent Mode Prompts

This file provides a minimal single prompt for end-to-end migration and an extended version with best-practices that Copilot should consider when orchestrating the participants.

## Default Minimal Migration Prompt (Copy/Paste)
Use this single prompt in Copilot Agent Mode. It should automatically chain participants: `gitAgent → gradleParser → transformationPlanner → gitAgent(commit)`.

```
Migrate our Gradle project from Nexus/Sonatype to JFrog Artifactory using chat participants in sequence:

Inputs:
- gitUrl: <GIT_URL>
- baseBranch: <BASE_BRANCH>
- commitMessage: <COMMIT_MESSAGE>
- artifactoryUrl: <ARTIFACTORY_URL>

Requirements:
- Chain participants: gitAgent → gradleParser → transformationPlanner → gitAgent(commit).
- Save all artifacts to ./.copilot/meta/ (gitAgent.json, gradle-ast.json, patches.diff, planner.json).
- Preserve Gradle DSL style (Groovy/Kotlin) and indentation.
- Do not run Gradle tasks; I will run them in the terminal.
- Only change repository/publishing endpoints and related Nexus/Sonatype configs.
- Classify risks per file (low|medium|high) and produce a summary.
- Apply unified diff with git apply, commit, and push the feature branch.
- Return: repo, branch, workspacePath, files changed, risk summary, and remote URL.

Output:
- A concise final report including next steps to run `./gradlew clean build publish`.
```

Replace values:
- `<GIT_URL>` e.g. `https://github.com/acme/gradle-repo.git`
- `<BASE_BRANCH>` e.g. `main`
- `<COMMIT_MESSAGE>` e.g. `chore: migrate Nexus to JFrog Artifactory`
- `<ARTIFACTORY_URL>` e.g. `https://artifactory.example.com/artifactory/libs-release`

---

## Extended Prompt with Best Practices
Use this version if you want Copilot to be extra explicit about constraints, logging, and edge cases.

```
You are orchestrating three chat participants for Gradle migration: gitAgent → gradleParser → transformationPlanner → gitAgent(commit).

Inputs:
- gitUrl: <GIT_URL>
- baseBranch: <BASE_BRANCH>
- commitMessage: <COMMIT_MESSAGE>
- artifactoryUrl: <ARTIFACTORY_URL>

Orchestration Steps:
1) gitAgent:
   - Clone the repo locally, checkout <BASE_BRANCH>, and create feature/artifactory-migration-<timestamp>.
   - Output JSON: { repo, branch, workspacePath, status: "ready" } to ./.copilot/meta/gitAgent.json.
   - Do not modify build logic.

2) gradleParser:
   - Parse build.gradle(.kts) and settings.gradle(.kts) under workspacePath.
   - Emit normalized JSON: { modules: [{ path, dsl, plugins[], repositories[], publishing{}, nexusReferences, files[] }] } to ./.copilot/meta/gradle-ast.json.
   - Read-only; surface a short summary of modules and any Nexus/Sonatype references.

3) transformationPlanner:
   - Use the AST to generate unified diff patches that replace Nexus/Sonatype URLs with <ARTIFACTORY_URL> for repositories and publishing blocks.
   - Preserve Groovy/Kotlin DSL style and indentation.
   - Classify risks: low (simple repo URLs), medium (publishing blocks), high (unrecognized patterns / no changes despite Nexus refs).
   - Write ./.copilot/meta/patches.diff and ./.copilot/meta/planner.json (filesChanged[], riskSummary).

4) gitAgent (commit & push):
   - Apply ./.copilot/meta/patches.diff via `git apply` in the workspacePath.
   - `git add -A`, commit with <COMMIT_MESSAGE>, and push branch to origin (set upstream).
   - Report the remote URL and branch name.

Behavior & Safety:
- Isolation: gitAgent has network + file I/O; gradleParser is read-only; transformationPlanner is local read/write only.
- Logging: Stream concise progress to the Output Channel and write meta files to ./.copilot/meta.
- Do not run Gradle tasks; the user will run them in VS Code terminal.
- Avoid unrelated build changes; preserve existing plugin/publishing semantics.
- Handle Windows line endings if patches fail (note potential CRLF issues).

Final Output:
- Summary with repo, branch, workspacePath, files changed, risk counts, and next steps: run `./gradlew clean build publish` and open a PR.
```

Notes:
- If the repo already exists locally, reuse it by checking out the base branch and creating a fresh feature branch.
- Update `<ARTIFACTORY_URL>` to your actual endpoint before running CI.
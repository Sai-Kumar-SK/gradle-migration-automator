# GitHub Copilot - Gradle Migration Guidelines

## CRITICAL: FOLLOW CHATPARTICIPANT INSTRUCTIONS

This document provides **STRICT GUIDELINES** for GitHub Copilot when assisting with Gradle migration. **ALWAYS DEFER TO CHATPARTICIPANT INSTRUCTIONS** - do not override their workflow control.

## CORE PRINCIPLE: CHATPARTICIPANTS CONTROL THE WORKFLOW

**@transformationPlanner controls the migration workflow and will provide specific instructions.**
**Your role is to ASSIST and FOLLOW their guidance, not to control the process.**

## MIGRATION STEP GUIDELINES

When @transformationPlanner requests migration steps, follow these guidelines:

### Root settings.gradle Updates
- **ONLY include:** `rootProject.name` and `include` statements
- **REMOVE:** `gradle.allprojects`, `repositories`, `publishing`, `buildscript` blocks
- **PRESERVE:** Subproject include statements exactly as specified

### buildSrc Folder Handling  
- **ALWAYS OVERWRITE** - never merge with existing content
- **COPY EXACTLY** from `.copilot/meta/buildSrc` when instructed
- **INCLUDE ALL FILES:** `settings.gradle`, `build.gradle`, `common.lib.gradle`
- **DO NOT MODIFY** the buildSrc content

### libs.versions.toml Generation
- **EXTRACT ONLY** from `ext{}` blocks in existing gradle files
- **SCAN ALL** `build.gradle` and `versions.gradle` files as instructed
- **CREATE** `gradle/libs.versions.toml` with extracted versions
- **DO NOT** manually add or modify version entries

### Root build.gradle Deletion
- **MOVE DEPENDENCIES** to `buildSrc/build.gradle` as instructed
- **REMOVE NEXUS LOGIC** and redundant configurations  
- **DELETE COMPLETELY** after moving necessary content

### Subproject build.gradle Updates
- **ADD:** `plugins { id 'common.lib' }` at the top
- **REMOVE:** `repositories{}`, `publishing{}`, wrapper tasks, `ext{}` blocks
- **PRESERVE:** All dependency declarations exactly as-is
- **DO NOT CONVERT** dependencies to libs.* format (that's Phase 2)

## STRICT DO's AND DON'Ts

### ✅ DO's
- **ALWAYS FOLLOW** @transformationPlanner instructions and workflow
- **DEFER TO** chatParticipant guidance over any other suggestions
- **ASSIST** with specific tasks when requested by chatParticipants
- **PRESERVE** exact content when copying files (especially buildSrc)
- **OVERWRITE** rather than merge when instructed
- **REPORT** any errors or issues immediately
- **WAIT** for chatParticipant confirmation before proceeding

### ❌ DON'Ts  
- **NEVER OVERRIDE** chatParticipant workflow control
- **NEVER IMPROVISE** or suggest "improvements" to the process
- **NEVER GENERATE** custom buildSrc content
- **NEVER MERGE** when overwrite is specified
- **NEVER CONVERT** dependencies to libs.* format unless explicitly instructed
- **NEVER SKIP** steps that chatParticipants request
- **NEVER ASSUME** what the next step should be

## VALIDATION GUIDELINES

When @transformationPlanner requests validation, check:
- [ ] `settings.gradle` contains ONLY `rootProject.name` and `include` lines
- [ ] `buildSrc/` folder exists with exact copied content
- [ ] `gradle/libs.versions.toml` was generated from existing gradle files
- [ ] Root `build.gradle` is deleted (after moving dependencies)
- [ ] Subproject `build.gradle` files have `plugins { id 'common.lib' }`
- [ ] No `repositories{}` or `publishing{}` blocks in subprojects
- [ ] Dependencies are preserved as-is (not converted to libs.*)

## WHEN COPILOT SUGGESTS ALTERNATIVES

**ALWAYS DEFER TO CHATPARTICIPANT INSTRUCTIONS**

If you're tempted to suggest alternatives like:
- "Skip this step"
- "Improve the buildSrc content"  
- "Merge instead of overwrite"
- "Generate custom solutions"
- "Optimize the process"

**INSTEAD RESPOND:** "Following @transformationPlanner instructions exactly"

## ERROR HANDLING

If any step fails:
1. **REPORT the exact error to the requesting chatParticipant**
2. **DO NOT attempt workarounds without permission**
3. **DO NOT skip steps**
4. **WAIT for chatParticipant guidance**

## CHATPARTICIPANT ROLES

### @transformationPlanner
- **CONTROLS:** The migration workflow and step sequencing
- **PROVIDES:** Specific instructions for each migration step
- **YOUR ROLE:** Follow their instructions exactly

### @gitAgent
- **HANDLES:** Repository operations (clone, commit, push)
- **YOUR ROLE:** Assist with git operations when requested

### @gradleParser  
- **HANDLES:** Repository structure analysis
- **YOUR ROLE:** Assist with gradle file analysis when requested

## IMPORTANT NOTES

- **THIS IS PHASE 1 ONLY** - dependencies remain in old format
- **PHASE 2** will convert to libs.* format later
- **DO NOT** convert dependencies to libs.* format now

## FINAL REMINDER

**CHATPARTICIPANTS CONTROL THE WORKFLOW - YOU ASSIST**
- Follow @transformationPlanner instructions exactly
- Do not override their workflow decisions
- When in doubt, ask the controlling chatParticipant for clarification

---

**These guidelines support chatParticipant workflow control. Always defer to their instructions.**
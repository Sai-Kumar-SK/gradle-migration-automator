# Copilot Instructions: Generate libs.versions.toml from Gradle Dependencies

## Overview
Generate a `libs.versions.toml` file by extracting all dependencies from `versions.gradle` and all `build.gradle` files in this Scala multi-module project. This file should follow Gradle Version Catalogs format and consolidate all dependency management in one place.

## Project Context
This is a Scala project with:
- **Multi-version Scala support**: 2.12.13, 2.13.5 (defined in gradle.properties)
- **Multi-module structure**: Root project + entitlements submodule
- **Version management**: Centralized in `versions.gradle`
- **Scala ecosystem**: ScalaTest, Scalatra, Monix, Cats, etc.

## Task Requirements

### 1. Scan All Files
- **Primary Sources**: 
  - `entitlements/versions.gradle` (contains version variables)
  - `entitlements/build.gradle` (root project)
  - `entitlements/entitlements/build.gradle` (subproject)
  - `entitlements/gradle.properties` (Scala versions)
- **Search Patterns**: Look for dependency declarations in:
  - `dependencies {}` blocks
  - `buildScript { dependencies {} }` blocks
  - Version variables in `ext {}` blocks

### 2. Extract Dependencies from Actual Codebase

#### From versions.gradle:
```gradle
ext {
    betterFilesVersion = '3.9.1'
    catsCoreVersion = '2.6.1'
    gradleMultiversionVersion = '1.0.37'
    gradleScalaTestVersion = '0.30'
    json4sVersion = '3.6.10'
    logbackVersion = '1.2.3'
    mockitoVersion = '2.22.0'
    monixVersion = '3.3.0'
    sttpVersion = '1.7.2'
    scalatraVersion = '2.7.1'
    scalaLoggingVersion = '3.9.5'
    scalaTestVersion = '3.2.3'
    scalaMockitoVersion = '1.16.25'
    scalaTestPlusVersion = '3.2.2.0'
    typeSafeConfigVersion = '1.4.1'
    zincVersion = '1.3.5'
}
```

#### From gradle.properties:
```properties
scalaVersions = 2.12.13, 2.13.5
```

#### From root build.gradle buildScript:
```gradle
buildScript {
    dependencies {
        classpath "com.bmuschko:gradle-nexus-plugin:2.3.1"
        classpath "gradle.plugin.com.github.maiflai:gradle-scalatest:$gradleScalaTestVersion"
        classpath "com.adtran:scala-multiversion-plugin:$gradleMultiversionVersion"
        classpath "org.springframework.build.gradle:propdeps-plugin:0.0.7"
        classpath "cz.augi:gradle-wartremover:0.13.2"
        classpath "com.github.ben-manes:gradle-versions-plugin:0.36.0"
    }
}
```

#### From allprojects dependencies:
```gradle
dependencies {
    compile "org.scala-lang:scala-library:$scalaVersion"
    compile "org.scala-lang:scala-reflect:$scalaVersion"
    testCompile "org.scalatest:scalatest_%%:$scalaTestVersion"
    testCompile "org.mockito:mockito-core:$mockitoVersion"
    testCompile "org.mockito:mockito-scala_%%:$scalaMockitoVersion"
}
```

#### From subproject dependencies:
```gradle
dependencies {
    compile "com.typesafe:config:$typesafeConfigVersion"
    compile "com.typesafe.scala-logging:scala-logging_2.13:$scalaLoggingVersion"
    compile "org.scalatra:scalatra_%%:$scalatraVersion"
    compile "org.scalatra:scalatra-json_%%:$scalatraVersion"
    compile "org.json4s:json4s-jackson_%%:$json4sVersion"
    compile "io.monix:monix-reactive_%%:$monixVersion"
    compile "com.softwaremill.sttp:core_%%:$sttpVersion"
    compile "org.typelevel:cats-core_%%:$catsCoreVersion"
    compile "com.github.pathikrit:better-files_%%:$betterFilesVersion"
    compile "ch.qos.logback:logback-classic:$logbackVersion"
    testCompile "org.scalatra:scalatra-scalatest_%%:$scalatraVersion"
}
```

### 3. Generate libs.versions.toml Structure

```toml
[versions]
# Scala versions
scala-212 = "2.12.13"
scala-213 = "2.13.5"

# Core library versions from versions.gradle
better-files = "3.9.1"
cats-core = "2.6.1"
json4s = "3.6.10"
logback = "1.2.3"
mockito = "2.22.0"
monix = "3.3.0"
sttp = "1.7.2"
scalatra = "2.7.1"
scala-logging = "3.9.5"
scalatest = "3.2.3"
scala-mockito = "1.16.25"
scalatest-plus = "3.2.2.0"
typesafe-config = "1.4.1"
zinc = "1.3.5"

# Build plugin versions
gradle-nexus-plugin = "2.3.1"
gradle-scalatest = "0.30"
gradle-multiversion = "1.0.37"
spring-propdeps = "0.0.7"
wartremover = "0.13.2"
gradle-versions = "0.36.0"

[libraries]
# Scala core libraries
scala-library-212 = { group = "org.scala-lang", name = "scala-library", version.ref = "scala-212" }
scala-library-213 = { group = "org.scala-lang", name = "scala-library", version.ref = "scala-213" }
scala-reflect-212 = { group = "org.scala-lang", name = "scala-reflect", version.ref = "scala-212" }
scala-reflect-213 = { group = "org.scala-lang", name = "scala-reflect", version.ref = "scala-213" }

# Core application libraries
typesafe-config = { group = "com.typesafe", name = "config", version.ref = "typesafe-config" }
scala-logging-213 = { group = "com.typesafe.scala-logging", name = "scala-logging_2.13", version.ref = "scala-logging" }
better-files-212 = { group = "com.github.pathikrit", name = "better-files_2.12", version.ref = "better-files" }
better-files-213 = { group = "com.github.pathikrit", name = "better-files_2.13", version.ref = "better-files" }

# Web framework
scalatra-212 = { group = "org.scalatra", name = "scalatra_2.12", version.ref = "scalatra" }
scalatra-213 = { group = "org.scalatra", name = "scalatra_2.13", version.ref = "scalatra" }
scalatra-json-212 = { group = "org.scalatra", name = "scalatra-json_2.12", version.ref = "scalatra" }
scalatra-json-213 = { group = "org.scalatra", name = "scalatra-json_2.13", version.ref = "scalatra" }

# JSON processing
json4s-jackson-212 = { group = "org.json4s", name = "json4s-jackson_2.12", version.ref = "json4s" }
json4s-jackson-213 = { group = "org.json4s", name = "json4s-jackson_2.13", version.ref = "json4s" }

# Reactive programming
monix-reactive-212 = { group = "io.monix", name = "monix-reactive_2.12", version.ref = "monix" }
monix-reactive-213 = { group = "io.monix", name = "monix-reactive_2.13", version.ref = "monix" }

# HTTP client
sttp-core-212 = { group = "com.softwaremill.sttp", name = "core_2.12", version.ref = "sttp" }
sttp-core-213 = { group = "com.softwaremill.sttp", name = "core_2.13", version.ref = "sttp" }

# Functional programming
cats-core-212 = { group = "org.typelevel", name = "cats-core_2.12", version.ref = "cats-core" }
cats-core-213 = { group = "org.typelevel", name = "cats-core_2.13", version.ref = "cats-core" }

# Logging
logback-classic = { group = "ch.qos.logback", name = "logback-classic", version.ref = "logback" }

# Testing libraries
scalatest-212 = { group = "org.scalatest", name = "scalatest_2.12", version.ref = "scalatest" }
scalatest-213 = { group = "org.scalatest", name = "scalatest_2.13", version.ref = "scalatest" }
mockito-core = { group = "org.mockito", name = "mockito-core", version.ref = "mockito" }
mockito-scala-212 = { group = "org.mockito", name = "mockito-scala_2.12", version.ref = "scala-mockito" }
mockito-scala-213 = { group = "org.mockito", name = "mockito-scala_2.13", version.ref = "scala-mockito" }
scalatra-scalatest-212 = { group = "org.scalatra", name = "scalatra-scalatest_2.12", version.ref = "scalatra" }
scalatra-scalatest-213 = { group = "org.scalatra", name = "scalatra-scalatest_2.13", version.ref = "scalatra" }

[bundles]
# Scala core for each version
scala-core-212 = ["scala-library-212", "scala-reflect-212"]
scala-core-213 = ["scala-library-213", "scala-reflect-213"]

# Web framework stack for each Scala version
scalatra-stack-212 = ["scalatra-212", "scalatra-json-212", "json4s-jackson-212"]
scalatra-stack-213 = ["scalatra-213", "scalatra-json-213", "json4s-jackson-213"]

# Testing stack for each Scala version
testing-212 = ["scalatest-212", "mockito-core", "mockito-scala-212", "scalatra-scalatest-212"]
testing-213 = ["scalatest-213", "mockito-core", "mockito-scala-213", "scalatra-scalatest-213"]

# Reactive programming stack
reactive-212 = ["monix-reactive-212", "cats-core-212"]
reactive-213 = ["monix-reactive-213", "cats-core-213"]

# Logging
logging = ["logback-classic", "scala-logging-213"]

[plugins]
# Build plugins
nexus = { id = "com.bmuschko.nexus", version.ref = "gradle-nexus-plugin" }
scalatest = { id = "com.github.maiflai.scalatest", version.ref = "gradle-scalatest" }
scala-multiversion = { id = "com.adtran.scala-multiversion-plugin", version.ref = "gradle-multiversion" }
spring-propdeps = { id = "org.springframework.build.gradle.propdeps-plugin", version.ref = "spring-propdeps" }
wartremover = { id = "cz.augi.gradle-wartremover", version.ref = "wartremover" }
versions = { id = "com.github.ben-manes.versions", version.ref = "gradle-versions" }
```

## Conversion Examples

### Handle Scala %% Notation
```gradle
// Original
compile "org.scalatest:scalatest_%%:$scalaTestVersion"
```
**Convert to:**
```toml
# Create entries for each Scala version
scalatest-212 = { group = "org.scalatest", name = "scalatest_2.12", version.ref = "scalatest" }
scalatest-213 = { group = "org.scalatest", name = "scalatest_2.13", version.ref = "scalatest" }
```

### Handle Multi-version Dependencies
```gradle
// Original versions.gradle
ext {
    scalaTestVersion = '3.2.3'
}
// gradle.properties
scalaVersions = 2.12.13, 2.13.5
```
**Convert to:**
```toml
[versions]
scalatest = "3.2.3"
scala-212 = "2.12.13"
scala-213 = "2.13.5"
```

### Handle BuildScript Dependencies
```gradle
// Original
buildScript {
    dependencies {
        classpath "com.bmuschko:gradle-nexus-plugin:2.3.1"
    }
}
```
**Convert to:**
```toml
[versions]
gradle-nexus-plugin = "2.3.1"

[plugins]
nexus = { id = "com.bmuschko.nexus", version.ref = "gradle-nexus-plugin" }
```

## Implementation Steps

1. **Parse versions.gradle**:
   - Extract all `ext {}` variables
   - Convert camelCase to kebab-case (e.g., `betterFilesVersion` → `better-files`)

2. **Parse gradle.properties**:
   - Extract `scalaVersions` and create separate version entries
   - Handle multi-version Scala support

3. **Scan all build.gradle files**:
   - Root project: `entitlements/build.gradle`
   - Subprojects: `entitlements/entitlements/build.gradle`
   - Extract all dependency declarations

4. **Handle Scala-specific patterns**:
   - Convert `%%` notation to explicit Scala version suffixes
   - Create separate entries for each supported Scala version
   - Group related dependencies in bundles

5. **Normalize dependency names**:
   - Use kebab-case consistently
   - Handle Scala version suffixes (_2.12, _2.13)
   - Create logical groupings

## Quality Checklist
- [ ] All versions from versions.gradle included
- [ ] Scala versions from gradle.properties handled
- [ ] All %% dependencies converted to explicit versions
- [ ] BuildScript classpath dependencies moved to plugins
- [ ] Multi-version Scala support maintained
- [ ] Bundles created for logical groupings
- [ ] Consistent kebab-case naming
- [ ] No duplicate entries

## Usage After Generation
After creating `libs.versions.toml`, update build.gradle files to use:
```gradle
dependencies {
    // For Scala 2.12
    implementation libs.bundles.scala.core.212
    implementation libs.bundles.scalatra.stack.212
    testImplementation libs.bundles.testing.212
        
    // For Scala 2.13  
    implementation libs.bundles.scala.core.213
    implementation libs.bundles.scalatra.stack.213
    testImplementation libs.bundles.testing.213
}

plugins {
    alias(libs.plugins.scala.multiversion)
    alias(libs.plugins.scalatest)
    alias(libs.plugins.nexus)
}
```

This approach maintains the multi-version Scala support while consolidating all dependency management in the version catalog.
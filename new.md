package com.example

import org.gradle.api.DefaultTask
import org.gradle.api.tasks.TaskAction
import org.gradle.api.artifacts.ExternalModuleDependency

class GenerateLibsTomlTask extends DefaultTask {
    @TaskAction
    void generate() {
        def allDependencies = [:] // Map of "group:artifact" -> version
        def versionKeys = [:]      // version -> ext key name

        // Extract ext properties for versions
        if (project.rootProject.ext.has("properties")) {
            project.rootProject.ext.properties.each { k, v ->
                if (v instanceof String && v ==~ /\d+\.\d+\.\d+.*/) {
                    versionKeys[v] = k
                }
            }
        }

        // Collect dependencies
        project.rootProject.allprojects.each { subproject ->
            subproject.configurations.each { config ->
                if (config.canBeResolved) {
                    config.dependencies.withType(ExternalModuleDependency).each { dep ->
                        def key = "${dep.group}:${dep.name}"
                        if (!allDependencies.containsKey(key)) {
                            allDependencies[key] = dep.version
                        }
                    }
                }
            }
        }

        def versionVars = [:]
        def versionIds = [:]
        def versionMap = [:]

        allDependencies.each { gav, ver ->
            def versionKey = versionKeys[ver] ?: generateVersionKey(gav)
            versionIds[gav] = versionKey
            versionMap[versionKey] = ver
        }

        def libsMap = [:]
        allDependencies.each { gav, ver ->
            def (group, name) = gav.split(":")
            def alias = generateAlias(group, name)
            def versionRef = versionIds[gav]
            libsMap[alias] = [module: "$group:$name", versionRef: versionRef]
        }

        def outputDir = new File(project.rootProject.projectDir, "gradle")
        outputDir.mkdirs()
        def outputFile = new File(outputDir, "libs.versions.toml")

        outputFile.withWriter { w ->
            w.writeLine("[versions]")
            versionMap.each { k, v ->
                w.writeLine("${k} = \"${v}\"")
            }
            w.writeLine("\n[libraries]")
            libsMap.each { alias, lib ->
                w.writeLine("${alias} = { module = \"${lib.module}\", version.ref = \"${lib.versionRef}\" }")
            }
        }

        println "Generated libs.versions.toml with ${libsMap.size()} libraries."
    }

    static String generateAlias(String group, String name) {
        def alias = name.replaceAll(/[^a-zA-Z0-9]/, "").toLowerCase()
        if (group.contains("springframework")) {
            alias = "spring${alias.capitalize()}"
        }
        return alias
    }

    static String generateVersionKey(String gav) {
        def (_, name) = gav.split(":")
        return "${name.replaceAll(/[^a-zA-Z0-9]/, "")}Version"
    }
}

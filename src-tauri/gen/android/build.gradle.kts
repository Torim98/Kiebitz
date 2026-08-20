buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:9.0.1")
        // Aktuelle Kotlin-Linie für GMA 25 und die Compose-basierten Widgets.
        // Tauri verwendet sie bis zur Built-in-Kotlin-Migration als Plugin.
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.2.21")
        // Jetpack Glance baut die Homescreen-Widgets aus Composables; ab
        // Kotlin 2.0 kommt der Compose-Compiler als eigenes Gradle-Plugin.
        classpath("org.jetbrains.kotlin:compose-compiler-gradle-plugin:2.2.21")
    }
}

allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

tasks.register("clean").configure {
    delete("build")
}


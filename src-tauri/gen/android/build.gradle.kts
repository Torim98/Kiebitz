buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:8.11.0")
        // GMA 24.9 setzt Kotlin 2.1 voraus. Die 2.1-Linie bleibt zugleich mit
        // den Gradle-Skripten der aktuellen Tauri-Version kompatibel.
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.1.21")
        // Jetpack Glance baut die Homescreen-Widgets aus Composables; ab
        // Kotlin 2.0 kommt der Compose-Compiler als eigenes Gradle-Plugin.
        classpath("org.jetbrains.kotlin:compose-compiler-gradle-plugin:2.1.21")
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


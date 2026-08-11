import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// Signierung der Release-APK. keystore.properties + keystore.jks sind gitignored
// und werden in CI aus Repo-Secrets erzeugt (siehe docs/DEPLOYMENT.md). Fehlen
// sie (lokaler Debug-Build), bleibt die Release-Signierung einfach ungesetzt.
val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreProperties = Properties().apply {
    if (keystorePropertiesFile.exists()) {
        keystorePropertiesFile.inputStream().use { load(it) }
    }
}

// Lokal kann das Play-AAB ohne Passwortdatei gebaut werden: Das PowerShell-
// Skript reicht die Werte nur für die Dauer des Build-Prozesses als Umgebung
// durch. CI kann weiterhin die bestehende keystore.properties verwenden.
fun signingValue(environmentName: String, propertyName: String): String? =
    System.getenv(environmentName)?.takeIf { it.isNotBlank() }
        ?: keystoreProperties.getProperty(propertyName)?.takeIf { it.isNotBlank() }

val releaseStoreFile = signingValue("ANDROID_KEYSTORE_PATH", "storeFile")
val releaseStorePassword = signingValue("ANDROID_KEYSTORE_PASSWORD", "storePassword")
val releaseKeyAlias = signingValue("ANDROID_KEY_ALIAS", "keyAlias")
val releaseKeyPassword = signingValue("ANDROID_KEY_PASSWORD", "keyPassword")
val releaseSigningConfigured = listOf(
    releaseStoreFile,
    releaseStorePassword,
    releaseKeyAlias,
    releaseKeyPassword,
).all { !it.isNullOrBlank() }

// Ohne Publisher-Konto bleiben Debug- und lokale Release-Builds sicher auf
// Googles offiziellen Test-IDs. CI bzw. Android Studio können die beiden Werte
// über Umgebungsvariablen oder Gradle-Properties ersetzen.
fun advertisingValue(environmentName: String, propertyName: String, fallback: String): String =
    System.getenv(environmentName)?.takeIf { it.isNotBlank() }
        ?: providers.gradleProperty(propertyName).orNull?.takeIf { it.isNotBlank() }
        ?: fallback

val admobAppId = advertisingValue(
    "KIEBITZ_ADMOB_APP_ID",
    "kiebitz.admob.appId",
    "ca-app-pub-3940256099942544~3347511713",
)
val admobBannerAdUnitId = advertisingValue(
    "KIEBITZ_ADMOB_BANNER_ID",
    "kiebitz.admob.bannerId",
    "ca-app-pub-3940256099942544/6300978111",
)

android {
    compileSdk = 36
    namespace = "de.torim.kiebitz"
    defaultConfig {
        // Der Geräte-Sync ist ausschließlich HTTPS; Android darf keinen
        // Cleartext-Verkehr für Kiebitz erlauben.
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        manifestPlaceholders["admobAppId"] = admobAppId
        buildConfigField("String", "ADMOB_BANNER_AD_UNIT_ID", "\"$admobBannerAdUnitId\"")
        applicationId = "de.torim.kiebitz"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    signingConfigs {
        if (releaseSigningConfigured) {
            create("release") {
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
                storeFile = rootProject.file(releaseStoreFile!!)
                storePassword = releaseStorePassword
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "false"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
            // Nur signieren, wenn alle vier Werte bereitstehen. Ohne bleibt das
            // Release-Artefakt lokal unsigniert und darf nicht zu Play.
            if (releaseSigningConfigured) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }
    buildFeatures {
        buildConfig = true
    }
    packaging {
        jniLibs {
            // Native Libs bei der Installation als echte Dateien entpacken
            // (extractNativeLibs=true): Kiebitz startet libstockfish.so als
            // Kindprozess — das geht nur mit einer Datei im nativeLibraryDir,
            // nicht mit aus dem APK gemappten Libs. Nebeneffekt: die Libs
            // dürfen im APK komprimiert liegen (kleineres APK).
            useLegacyPackaging = true
        }
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    implementation("com.google.android.play:review:2.0.2")
    // Aktuelle, unterstützte SDK-Linien; UMP wird vor der ersten Anzeigenanfrage
    // ausgeführt und stellt den nachträglichen Datenschutzdialog bereit.
    implementation("com.google.android.gms:play-services-ads:24.9.0")
    implementation("com.google.android.ump:user-messaging-platform:4.0.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_1_8)
    }
}

apply(from = "tauri.build.gradle.kts")

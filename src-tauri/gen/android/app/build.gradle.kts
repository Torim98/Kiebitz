import java.util.Properties
import groovy.json.JsonSlurper
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
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

@Suppress("UNCHECKED_CAST")
val androidPins = (
    JsonSlurper().parse(rootProject.file("../../../config/toolchain-pins.json"))
        as Map<String, Any>
    )["android"] as Map<String, Any>

fun androidPin(name: String): Int = (androidPins.getValue(name) as Number).toInt()

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

// Debug-Builds verwenden immer Googles offizielle Test-IDs. Release-Builds
// verwenden Kiebitz' veröffentlichte AdMob-IDs; CI bzw. Android Studio können
// diese bei Bedarf über Umgebungsvariablen oder Gradle-Properties ersetzen.
fun advertisingValue(environmentName: String, propertyName: String, fallback: String): String =
    System.getenv(environmentName)?.takeIf { it.isNotBlank() }
        ?: providers.gradleProperty(propertyName).orNull?.takeIf { it.isNotBlank() }
        ?: fallback

val testAdmobAppId = "ca-app-pub-3940256099942544~3347511713"
val testAdmobBannerAdUnitId = "ca-app-pub-3940256099942544/6300978111"
val releaseAdmobAppId = advertisingValue(
    "KIEBITZ_ADMOB_APP_ID",
    "kiebitz.admob.appId",
    "ca-app-pub-9343669245707846~7313498282",
)
val releaseAdmobBannerAdUnitId = advertisingValue(
    "KIEBITZ_ADMOB_BANNER_ID",
    "kiebitz.admob.bannerId",
    "ca-app-pub-9343669245707846/9496808496",
)

android {
    compileSdk = androidPin("compileSdk")
    namespace = "de.torim.kiebitz"
    defaultConfig {
        // Der Geräte-Sync ist ausschließlich HTTPS; Android darf keinen
        // Cleartext-Verkehr für Kiebitz erlauben.
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "de.torim.kiebitz"
        minSdk = androidPin("minSdk")
        targetSdk = androidPin("targetSdk")
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
        // Für den Widget-Layouttest: Er baut jede angemeldete Widgetgröße auf
        // einem Gerät wirklich auf und misst nach, ob der Inhalt hineinpasst.
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
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
            manifestPlaceholders["admobAppId"] = testAdmobAppId
            buildConfigField("String", "ADMOB_BANNER_AD_UNIT_ID", "\"$testAdmobBannerAdUnitId\"")
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
            manifestPlaceholders["admobAppId"] = releaseAdmobAppId
            buildConfigField("String", "ADMOB_BANNER_AD_UNIT_ID", "\"$releaseAdmobBannerAdUnitId\"")
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
    // Kiebitz Plus auf Android. Google Play verlangt für digitale Inhalte
    // innerhalb der App seinen eigenen Bezahlweg; der Stripe-Checkout bleibt
    // deshalb Desktop und Website vorbehalten.
    implementation("com.android.billingclient:billing-ktx:7.1.1")
    // Homescreen-Widgets. Glance ist der aktuelle Weg zu App-Widgets und
    // bringt responsive Größen, dynamische Farben und Deep-Link-Aktionen mit.
    implementation("androidx.glance:glance-appwidget:1.1.1")
    implementation("androidx.glance:glance-material3:1.1.1")
    // Aktuelle, unterstützte SDK-Linien; UMP wird vor der ersten Anzeigenanfrage
    // ausgeführt und stellt den nachträglichen Datenschutzdialog bereit.
    implementation("com.google.android.gms:play-services-ads:24.9.0")
    implementation("com.google.android.ump:user-messaging-platform:4.0.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test:runner:1.5.2")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_1_8)
    }
}

apply(from = "tauri.build.gradle.kts")

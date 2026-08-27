# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# tauri-plugin-notification 2.3.3 deserializes DateMatch through Jackson.
# The plugin declares a consumer-rules.pro file but does not ship it, so R8
# otherwise removes the no-argument constructor from release builds. Debug
# builds are unaffected because minification is disabled there.
-keep class app.tauri.notification.DateMatch {
    *;
}

# Jetpack Glance 1.1.1 pulls in Room 2.2.5. Room derives the generated
# `<Database>_Impl` class name and instantiates it through reflection. The
# dependency's consumer rule keeps the class name, but not its no-argument
# constructor, so optimized release builds otherwise crash in WorkManager's
# InitializationProvider before MainActivity starts.
-keepclassmembers class * extends androidx.room.RoomDatabase {
    <init>();
}

# One link further down the same WorkManager chain: every worker is merged with
# its InputMerger before it starts, and WorkManager creates that merger through
# Class.forName(...).newInstance(). The library's own consumer rule reads
# `-keep class * extends androidx.work.InputMerger` and therefore keeps only the
# class *name*; R8 in full mode still drops the unused default constructor. The
# release build then fails with "OverwritingInputMerger has no zero argument
# constructor", WorkerWrapper aborts, and not a single worker runs any more.
#
# That is fatal for the home screen widgets: Glance does not compose in the
# receiver but in `androidx.glance.session.SessionWorker`, a WorkManager worker.
# If it never runs, the widget never delivers RemoteViews and stays on its
# `initialLayout` forever (the card with the bird on it and nothing else).
# Debug builds are unaffected because they are not minified.
-keepclassmembers class * extends androidx.work.InputMerger {
    <init>();
}

# Firebase component discovery reads ML Kit registrar class names from the
# merged manifest and creates them through reflection. firebase-components
# keeps the classes, but R8 can still remove their no-argument constructors.
-keepclassmembers class * implements com.google.firebase.components.ComponentRegistrar {
    public <init>();
}

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

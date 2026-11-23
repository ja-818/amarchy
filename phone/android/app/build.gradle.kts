import java.util.Base64
import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
}

// Push and the relay are built in from a Gradle property, the environment,
// or phone/android/firebase.properties (not in git), in that order. Without
// them the app builds and runs, and says notifications aren't in this build.
val firebaseFile = rootProject.layout.projectDirectory.file("firebase.properties").asFile
val firebaseProps = Properties().apply {
    if (firebaseFile.isFile) firebaseFile.inputStream().use { load(it) }
}

fun setting(name: String): String =
    providers.gradleProperty(name).orNull?.takeIf { it.isNotBlank() }
        ?: providers.environmentVariable(name).orNull?.takeIf { it.isNotBlank() }
        ?: firebaseProps.getProperty(name)?.takeIf { it.isNotBlank() }
        ?: ""

fun javaString(value: String): String =
    "\"" + value.trim().replace("\\", "\\\\").replace("\"", "\\\"") + "\""

// The desktop app's own page (desktop/dist), copied into the app's assets
// at every build: the phone shows the same files, never a hand copy.
abstract class OwnPageTask : DefaultTask() {
    @get:InputDirectory
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val source: DirectoryProperty

    @get:OutputDirectory
    abstract val output: DirectoryProperty

    @get:Inject
    abstract val files: FileSystemOperations

    @TaskAction
    fun copy() {
        files.sync {
            from(source)
            into(output.dir("shell"))
        }
    }
}

val ownPage = tasks.register<OwnPageTask>("copyOwnPage") {
    source.set(layout.projectDirectory.dir("../../../desktop/dist"))
}

// A release is signed when the build's environment has the key (CI's
// secrets); else it stays unsigned, to be signed elsewhere or not at all.
// The key is written out by a task, when a release is built: the
// configuration cache may skip the build script, never a task.
val keystoreBase64 = providers.environmentVariable("ANDROID_KEYSTORE_BASE64").orNull?.trim().orEmpty()
val keystoreFile = layout.buildDirectory.file("signing/release.keystore").get().asFile

abstract class KeystoreTask : DefaultTask() {
    @get:Input
    abstract val base64: Property<String>

    @get:OutputFile
    abstract val keystore: RegularFileProperty

    @TaskAction
    fun write() {
        keystore.get().asFile.writeBytes(Base64.getMimeDecoder().decode(base64.get()))
    }
}

val releaseKeystore = tasks.register<KeystoreTask>("releaseKeystore") {
    base64.set(keystoreBase64)
    keystore.set(keystoreFile)
}

android {
    namespace = "io.github.ja818.amarchy"
    compileSdk = 36

    defaultConfig {
        applicationId = "io.github.ja818.amarchy"
        minSdk = 26
        targetSdk = 36
        versionCode = setting("AMARCHY_VERSION_CODE").toIntOrNull() ?: 1
        versionName = setting("AMARCHY_VERSION_NAME").ifEmpty { "1.0" }

        buildConfigField("String", "AMARCHY_RELAY", javaString(setting("AMARCHY_RELAY")))
        buildConfigField("String", "FIREBASE_API_KEY", javaString(setting("FIREBASE_API_KEY")))
        buildConfigField("String", "FIREBASE_APP_ID", javaString(setting("FIREBASE_APP_ID")))
        buildConfigField("String", "FIREBASE_PROJECT_ID", javaString(setting("FIREBASE_PROJECT_ID")))
        buildConfigField("String", "FIREBASE_SENDER_ID", javaString(setting("FIREBASE_SENDER_ID")))
    }

    signingConfigs {
        if (keystoreBase64.isNotEmpty()) {
            create("release") {
                storeFile = keystoreFile
                storePassword = providers.environmentVariable("ANDROID_KEYSTORE_PASSWORD").orNull
                keyAlias = providers.environmentVariable("ANDROID_KEY_ALIAS").orNull
                keyPassword = providers.environmentVariable("ANDROID_KEY_PASSWORD").orNull
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        abortOnError = true
        lintConfig = file("lint.xml")
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
        // The push vectors every side decrypts (phone/testdata).
        val testdata = layout.projectDirectory.dir("../../testdata").asFile
        unitTests.all {
            it.systemProperty("amarchy.testdata", testdata.absolutePath)
            // Android's HttpURLConnection sends the Origin the shell sets; the
            // JDK's (these tests') drops it unless told otherwise.
            it.systemProperty("sun.net.http.allowRestrictedHeaders", "true")
            it.inputs.dir(testdata).withPathSensitivity(PathSensitivity.RELATIVE)
        }
    }
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(ownPage, OwnPageTask::output)
    }
}

// Whatever reads the release key comes after it's written.
if (keystoreBase64.isNotEmpty()) {
    tasks.configureEach {
        if (name in setOf("validateSigningRelease", "packageRelease", "signReleaseBundle")) dependsOn(releaseKeystore)
    }
}

dependencies {
    implementation(libs.androidx.activity)
    implementation(libs.androidx.browser)
    implementation(libs.androidx.core)
    // Play services' own is older than what activity results need.
    implementation(libs.androidx.fragment)
    implementation(libs.androidx.lifecycle.runtime)
    implementation(libs.androidx.webkit)
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)

    // amarchy's own Tailscale node (tailnet/mobile, gomobile), when it's
    // been built into app/libs: without it the app reaches the tailnet
    // through the Tailscale app.
    val tailnet = layout.projectDirectory.file("libs/tailnet.aar").asFile
    if (tailnet.isFile) implementation(files(tailnet))

    testImplementation(libs.junit)
}

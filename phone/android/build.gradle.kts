buildscript {
    dependencies {
        // AGP builds the Kotlin itself (built-in Kotlin); this picks the
        // compiler version instead of the older one AGP ships with.
        classpath(libs.kotlin.gradle.plugin)
    }
}

plugins {
    alias(libs.plugins.android.application) apply false
}

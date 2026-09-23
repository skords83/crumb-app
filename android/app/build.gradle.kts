plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}
val releaseStore = providers.environmentVariable("CRUMB_KEYSTORE_PATH").orNull
val releaseStorePassword = providers.environmentVariable("CRUMB_KEYSTORE_PASSWORD").orNull
val releaseAlias = providers.environmentVariable("CRUMB_KEY_ALIAS").orNull
val releaseKeyPassword = providers.environmentVariable("CRUMB_KEY_PASSWORD").orNull
val releaseCode = providers.environmentVariable("CRUMB_VERSION_CODE").orNull?.toInt() ?: 2
android {
    namespace = "de.crumb.companion"
    compileSdk = 35
    defaultConfig { applicationId = "de.crumb.companion"; minSdk = 26; targetSdk = 35; versionCode = releaseCode; versionName = "0.2.0"; testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner" }
    signingConfigs {
        create("release") {
            storeFile = releaseStore?.let { file(it) }
            storePassword = releaseStorePassword
            keyAlias = releaseAlias
            keyPassword = releaseKeyPassword
        }
    }
    buildTypes { getByName("release") { signingConfig = signingConfigs.getByName("release") } }
    buildFeatures { compose = true }
    testOptions { unitTests.isIncludeAndroidResources = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.04.01"))
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.work:work-runtime-ktx:2.10.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    androidTestImplementation(platform("androidx.compose:compose-bom:2025.04.01"))
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:rules:1.6.1")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    androidTestImplementation("com.squareup.okhttp3:okhttp-tls:4.12.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.14.1")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testImplementation("com.squareup.okhttp3:okhttp-tls:4.12.0")
}

// Release builds must never silently produce an unsigned APK or use the debug key.
tasks.matching { it.name == "preReleaseBuild" }.configureEach {
    doFirst {
        require(!releaseStore.isNullOrBlank() && file(releaseStore).isFile &&
            !releaseStorePassword.isNullOrBlank() && !releaseAlias.isNullOrBlank() && !releaseKeyPassword.isNullOrBlank()) {
            "Release signing requires CRUMB_KEYSTORE_PATH, CRUMB_KEYSTORE_PASSWORD, CRUMB_KEY_ALIAS and CRUMB_KEY_PASSWORD."
        }
    }
}

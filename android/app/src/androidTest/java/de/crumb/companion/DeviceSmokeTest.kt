package de.crumb.companion

import android.content.Context
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

// Run only on a dedicated emulator/test device: fixtures modify this app's private storage.
@RunWith(AndroidJUnit4::class)
class DeviceSmokeTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val context: Context get() = InstrumentationRegistry.getInstrumentation().targetContext
    @Before fun cleanCredentials() { SecureStore(context).clear() }
    @Test fun loginScreenRejectsHttpWithoutSendingCredentials() {
        compose.onNodeWithText("Dein Backbegleiter").assertIsDisplayed()
        compose.onNodeWithText("HTTPS-API-Adresse inklusive /api").performTextInput("http://example.invalid/api")
        compose.onNodeWithText("E-Mail").performTextInput("baker@example.invalid")
        compose.onNodeWithText("Passwort").performTextInput("synthetic-password")
        compose.onNodeWithText("Anmelden", useUnmergedTree = true).performScrollTo().performClick()
        compose.waitUntil(10_000) { context.repository.state.value.message?.contains("HTTPS") == true }
        assertNull(SecureStore(context).read())
        assertFalse(context.repository.state.value.loggedIn)
    }
    @Test fun androidKeystoreRoundTripDoesNotPersistPlaintextToken() {
        val store = SecureStore(context)
        store.save("https://example.invalid/api", "synthetic-device-token")
        assertEquals("https://example.invalid/api" to "synthetic-device-token", SecureStore(context).read())
        val preferences = context.getSharedPreferences("credentials", Context.MODE_PRIVATE)
        assertFalse(preferences.all.values.any { it.toString().contains("synthetic-device-token") })
        store.clear()
        assertNull(store.read())
    }
}

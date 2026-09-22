package de.crumb.companion
import org.junit.Assert.*
import org.junit.Test
class CrumbApiTest {
    @Test fun onlyHttpsEndpointsWithoutEmbeddedCredentialsAreAccepted() {
        val api = CrumbApi()
        assertEquals("https://crumb.example/api", api.validateUrl(" https://crumb.example/api/ "))
        listOf("http://crumb.example/api", "https://user:pass@crumb.example/api", "https://crumb.example/api?token=x", "https://crumb.example/api#x", "file:///tmp/test").forEach { value ->
            assertTrue(runCatching { api.validateUrl(value) }.isFailure)
        }
    }
}

package de.crumb.companion

import java.net.URI
import javax.net.ssl.HttpsURLConnection
import org.json.JSONObject

class ApiException(val status: Int, message: String) : Exception(message)
interface CompanionApi {
    fun validateUrl(value: String): String
    fun request(base: String, path: String, token: String? = null, body: JSONObject? = null,
        method: String = if (body == null) "GET" else "POST"): String
}

class CrumbApi internal constructor(private val tlsFactory: javax.net.ssl.SSLSocketFactory? = null) : CompanionApi {
    override fun validateUrl(value: String): String {
        val uri = URI(value.trim().trimEnd('/'))
        require(uri.scheme == "https" && !uri.host.isNullOrEmpty() && uri.userInfo == null && uri.query == null && uri.fragment == null) { "Bitte eine HTTPS-API-Adresse eingeben, z. B. https://server/api" }
        return uri.toASCIIString()
    }
    override fun request(base: String, path: String, token: String?, body: JSONObject?, method: String): String {
        val connection = URI(validateUrl(base) + path).toURL().openConnection() as HttpsURLConnection
        try {
            tlsFactory?.let { connection.sslSocketFactory = it }
            connection.connectTimeout = 15000; connection.readTimeout = 15000
            connection.instanceFollowRedirects = false
            connection.requestMethod = method
            connection.setRequestProperty("Accept", "application/json")
            if (token != null) connection.setRequestProperty("Authorization", "Bearer $token")
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            val text = (if (status in 200..299) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (status !in 200..299) throw ApiException(status, when (status) {
                401 -> "Anmeldung abgelaufen. Bitte erneut anmelden."
                409 -> "Backplan wurde geändert. Aktuellen Stand prüfen und erneut bestätigen."
                else -> "Anfrage fehlgeschlagen (HTTP $status)."
            })
            return text
        } finally { connection.disconnect() }
    }
}

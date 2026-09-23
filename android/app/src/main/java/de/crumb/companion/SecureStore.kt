package de.crumb.companion

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

interface CredentialStore {
    fun read(): Pair<String, String>?
    fun save(url: String, token: String)
    fun refreshToken(): String? = null
    fun sessionExpiresAt(): String? = null
    fun saveSession(url: String, token: String, refresh: String?, expires: String?) { save(url, token) }
    fun clear()
}
class SecureStore(context: Context) : CredentialStore {
    private val prefs = context.getSharedPreferences("credentials", Context.MODE_PRIVATE)
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("crumb.auth", null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("crumb.auth", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    private fun readData(): JSONObject? = runCatching {
        val encoded = prefs.getString("auth", null) ?: return null
        val bytes = Base64.decode(encoded, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
        JSONObject(String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8))
    }.getOrNull()
    override fun read(): Pair<String, String>? = readData()?.let { it.getString("url") to it.getString("token") }
    override fun refreshToken(): String? = readData()?.optionalString("refreshToken")
    override fun sessionExpiresAt(): String? = readData()?.optionalString("sessionExpiresAt")
    override fun save(url: String, token: String) { saveSession(url, token, null, null) }
    override fun saveSession(url: String, token: String, refresh: String?, expires: String?) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val encrypted = cipher.doFinal(JSONObject().put("url", url).put("token", token).put("refreshToken", refresh).put("sessionExpiresAt", expires).toString().toByteArray(Charsets.UTF_8))
        check(prefs.edit().putString("auth", Base64.encodeToString(cipher.iv + encrypted, Base64.NO_WRAP)).commit())
    }
    override fun clear() { prefs.edit().clear().commit() }
}

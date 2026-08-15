package de.torim.kiebitz

import android.app.Activity
import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.security.GeneralSecurityException
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Sichere Ablage der Konto-Token auf Android.
 *
 * Der Schlüssel liegt im Android Keystore und verlässt ihn nie; verschlüsselt
 * wird mit AES-256/GCM, abgelegt wird der Chiffretext in einer eigenen
 * SharedPreferences-Datei der App. Damit steht in keiner Datei ein lesbarer
 * Token, und ein Backup der App nimmt nichts Verwertbares mit.
 *
 * Gespeichert werden ausschließlich die Kontositzung und der signierte
 * Entitlement-Token. Partien, Analysen und Trainingsdaten bleiben davon
 * unberührt · sie verlassen das Gerät ohnehin nicht.
 */
@TauriPlugin
class SecureStorePlugin(private val activity: Activity) : Plugin(activity) {
  private companion object {
    const val PREFERENCES = "kiebitz.plus.secrets"
    const val KEY_ALIAS = "kiebitz.plus.v1"
    const val KEYSTORE = "AndroidKeyStore"
    const val TRANSFORMATION = "AES/GCM/NoPadding"
    const val GCM_TAG_BITS = 128
    const val IV_BYTES = 12
    val ALLOWED_KEYS = setOf("session", "entitlement")
  }

  private val preferences by lazy {
    activity.applicationContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
  }

  @Command
  fun getSecret(invoke: Invoke) {
    val name = requireKey(invoke) ?: return
    val stored = preferences.getString(name, null)
    val result = JSObject()
    if (stored == null) {
      result.put("value", null)
      invoke.resolve(result)
      return
    }
    val plain = try {
      decrypt(stored)
    } catch (error: GeneralSecurityException) {
      // Der Keystore-Schlüssel ist weg oder ungültig (Werksreset, Wiederher-
      // stellung auf ein anderes Gerät). Dann ist der Wert unbrauchbar; die
      // App meldet sich neu an, statt an einer Ausnahme hängen zu bleiben.
      preferences.edit().remove(name).apply()
      null
    }
    result.put("value", plain)
    invoke.resolve(result)
  }

  @Command
  fun setSecret(invoke: Invoke) {
    val name = requireKey(invoke) ?: return
    val value = invoke.getArgs().getString("value", null)
    if (value == null) {
      invoke.reject("Kein Wert angegeben.")
      return
    }
    try {
      preferences.edit().putString(name, encrypt(value)).apply()
    } catch (error: GeneralSecurityException) {
      invoke.reject("Der Wert konnte nicht verschlüsselt abgelegt werden.")
      return
    }
    invoke.resolve(JSObject().apply { put("value", null) })
  }

  @Command
  fun deleteSecret(invoke: Invoke) {
    val name = requireKey(invoke) ?: return
    preferences.edit().remove(name).apply()
    invoke.resolve(JSObject().apply { put("value", null) })
  }

  /** Nur die beiden bekannten Schlüsselnamen sind zugelassen. */
  private fun requireKey(invoke: Invoke): String? {
    val name = invoke.getArgs().getString("key", "")
    if (name !in ALLOWED_KEYS) {
      invoke.reject("Unbekannter Schlüssel.")
      return null
    }
    return name
  }

  private fun secretKey(): SecretKey {
    val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
    (keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
    generator.init(
      KeyGenParameterSpec.Builder(
        KEY_ALIAS,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        // Der Token wird auch ohne Nutzerinteraktion gebraucht: Widgets und
        // der Start ohne Entsperren müssen den Plus-Status kennen.
        .setUserAuthenticationRequired(false)
        .build()
    )
    return generator.generateKey()
  }

  /** Base64 über `iv ‖ ciphertext` · der Tag steckt bei GCM im Chiffretext. */
  private fun encrypt(plain: String): String {
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, secretKey())
    val encrypted = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
    val payload = ByteArray(cipher.iv.size + encrypted.size)
    cipher.iv.copyInto(payload)
    encrypted.copyInto(payload, cipher.iv.size)
    return Base64.encodeToString(payload, Base64.NO_WRAP)
  }

  private fun decrypt(stored: String): String {
    val payload = Base64.decode(stored, Base64.NO_WRAP)
    if (payload.size <= IV_BYTES) throw GeneralSecurityException("Chiffretext zu kurz")
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(
      Cipher.DECRYPT_MODE,
      secretKey(),
      GCMParameterSpec(GCM_TAG_BITS, payload, 0, IV_BYTES),
    )
    return String(cipher.doFinal(payload, IV_BYTES, payload.size - IV_BYTES), Charsets.UTF_8)
  }
}

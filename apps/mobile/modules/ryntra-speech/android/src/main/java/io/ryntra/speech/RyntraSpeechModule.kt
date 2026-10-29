package io.ryntra.speech

import android.app.Activity
import android.content.Intent
import android.media.MediaRecorder
import android.os.Build
import android.os.SystemClock
import android.speech.RecognizerIntent
import android.util.Base64
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * Voice for the question field — input only, the words always land in the field for the person to read and edit.
 *
 * First, Android's own recognizer screen (RecognizerIntent): the system listens, the app receives only the words.
 * Where there is no recognizer, or it failed, a recording: the app records the question (the microphone permission is
 * asked only on the person's press), hands the file's bytes to the screen, and deletes it — the screen sends it to
 * Ryntra's server only on «Розпізнати» at the price shown. AAC in MP4, mono, 16 kHz, 32 kbit/s: two minutes fit.
 */
class RyntraSpeechModule : Module() {
  private var pending: Promise? = null
  private var recorder: MediaRecorder? = null
  private var recording: File? = null
  private var startedAt = 0L
  private var reachedMax = false

  override fun definition() = ModuleDefinition {
    Name("RyntraSpeech")

    Function("isAvailable") {
      val context = appContext.reactContext ?: return@Function false
      val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
      context.packageManager.queryIntentActivities(intent, 0).isNotEmpty()
    }

    // The words heard, `""` when the person closed the screen or nothing was heard, null when the recognizer failed.
    AsyncFunction("listen") { language: String, prompt: String, promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      // One listening at a time: an earlier one that never came back ends with no words.
      pending?.resolve("")
      pending = promise
      val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, language)
        putExtra(RecognizerIntent.EXTRA_PROMPT, prompt)
        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
      }
      try {
        activity.startActivityForResult(intent, REQUEST_CODE)
      } catch (error: Exception) {
        pending = null
        promise.resolve(null)
      }
    }.runOnQueue(Queues.MAIN)

    OnActivityResult { _, payload ->
      if (payload.requestCode != REQUEST_CODE) return@OnActivityResult
      val promise = pending ?: return@OnActivityResult
      pending = null
      when (payload.resultCode) {
        Activity.RESULT_OK -> {
          val words = payload.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
          promise.resolve(words?.trim() ?: "")
        }
        // Closed by the person, or nothing matched: no words, nothing failed.
        Activity.RESULT_CANCELED, RecognizerIntent.RESULT_NO_MATCH -> promise.resolve("")
        // The recognizer's own failure (client, server, network, audio): the screen offers the recording instead.
        else -> promise.resolve(null)
      }
    }

    // True when the microphone records; false when it could not start (no permission, busy, no microphone).
    AsyncFunction("startRecording") { promise: Promise ->
      release(delete = true)
      val context = appContext.reactContext
      if (context == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      val file = File(context.cacheDir, "ryntra-voice-${System.currentTimeMillis()}.m4a")
      val made = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(context) else @Suppress("DEPRECATION") MediaRecorder()
      try {
        made.setAudioSource(MediaRecorder.AudioSource.MIC)
        made.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
        made.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
        made.setAudioChannels(1)
        made.setAudioSamplingRate(16_000)
        made.setAudioEncodingBitRate(32_000)
        // At two minutes the recorder stops writing by itself; the file it wrote is still read on «stop».
        made.setMaxDuration(MAX_SECONDS * 1_000)
        made.setOnInfoListener { _, what, _ ->
          if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED) reachedMax = true
        }
        made.setOutputFile(file.absolutePath)
        made.prepare()
        made.start()
        recorder = made
        recording = file
        startedAt = SystemClock.elapsedRealtime()
        reachedMax = false
        promise.resolve(true)
      } catch (error: Exception) {
        made.release()
        file.delete()
        release(delete = true)
        promise.resolve(false)
      }
    }

    // The recording's bytes (base64), its type and its length in whole seconds; null when nothing was recorded.
    AsyncFunction("stopRecording") { promise: Promise ->
      val made = recorder
      val file = recording
      if (made == null || file == null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      val seconds = ((SystemClock.elapsedRealtime() - startedAt + 999) / 1_000).toInt().coerceIn(1, MAX_SECONDS)
      try {
        made.stop()
      } catch (error: Exception) {
        // Stopped at its two minutes already — the file is whole; stopped before any sound was written — nothing to send.
        if (!reachedMax) {
          release(delete = true)
          promise.resolve(null)
          return@AsyncFunction
        }
      }
      made.release()
      recorder = null
      try {
        val bytes = file.readBytes()
        file.delete()
        recording = null
        if (bytes.isEmpty()) {
          promise.resolve(null)
          return@AsyncFunction
        }
        promise.resolve(
          mapOf(
            "audio" to Base64.encodeToString(bytes, Base64.NO_WRAP),
            "mime" to "audio/mp4",
            "seconds" to seconds,
          ),
        )
      } catch (error: Exception) {
        release(delete = true)
        promise.resolve(null)
      }
    }

    // A recording let go: the microphone released and the file deleted, nothing kept.
    Function("cancelRecording") {
      release(delete = true)
    }

    OnDestroy {
      release(delete = true)
    }
  }

  private fun release(delete: Boolean) {
    try {
      recorder?.stop()
    } catch (error: Exception) {
      // not started or already stopped
    }
    recorder?.release()
    recorder = null
    if (delete) recording?.delete()
    recording = null
  }

  companion object {
    private const val REQUEST_CODE = 7311
    private const val MAX_SECONDS = 120
  }
}

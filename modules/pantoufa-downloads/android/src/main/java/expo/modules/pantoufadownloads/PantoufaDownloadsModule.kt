package expo.modules.pantoufadownloads

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Environment
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream

class PantoufaDownloadsModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val downloadManager: DownloadManager
    get() = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager

  private fun isMp4(localUri: String?): Boolean {
    if (localUri == null) return false
    return try {
      val uri = Uri.parse(localUri)
      val stream = if (uri.scheme == "file") FileInputStream(File(uri.path!!)) else context.contentResolver.openInputStream(uri)
      stream?.use {
        val header = ByteArray(12)
        val count = it.read(header)
        count >= 8 && header[4] == 'f'.code.toByte() && header[5] == 't'.code.toByte() &&
          header[6] == 'y'.code.toByte() && header[7] == 'p'.code.toByte()
      } ?: false
    } catch (_: Exception) {
      false
    }
  }

  private fun row(cursor: android.database.Cursor): Map<String, Any?> {
    val localUri = cursor.getString(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI))
    val status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
    return mapOf(
      "id" to cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_ID)).toDouble(),
      "status" to status,
      "reason" to cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON)),
      "bytes" to cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)).toDouble(),
      "totalBytes" to cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)).toDouble(),
      "localUri" to localUri,
      "validMp4" to (status == DownloadManager.STATUS_SUCCESSFUL && isMp4(localUri))
    )
  }

  override fun definition() = ModuleDefinition {
    Name("PantoufaDownloads")

    AsyncFunction("enqueue") { url: String, headers: Map<String, String>, fileName: String, title: String ->
      require(fileName.matches(Regex("^[A-Za-z0-9._-]+$"))) { "Invalid download filename" }
      val uri = Uri.parse(url)
      require(uri.scheme == "https" && !uri.host.isNullOrBlank()) { "Invalid download URL" }
      val request = DownloadManager.Request(uri)
        .setTitle(title)
        .setDescription(fileName)
        .setMimeType("video/mp4")
        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        .setAllowedOverMetered(true)
        .setAllowedOverRoaming(false)
        .setDestinationInExternalFilesDir(context, Environment.DIRECTORY_MOVIES, "downloads/$fileName")
      headers.forEach { (key, value) ->
        require(!key.contains('\n') && !key.contains('\r') && !value.contains('\n') && !value.contains('\r')) { "Invalid download header" }
        request.addRequestHeader(key, value)
      }
      downloadManager.enqueue(request).toDouble()
    }

    AsyncFunction("query") { id: Double ->
      downloadManager.query(DownloadManager.Query().setFilterById(id.toLong())).use { cursor ->
        if (!cursor.moveToFirst()) {
          null
        } else {
          row(cursor)
        }
      }
    }

    AsyncFunction("find") { fileName: String ->
      require(fileName.matches(Regex("^[A-Za-z0-9._-]+$"))) { "Invalid download filename" }
      downloadManager.query(DownloadManager.Query()).use { cursor ->
        var found: Map<String, Any?>? = null
        while (cursor.moveToNext()) {
          val description = cursor.getString(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_DESCRIPTION))
          if (description == fileName) {
            found = row(cursor)
            break
          }
        }
        found
      }
    }

    AsyncFunction("remove") { id: Double ->
      downloadManager.remove(id.toLong())
    }
  }
}

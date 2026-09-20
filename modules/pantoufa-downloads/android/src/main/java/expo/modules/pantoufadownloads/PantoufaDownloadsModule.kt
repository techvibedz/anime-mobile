package expo.modules.pantoufadownloads

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.util.Base64
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import java.io.BufferedReader
import java.io.File
import java.io.FileInputStream
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.ServerSocket
import java.net.URL
import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

private data class MegaStream(
  val downloadUrl: String,
  val size: Long,
  val key: ByteArray,
  val nonce: ByteArray,
)

private object MegaStreamServer {
  private val streams = ConcurrentHashMap<String, MegaStream>()
  private val random = SecureRandom()
  @Volatile private var socket: ServerSocket? = null

  @Synchronized
  fun start(embedUrl: String): String {
    val stream = resolve(embedUrl)
    val server = socket ?: ServerSocket(0, 16, InetAddress.getByName("127.0.0.1")).also {
      socket = it
      Thread({ acceptLoop(it) }, "pantoufa-mega-server").apply { isDaemon = true; start() }
    }
    val tokenBytes = ByteArray(18).also(random::nextBytes)
    val token = Base64.encodeToString(tokenBytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    streams[token] = stream
    return "http://127.0.0.1:${server.localPort}/mega/$token.mp4"
  }

  private fun resolve(embedUrl: String): MegaStream {
    val uri = Uri.parse(embedUrl)
    require(uri.host?.endsWith("mega.nz", true) == true) { "Invalid MEGA URL" }
    val parts = uri.pathSegments
    val marker = parts.indexOfFirst { it.equals("embed", true) || it.equals("file", true) }
    val handle = if (marker >= 0) parts.getOrNull(marker + 1) else null
    val fragment = uri.fragment
    require(!handle.isNullOrBlank() && !fragment.isNullOrBlank()) { "Incomplete MEGA URL" }
    val rawKey = Base64.decode(fragment, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    require(rawKey.size >= 32) { "Invalid MEGA key" }
    val key = ByteArray(16) { rawKey[it].toInt().xor(rawKey[it + 16].toInt()).toByte() }
    val nonce = ByteArray(16).also { rawKey.copyInto(it, 0, 16, 24) }

    val api = URL("https://g.api.mega.co.nz/cs?id=${System.currentTimeMillis()}").openConnection() as HttpURLConnection
    api.requestMethod = "POST"
    api.doOutput = true
    api.connectTimeout = 15_000
    api.readTimeout = 15_000
    api.setRequestProperty("Content-Type", "application/json")
    api.outputStream.use { out ->
      out.write("[{\"a\":\"g\",\"g\":1,\"p\":\"$handle\"}]".toByteArray(StandardCharsets.UTF_8))
    }
    require(api.responseCode in 200..299) { "MEGA API ${api.responseCode}" }
    val body = api.inputStream.bufferedReader().use { it.readText() }
    val result = JSONArray(body).getJSONObject(0)
    val downloadUrl = result.optString("g")
    val size = result.optLong("s", -1)
    require(downloadUrl.startsWith("https://") && size > 0) { "MEGA file unavailable" }
    return MegaStream(downloadUrl, size, key, nonce)
  }

  private fun acceptLoop(server: ServerSocket) {
    while (!server.isClosed) {
      try {
        val client = server.accept()
        Thread({ serve(client) }, "pantoufa-mega-client").apply { isDaemon = true; start() }
      } catch (_: Exception) {}
    }
  }

  private fun serve(client: java.net.Socket) = client.use { socket ->
    try {
      val reader = BufferedReader(InputStreamReader(socket.getInputStream(), StandardCharsets.US_ASCII))
      val request = reader.readLine() ?: return@use
      val requestParts = request.split(' ')
      val method = requestParts.getOrNull(0) ?: return@use
      val token = requestParts.getOrNull(1)?.substringAfter("/mega/")?.substringBefore(".mp4") ?: return@use
      var range: String? = null
      while (true) {
        val line = reader.readLine() ?: break
        if (line.isEmpty()) break
        if (line.startsWith("Range:", true)) range = line.substringAfter(':').trim()
      }
      val stream = streams[token] ?: return@use respond(socket, 404, "Not Found", 0, null)
      val match = Regex("bytes=(\\d+)-(\\d*)", RegexOption.IGNORE_CASE).find(range ?: "")
      val start = match?.groupValues?.get(1)?.toLongOrNull() ?: 0L
      val end = (match?.groupValues?.get(2)?.toLongOrNull() ?: (stream.size - 1)).coerceAtMost(stream.size - 1)
      require(start in 0..end)
      val partial = match != null
      val length = end - start + 1
      respond(socket, if (partial) 206 else 200, if (partial) "Partial Content" else "OK", length,
        if (partial) "bytes $start-$end/${stream.size}" else null, headersOnly = method.equals("HEAD", true))
      if (method.equals("HEAD", true)) return@use

      val alignedStart = start - (start % 16)
      val upstream = URL(stream.downloadUrl).openConnection() as HttpURLConnection
      upstream.connectTimeout = 15_000
      upstream.readTimeout = 30_000
      upstream.setRequestProperty("Range", "bytes=$alignedStart-$end")
      upstream.setRequestProperty("Accept-Encoding", "identity")
      require(upstream.responseCode == 206 || (upstream.responseCode == 200 && alignedStart == 0L)) {
        "MEGA stream ${upstream.responseCode}"
      }
      val iv = stream.nonce.copyOf()
      addCounter(iv, alignedStart / 16)
      val cipher = Cipher.getInstance("AES/CTR/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(stream.key, "AES"), IvParameterSpec(iv))
      var discard = (start - alignedStart).toInt()
      var remaining = length
      val input = upstream.inputStream
      val buffer = ByteArray(64 * 1024)
      while (remaining > 0) {
        val read = input.read(buffer)
        if (read < 0) break
        val plain = cipher.update(buffer, 0, read) ?: continue
        val offset = minOf(discard, plain.size)
        discard -= offset
        val count = minOf((plain.size - offset).toLong(), remaining).toInt()
        if (count > 0) socket.getOutputStream().write(plain, offset, count)
        remaining -= count
      }
      socket.getOutputStream().flush()
      input.close()
      upstream.disconnect()
    } catch (_: Exception) {}
  }

  private fun respond(
    socket: java.net.Socket,
    status: Int,
    message: String,
    length: Long,
    contentRange: String?,
    headersOnly: Boolean = true,
  ) {
    val headers = buildString {
      append("HTTP/1.1 $status $message\r\n")
      append("Content-Type: video/mp4\r\nAccept-Ranges: bytes\r\nContent-Length: $length\r\n")
      if (contentRange != null) append("Content-Range: $contentRange\r\n")
      append("Connection: close\r\n\r\n")
    }
    socket.getOutputStream().write(headers.toByteArray(StandardCharsets.US_ASCII))
    if (headersOnly) socket.getOutputStream().flush()
  }

  private fun addCounter(iv: ByteArray, blocks: Long) {
    var carry = blocks
    for (i in iv.indices.reversed()) {
      val sum = (iv[i].toInt() and 0xff) + (carry and 0xff).toInt()
      iv[i] = sum.toByte()
      carry = (carry ushr 8) + (sum ushr 8)
    }
  }
}

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

    AsyncFunction("startMegaStream") { embedUrl: String ->
      MegaStreamServer.start(embedUrl)
    }

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

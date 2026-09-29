package expo.modules.networkssdp

import android.content.Context
import android.net.wifi.WifiManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.SocketTimeoutException

private const val SSDP_ADDRESS = "239.255.255.250"
private const val SSDP_PORT = 1900

// SSDP (UPnP) search over a UDP socket. Holds a Wi-Fi multicast lock during the search,
// since some Wi-Fi drivers otherwise drop multicast traffic.
class NetworkSsdpModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("NetworkSsdp")

    // Sends one M-SEARCH and resolves with every reply received within timeoutMs:
    // [{ ip, port, message }]. message is the raw reply text.
    AsyncFunction("search") { timeoutMs: Int, searchTarget: String, mx: Int, promise: Promise ->
      Thread {
        try {
          promise.resolve(runSearch(timeoutMs, searchTarget, mx))
        } catch (e: Exception) {
          promise.reject("ERR_SSDP", e.message ?: e.toString(), e)
        }
      }.start()
    }
  }

  private fun runSearch(timeoutMs: Int, searchTarget: String, mx: Int): List<Map<String, Any>> {
    val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    val lock = wifi.createMulticastLock("network-ssdp").apply {
      setReferenceCounted(false)
      acquire()
    }
    try {
      DatagramSocket().use { socket ->
        // Short receive timeout so the loop can check the deadline.
        socket.soTimeout = 250

        val message = listOf(
          "M-SEARCH * HTTP/1.1",
          "HOST: $SSDP_ADDRESS:$SSDP_PORT",
          "MAN: \"ssdp:discover\"",
          "MX: $mx",
          "ST: $searchTarget",
          "",
          ""
        ).joinToString("\r\n").toByteArray(Charsets.UTF_8)
        socket.send(DatagramPacket(message, message.size, InetAddress.getByName(SSDP_ADDRESS), SSDP_PORT))

        val replies = mutableListOf<Map<String, Any>>()
        val buffer = ByteArray(8192)
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
          val packet = DatagramPacket(buffer, buffer.size)
          try {
            socket.receive(packet)
          } catch (e: SocketTimeoutException) {
            continue
          }
          val ip = packet.address?.hostAddress ?: continue
          replies.add(
            mapOf(
              "ip" to ip,
              "port" to packet.port,
              "message" to String(packet.data, packet.offset, packet.length, Charsets.UTF_8)
            )
          )
        }
        return replies
      }
    } finally {
      if (lock.isHeld) lock.release()
    }
  }
}

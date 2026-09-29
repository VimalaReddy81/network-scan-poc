package expo.modules.networkssdp

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.DatagramPacket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.MulticastSocket
import java.net.NetworkInterface
import java.net.SocketTimeoutException

private const val TAG = "NetworkSsdp"
private const val SSDP_ADDRESS = "239.255.255.250"
private const val SSDP_PORT = 1900

// UDP drops packets, so every search target is sent this many times, this far apart.
private const val SEND_REPEATS = 3
private const val SEND_SPACING_MS = 400L

// SSDP (UPnP) search over a UDP socket. The socket is bound to the Wi-Fi network and sends on
// the Wi-Fi interface, so the search doesn't go out over mobile data when both are up.
// Holds a Wi-Fi multicast lock during the search, since some Wi-Fi drivers otherwise drop multicast.
class NetworkSsdpModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("NetworkSsdp")

    // Sends M-SEARCH for each target and resolves with every reply received within timeoutMs:
    // { replies: [{ ip, port, message }], sent, interfaceName }.
    AsyncFunction("search") { timeoutMs: Int, searchTargets: List<String>, mx: Int, promise: Promise ->
      Thread {
        try {
          promise.resolve(runSearch(timeoutMs, searchTargets, mx))
        } catch (e: Exception) {
          Log.w(TAG, "DIAG search failed", e)
          promise.reject("ERR_SSDP", e.message ?: e.toString(), e)
        }
      }.start()
    }
  }

  private fun wifiNetwork(connectivity: ConnectivityManager): Network? {
    val isWifi = { network: Network ->
      connectivity.getNetworkCapabilities(network)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
    }
    connectivity.activeNetwork?.takeIf(isWifi)?.let { return it }
    @Suppress("DEPRECATION")
    return connectivity.allNetworks.firstOrNull(isWifi)
  }

  private fun runSearch(timeoutMs: Int, searchTargets: List<String>, mx: Int): Map<String, Any?> {
    val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    val network = wifiNetwork(connectivity)
    val interfaceName = network?.let { connectivity.getLinkProperties(it)?.interfaceName }
    val networkInterface = interfaceName?.let { runCatching { NetworkInterface.getByName(it) }.getOrNull() }
    // DIAG: which network/interface/IP the search will use.
    val localIps = network?.let { n -> connectivity.getLinkProperties(n)?.linkAddresses?.map { it.address.hostAddress } }
    Log.i(TAG, "DIAG wifiNetwork=${network ?: "none"} active=${connectivity.activeNetwork} interface=${interfaceName ?: "none"} " +
      "interfaceFound=${networkInterface != null} up=${runCatching { networkInterface?.isUp }.getOrNull()} supportsMulticast=${runCatching { networkInterface?.supportsMulticast() }.getOrNull()} " +
      "localIps=${localIps ?: "none"}")

    val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    val lock = wifi.createMulticastLock("network-ssdp").apply {
      setReferenceCounted(false)
      acquire()
    }
    Log.i(TAG, "DIAG multicastLock held=${lock.isHeld}")

    try {
      MulticastSocket(null as InetSocketAddress?).use { socket ->
        socket.reuseAddress = true
        socket.bind(InetSocketAddress(0))
        network?.let {
          runCatching { it.bindSocket(socket) }
            .onSuccess { Log.i(TAG, "DIAG bindSocket to Wi-Fi network ok") }
            .onFailure { e -> Log.w(TAG, "DIAG bindSocket failed", e) }
        }
        networkInterface?.let {
          runCatching { socket.networkInterface = it }
            .onSuccess { Log.i(TAG, "DIAG setNetworkInterface(${it.name}) ok") }
            .onFailure { e -> Log.w(TAG, "DIAG setNetworkInterface failed", e) }
        }
        socket.timeToLive = 2
        Log.i(TAG, "DIAG socket local=${socket.localSocketAddress} ttl=${socket.timeToLive} " +
          "multicastInterface=${runCatching { socket.networkInterface?.name }.getOrNull()} timeoutMs=$timeoutMs mx=$mx")
        // Short receive timeout so the loop can send the repeats and check the deadline.
        socket.soTimeout = 100

        val destination = InetAddress.getByName(SSDP_ADDRESS)
        val targetsUsed = searchTargets.ifEmpty { listOf("ssdp:all") }
        val messages = targetsUsed.map { target ->
          listOf(
            "M-SEARCH * HTTP/1.1",
            "HOST: $SSDP_ADDRESS:$SSDP_PORT",
            "MAN: \"ssdp:discover\"",
            "MX: $mx",
            "ST: $target",
            "USER-AGENT: Android UPnP/1.1 NetworkScanPOC/1.0",
            "",
            ""
          ).joinToString("\r\n").toByteArray(Charsets.UTF_8)
        }

        val start = System.currentTimeMillis()
        val deadline = start + timeoutMs
        var nextSendAt = start
        var round = 0
        var sent = 0
        val replies = mutableListOf<Map<String, Any>>()
        val buffer = ByteArray(8192)

        while (System.currentTimeMillis() < deadline) {
          if (round < SEND_REPEATS && System.currentTimeMillis() >= nextSendAt) {
            for ((index, message) in messages.withIndex()) {
              try {
                socket.send(DatagramPacket(message, message.size, destination, SSDP_PORT))
                sent++
                Log.i(TAG, "DIAG sent #$sent round=${round + 1} ST=${targetsUsed[index]} to $SSDP_ADDRESS:$SSDP_PORT from ${socket.localSocketAddress}")
              } catch (e: Exception) {
                Log.w(TAG, "DIAG send failed ST=${targetsUsed[index]} round=${round + 1}", e)
                if (sent == 0 && round == SEND_REPEATS - 1) throw e
              }
            }
            round++
            nextSendAt += SEND_SPACING_MS
          }

          val packet = DatagramPacket(buffer, buffer.size)
          try {
            socket.receive(packet)
          } catch (e: SocketTimeoutException) {
            continue
          } catch (e: Exception) {
            Log.w(TAG, "DIAG receive failed", e)
            throw e
          }
          val ip = packet.address?.hostAddress ?: continue
          val text = String(packet.data, packet.offset, packet.length, Charsets.UTF_8)
          val headers = text.split("\r\n", "\n").drop(1).mapNotNull { line ->
            val colon = line.indexOf(':')
            if (colon > 0) line.substring(0, colon).trim().uppercase() to line.substring(colon + 1).trim() else null
          }.toMap()
          Log.i(TAG, "DIAG reply #${replies.size + 1} from $ip:${packet.port} ST=${headers["ST"]} USN=${headers["USN"]} " +
            "SERVER=${headers["SERVER"]} LOCATION=${headers["LOCATION"]}")
          replies.add(
            mapOf(
              "ip" to ip,
              "port" to packet.port,
              "message" to text
            )
          )
        }

        Log.i(TAG, "DIAG done: sent $sent M-SEARCH on ${interfaceName ?: "default network"}, received ${replies.size} UDP replies " +
          "from ${replies.map { it["ip"] }.distinct()}")
        return mapOf("replies" to replies, "sent" to sent, "interfaceName" to interfaceName)
      }
    } finally {
      if (lock.isHeld) lock.release()
    }
  }
}

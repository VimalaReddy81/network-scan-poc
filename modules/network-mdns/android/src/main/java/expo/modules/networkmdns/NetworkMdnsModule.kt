package expo.modules.networkmdns

import android.annotation.TargetApi
import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import android.util.Log
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.Inet4Address
import java.net.InetAddress
import java.util.concurrent.Executors

private const val TAG = "NetworkMdns"

// DNS-SD meta-query: its results are service types on the network, not service instances.
private const val SERVICE_TYPES_QUERY = "_services._dns-sd._udp"

// mDNS (DNS-SD) browser for Android, built on the system's NsdManager. The system runs the
// mDNS responder (and its multicast handling), and several service types can be browsed at once.
//
// Every event carries the browse id returned by startBrowse, the same as on iOS.
class NetworkMdnsModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
  private val nsd: NsdManager
    get() = context.getSystemService(Context.NSD_SERVICE) as NsdManager

  private val lock = Any()
  private val sessions = mutableMapOf<Int, BrowseSession>()
  private var nextBrowseId = 0

  // Before Android 14, NsdManager resolves one service at a time per app, so resolves are queued.
  private val resolveQueue = ArrayDeque<Pair<BrowseSession, NsdServiceInfo>>()
  private var resolving = false
  private val callbackExecutor = Executors.newSingleThreadExecutor()

  override fun definition() = ModuleDefinition {
    Name("NetworkMdns")

    Events("onResolved", "onServiceType", "onError")

    // type is a DNS-SD type such as "_googlecast._tcp.".
    Function("startBrowse") { type: String ->
      val browseId = synchronized(lock) { ++nextBrowseId }
      if (browseId == 1) Log.i(TAG, "DIAG Android SDK ${Build.VERSION.SDK_INT}, resolve via ${if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) "ServiceInfoCallback" else "resolveService queue"}")
      val session = BrowseSession(browseId, type.trimEnd('.'))
      synchronized(lock) { sessions[browseId] = session }
      session.start()
      browseId
    }

    Function("stopBrowse") { browseId: Int ->
      val session = synchronized(lock) { sessions.remove(browseId) }
      session?.stop()
      Unit
    }

    Function("stopAll") {
      stopAllSessions()
      Unit
    }

    OnDestroy {
      stopAllSessions()
      callbackExecutor.shutdown()
    }
  }

  private fun stopAllSessions() {
    val all = synchronized(lock) {
      val copy = sessions.values.toList()
      sessions.clear()
      resolveQueue.clear()
      copy
    }
    all.forEach { it.stop() }
  }

  private fun emitError(browseId: Int, type: String, code: Int, message: String) {
    Log.w(TAG, "$type: $message ($code)")
    sendEvent(
      "onError",
      mapOf("browseId" to browseId, "type" to type, "code" to code, "message" to message)
    )
  }

  private fun emitResolved(session: BrowseSession, info: NsdServiceInfo, addresses: List<InetAddress>) {
    if (session.stopped) return
    val txt = mutableMapOf<String, String>()
    try {
      for ((key, value) in info.attributes) {
        txt[key] = value?.toString(Charsets.UTF_8) ?: ""
      }
    } catch (e: Exception) {
      // Some devices publish TXT records Android can't parse; the rest of the service is still useful.
    }
    // IPv4 first: the JS side prefers it.
    val sorted = addresses.sortedBy { if (it is Inet4Address) 0 else 1 }.mapNotNull { it.hostAddress }
    val name = info.serviceName ?: ""
    Log.i(TAG, "DIAG resolved [${session.type}] name=\"$name\" addresses=$sorted port=${info.port} txtKeys=${txt.keys}")
    sendEvent(
      "onResolved",
      mapOf(
        "browseId" to session.browseId,
        "type" to session.type,
        "name" to name,
        "domain" to "local.",
        "fullName" to "$name.${session.type}.local.",
        // NsdManager doesn't report the mDNS host name.
        "host" to "",
        "port" to info.port,
        "addresses" to sorted,
        "txt" to txt
      )
    )
  }

  // --- Resolving ---

  private fun resolve(session: BrowseSession, info: NsdServiceInfo) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      resolveWithCallback(session, info)
    } else {
      synchronized(lock) { resolveQueue.addLast(session to info) }
      resolveNext()
    }
  }

  @TargetApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
  private fun resolveWithCallback(session: BrowseSession, info: NsdServiceInfo) {
    val callback = object : NsdManager.ServiceInfoCallback {
      override fun onServiceInfoCallbackRegistrationFailed(errorCode: Int) {
        Log.w(TAG, "DIAG resolve failed [${session.type}] ${info.serviceName}: errorCode=$errorCode")
        session.infoCallbacks.remove(this)
      }

      override fun onServiceUpdated(serviceInfo: NsdServiceInfo) {
        if (serviceInfo.hostAddresses.isEmpty()) {
          Log.i(TAG, "DIAG update without addresses [${session.type}] ${serviceInfo.serviceName} (waiting)")
          return
        }
        emitResolved(session, serviceInfo, serviceInfo.hostAddresses)
        // One answer per service is enough for a one-time scan.
        session.unregisterInfoCallback(this)
      }

      override fun onServiceLost() {}

      override fun onServiceInfoCallbackUnregistered() {}
    }
    try {
      session.infoCallbacks.add(callback)
      nsd.registerServiceInfoCallback(info, callbackExecutor, callback)
    } catch (e: Exception) {
      session.infoCallbacks.remove(callback)
      Log.w(TAG, "DIAG could not resolve [${session.type}] ${info.serviceName}: ${e.message}")
    }
  }

  private fun resolveNext() {
    val next = synchronized(lock) {
      if (resolving) return
      var item = resolveQueue.removeFirstOrNull()
      while (item != null && item.first.stopped) item = resolveQueue.removeFirstOrNull()
      if (item != null) resolving = true
      item
    } ?: return

    val (session, info) = next
    val done = {
      synchronized(lock) { resolving = false }
      resolveNext()
    }
    try {
      @Suppress("DEPRECATION")
      nsd.resolveService(info, object : NsdManager.ResolveListener {
        override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
          Log.w(TAG, "DIAG resolve failed [${session.type}] ${serviceInfo.serviceName}: errorCode=$errorCode")
          done()
        }

        override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
          @Suppress("DEPRECATION")
          val host = serviceInfo.host
          emitResolved(session, serviceInfo, listOfNotNull(host))
          done()
        }
      })
    } catch (e: Exception) {
      Log.w(TAG, "Could not resolve ${info.serviceName}: ${e.message}")
      done()
    }
  }

  // --- Browsing ---

  private inner class BrowseSession(val browseId: Int, val type: String) {
    @Volatile var stopped = false
    val infoCallbacks: MutableSet<Any> = java.util.Collections.synchronizedSet(mutableSetOf())

    private val listener = object : NsdManager.DiscoveryListener {
      override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
        Log.w(TAG, "DIAG browse start FAILED [$type] errorCode=$errorCode")
        emitError(browseId, type, errorCode, "Could not browse $type")
      }

      override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
        Log.w(TAG, "DIAG browse stop failed [$type] errorCode=$errorCode")
      }

      override fun onDiscoveryStarted(serviceType: String) {
        Log.i(TAG, "DIAG browse started [$type] (browseId=$browseId)")
      }

      override fun onDiscoveryStopped(serviceType: String) {
        Log.i(TAG, "DIAG browse stopped [$type] (browseId=$browseId)")
      }

      override fun onServiceFound(serviceInfo: NsdServiceInfo) {
        Log.i(TAG, "DIAG found [$type] name=\"${serviceInfo.serviceName}\" reportedType=${serviceInfo.serviceType} stopped=$stopped")
        if (stopped) return
        if (type == SERVICE_TYPES_QUERY) {
          // A meta-query answer names a type: name "_googlecast", type "_tcp.local." -> "_googlecast._tcp".
          val proto = Regex("_(tcp|udp)").find(serviceInfo.serviceType ?: "")?.value
          val name = serviceInfo.serviceName
          if (proto != null && name != null) {
            sendEvent("onServiceType", mapOf("browseId" to browseId, "serviceType" to "$name.$proto"))
          }
          return
        }
        resolve(this@BrowseSession, serviceInfo)
      }

      override fun onServiceLost(serviceInfo: NsdServiceInfo) {
        Log.i(TAG, "DIAG lost [$type] name=\"${serviceInfo.serviceName}\"")
      }
    }

    fun start() {
      Log.i(TAG, "DIAG browse requested [$type] (browseId=$browseId)")
      try {
        nsd.discoverServices(type, NsdManager.PROTOCOL_DNS_SD, listener)
      } catch (e: Exception) {
        emitError(browseId, type, -1, "Could not browse $type: ${e.message}")
      }
    }

    fun unregisterInfoCallback(callback: Any) {
      if (!infoCallbacks.remove(callback)) return
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        try {
          nsd.unregisterServiceInfoCallback(callback as NsdManager.ServiceInfoCallback)
        } catch (e: Exception) {
          // Already unregistered.
        }
      }
    }

    fun stop() {
      Log.i(TAG, "DIAG browse stop requested [$type] (browseId=$browseId)")
      stopped = true
      try {
        nsd.stopServiceDiscovery(listener)
      } catch (e: Exception) {
        // Discovery never started (or already stopped).
      }
      infoCallbacks.toList().forEach { unregisterInfoCallback(it) }
    }
  }
}

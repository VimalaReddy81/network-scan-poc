import ExpoModulesCore
import Foundation

// Bonjour (mDNS) browser for iOS. react-native-zeroconf doesn't deliver events on iOS
// under the New Architecture, so this module is used instead.
//
// Several browses can run at once (one per service type). Every event carries the browse id
// returned by startBrowse so JS can tell browses apart and drop late events.
public final class NetworkMdnsModule: Module {
  private var sessions: [Int: BrowseSession] = [:]
  private var nextBrowseId = 0

  public func definition() -> ModuleDefinition {
    Name("NetworkMdns")

    Events("onResolved", "onServiceType", "onError")

    // type is a Bonjour type such as "_googlecast._tcp." and must be listed in NSBonjourServices.
    Function("startBrowse") { (type: String) -> Int in
      self.nextBrowseId += 1
      let browseId = self.nextBrowseId
      // NetServiceBrowser delivers its callbacks on the run loop it was started on.
      DispatchQueue.main.async { [weak self] in
        guard let self else { return }
        let session = BrowseSession(
          browseId: browseId,
          type: type,
          onResolved: { [weak self] payload in self?.sendEvent("onResolved", payload) },
          onServiceType: { [weak self] payload in self?.sendEvent("onServiceType", payload) },
          onError: { [weak self] payload in self?.sendEvent("onError", payload) }
        )
        self.sessions[browseId] = session
        session.start()
      }
      return browseId
    }

    Function("stopBrowse") { (browseId: Int) in
      DispatchQueue.main.async { [weak self] in
        self?.sessions.removeValue(forKey: browseId)?.stop()
      }
    }

    Function("stopAll") {
      DispatchQueue.main.async { [weak self] in
        self?.stopAllSessions()
      }
    }

    OnDestroy {
      DispatchQueue.main.async { [weak self] in
        self?.stopAllSessions()
      }
    }
  }

  private func stopAllSessions() {
    sessions.values.forEach { $0.stop() }
    sessions.removeAll()
  }
}

// DNS-SD meta-query: its results are service types on the network, not service instances.
private let serviceTypesQuery = "_services._dns-sd._udp."

private final class BrowseSession: NSObject, NetServiceBrowserDelegate, NetServiceDelegate {
  private let browseId: Int
  private let type: String
  private let browser = NetServiceBrowser()
  // NetService objects must stay referenced while they resolve.
  private var services: [NetService] = []
  private let onResolved: ([String: Any]) -> Void
  private let onServiceType: ([String: Any]) -> Void
  private let onError: ([String: Any]) -> Void
  private var stopped = false

  init(
    browseId: Int,
    type: String,
    onResolved: @escaping ([String: Any]) -> Void,
    onServiceType: @escaping ([String: Any]) -> Void,
    onError: @escaping ([String: Any]) -> Void
  ) {
    self.browseId = browseId
    self.type = type
    self.onResolved = onResolved
    self.onServiceType = onServiceType
    self.onError = onError
  }

  func start() {
    browser.delegate = self
    browser.searchForServices(ofType: type, inDomain: "local.")
  }

  func stop() {
    stopped = true
    browser.delegate = nil
    browser.stop()
    for service in services {
      service.delegate = nil
      service.stop()
    }
    services.removeAll()
  }

  // MARK: NetServiceBrowserDelegate

  func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
    guard !stopped else { return }
    if type == serviceTypesQuery {
      // A meta-query answer names a type: name "_googlecast", type "_tcp.local." -> "_googlecast._tcp".
      let proto = service.type.split(separator: ".").first.map(String.init) ?? ""
      onServiceType(["browseId": browseId, "serviceType": "\(service.name).\(proto)"])
      return
    }
    services.append(service)
    service.delegate = self
    service.resolve(withTimeout: 5)
  }

  func netServiceBrowser(_ browser: NetServiceBrowser, didNotSearch errorDict: [String: NSNumber]) {
    guard !stopped else { return }
    // -72008 (NSNetServicesMissingRequiredConfigurationError): type missing from NSBonjourServices.
    // -65570 (kDNSServiceErr_PolicyDenied): Local Network access is turned off for the app.
    let code = errorDict[NetService.errorCode]?.intValue ?? 0
    onError([
      "browseId": browseId,
      "type": type,
      "code": code,
      "message": "Bonjour browse for \(type) failed (\(code))",
    ])
  }

  // MARK: NetServiceDelegate

  func netServiceDidResolveAddress(_ sender: NetService) {
    guard !stopped else { return }
    let addresses = (sender.addresses ?? []).compactMap(Self.numericHost)
    onResolved([
      "browseId": browseId,
      "type": type,
      "name": sender.name,
      "domain": sender.domain,
      // e.g. "Living Room._googlecast._tcp.local."
      "fullName": "\(sender.name).\(sender.type)\(sender.domain)",
      "host": sender.hostName ?? "",
      "port": sender.port,
      "addresses": addresses,
      "txt": Self.decodeTxt(sender.txtRecordData()),
    ])
  }

  func netService(_ sender: NetService, didNotResolve errorDict: [String: NSNumber]) {
    // A service that doesn't resolve is simply not reported.
  }

  // MARK: Helpers

  private static func numericHost(_ data: Data) -> String? {
    data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) -> String? in
      guard let base = raw.baseAddress else { return nil }
      let sockaddrPointer = base.assumingMemoryBound(to: sockaddr.self)
      var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
      let result = getnameinfo(
        sockaddrPointer,
        socklen_t(data.count),
        &host,
        socklen_t(host.count),
        nil,
        0,
        NI_NUMERICHOST
      )
      guard result == 0 else { return nil }
      return String(cString: host)
    }
  }

  private static func decodeTxt(_ data: Data?) -> [String: String] {
    guard let data else { return [:] }
    var txt: [String: String] = [:]
    for (key, value) in NetService.dictionary(fromTXTRecord: data) {
      txt[key] = String(data: value, encoding: .utf8) ?? ""
    }
    return txt
  }
}

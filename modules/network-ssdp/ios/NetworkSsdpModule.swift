import ExpoModulesCore
import Foundation

private let ssdpAddress = "239.255.255.250"
private let ssdpPort: UInt16 = 1900

// SSDP (UPnP) search over a raw UDP socket. On a real iPhone, sending multicast needs Apple's
// com.apple.developer.networking.multicast entitlement; without it sendto() fails.
public final class NetworkSsdpModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NetworkSsdp")

    // Sends M-SEARCH for each target and resolves with every reply received within timeoutMs:
    // { replies: [{ ip, port, message }], sent, interfaceName }. message is the raw reply text.
    AsyncFunction("search") { (timeoutMs: Int, searchTargets: [String], mx: Int, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let result = try runSearch(timeoutMs: timeoutMs, searchTargets: searchTargets, mx: mx)
          promise.resolve(result)
        } catch let error as SsdpError {
          promise.reject(error.code, error.message)
        } catch {
          promise.reject("ERR_SSDP", error.localizedDescription)
        }
      }
    }
  }
}

private struct SsdpError: Error {
  let code: String
  let message: String

  static func posix(_ code: String, _ what: String) -> SsdpError {
    SsdpError(code: code, message: "\(what) failed: \(String(cString: strerror(errno))) (\(errno))")
  }
}

// UDP drops packets, so every search target is sent this many times, this far apart.
private let sendRepeats = 3
private let sendSpacing: TimeInterval = 0.4

private func runSearch(timeoutMs: Int, searchTargets: [String], mx: Int) throws -> [String: Any] {
  let fd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)
  guard fd >= 0 else { throw SsdpError.posix("ERR_SSDP_SOCKET", "socket") }
  defer { close(fd) }

  var ttl: UInt8 = 2
  setsockopt(fd, IPPROTO_IP, IP_MULTICAST_TTL, &ttl, socklen_t(MemoryLayout<UInt8>.size))

  // Short receive timeout so the loop can check the deadline.
  var tv = timeval(tv_sec: 0, tv_usec: 100_000)
  setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))

  var destination = sockaddr_in()
  destination.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
  destination.sin_family = sa_family_t(AF_INET)
  destination.sin_port = ssdpPort.bigEndian
  inet_pton(AF_INET, ssdpAddress, &destination.sin_addr)

  let targets = searchTargets.isEmpty ? ["ssdp:all"] : searchTargets
  let messages = targets.map { target in
    Array([
      "M-SEARCH * HTTP/1.1",
      "HOST: \(ssdpAddress):\(ssdpPort)",
      "MAN: \"ssdp:discover\"",
      "MX: \(mx)",
      "ST: \(target)",
      "USER-AGENT: iOS UPnP/1.1 NetworkScanPOC/1.0",
      "",
      "",
    ].joined(separator: "\r\n").utf8)
  }

  var replies: [[String: Any]] = []
  var buffer = [UInt8](repeating: 0, count: 8192)
  let start = Date()
  let deadline = start.addingTimeInterval(Double(timeoutMs) / 1000)
  var round = 0
  var sent = 0

  while Date() < deadline {
    if round < sendRepeats && Date() >= start.addingTimeInterval(Double(round) * sendSpacing) {
      for bytes in messages {
        let result = withUnsafePointer(to: &destination) { pointer in
          pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { address in
            sendto(fd, bytes, bytes.count, 0, address, socklen_t(MemoryLayout<sockaddr_in>.size))
          }
        }
        if result >= 0 { sent += 1 }
      }
      round += 1
      if round == sendRepeats && sent == 0 { throw SsdpError.posix("ERR_SSDP_SEND", "sendto") }
    }

    var from = sockaddr_in()
    var fromLength = socklen_t(MemoryLayout<sockaddr_in>.size)
    let count = withUnsafeMutablePointer(to: &from) { pointer in
      pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { address in
        recvfrom(fd, &buffer, buffer.count, 0, address, &fromLength)
      }
    }
    if count < 0 {
      if errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR { continue }
      throw SsdpError.posix("ERR_SSDP_RECEIVE", "recvfrom")
    }

    var ipBuffer = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
    inet_ntop(AF_INET, &from.sin_addr, &ipBuffer, socklen_t(INET_ADDRSTRLEN))
    replies.append([
      "ip": String(cString: ipBuffer),
      "port": Int(UInt16(bigEndian: from.sin_port)),
      "message": String(decoding: buffer[0..<count], as: UTF8.self),
    ])
  }
  return ["replies": replies, "sent": sent]
}

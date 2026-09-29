import { describe, expect, it } from '@jest/globals';

import { scoreConfidence, tierFor, TIER_LABELS } from '../confidence';
import { createMockDeviceRepository, toScanSubmission } from '../device-repository';
import { displayFields, NOT_AVAILABLE } from '../display';
import { enrich, matchKnown } from '../enrich';
import { identityKeys, keysConflict, macFromSonosId, normalizeMac } from '../fingerprint';
import { identify } from '../identify';
import { cleanServiceType } from '../mdns-browser';
import { mergeDevices } from '../merge';
import { normalizeMdns, normalizeServiceType, pickIp, RawMdnsService } from '../normalize-mdns';
import { normalizeSsdp, parseSsdpHeaders, parseUpnpDescription, udnFromUsn } from '../normalize-ssdp';
import { suggestRoom } from '../room';
import { canFetchDescription, dedupeReplies } from '../ssdp-scan';
import { DiscoveredDevice, KnownDevice } from '../types';

const T = 1_700_000_000_000;

function mdns(raw: Partial<RawMdnsService> & Pick<RawMdnsService, 'type'>) {
  return normalizeMdns({ platform: 'ios', ...raw }, T);
}

function device(partial: Partial<DiscoveredDevice>): DiscoveredDevice {
  const keys = identityKeys(partial);
  return {
    id: keys[0],
    identityKeys: keys,
    services: [],
    ports: [],
    sources: ['mdns'],
    lastSeenAt: T,
    ...partial,
  };
}

function known(partial: Partial<KnownDevice> & Pick<KnownDevice, 'id' | 'identityKeys'>): KnownDevice {
  return { homeId: 'h1', name: 'Device', roomConfirmed: false, addedAt: T, ...partial };
}

const SONOS_XML = `<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <device>
    <deviceType>urn:schemas-upnp-org:device:ZonePlayer:1</deviceType>
    <friendlyName>192.168.1.30 - Sonos One - RINCON_B8E937AABBCC01400</friendlyName>
    <manufacturer>Sonos, Inc.</manufacturer>
    <modelName>Sonos One</modelName>
    <UDN>uuid:RINCON_B8E937AABBCC01400</UDN>
    <deviceList>
      <device>
        <deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType>
        <friendlyName>Sub-device (should be ignored)</friendlyName>
        <manufacturer>Other</manufacturer>
      </device>
    </deviceList>
  </device>
</root>`;

describe('identify', () => {
  it('identifies a Sonos speaker from its UPnP manufacturer', () => {
    const d = normalizeSsdp({ ip: '192.168.1.30', headers: {} }, parseUpnpDescription(SONOS_XML), T);
    expect(identify(d)).toMatchObject({ manufacturer: 'Sonos', deviceType: 'Speaker' });
  });

  it('identifies a Sonos speaker from mDNS _sonos._tcp alone', () => {
    const d = mdns({ type: '_sonos._tcp', name: 'Kitchen', addresses: ['192.168.1.31'] });
    const id = identify(d);
    expect(id).toMatchObject({ manufacturer: 'Sonos', deviceType: 'Speaker' });
    expect(id.reasons).toContain('Advertises _sonos._tcp');
  });

  it('identifies a Crestron control system', () => {
    const d = device({ ip: '192.168.1.40', manufacturer: 'Crestron Electronics, Inc.', model: 'CP4' });
    expect(identify(d)).toMatchObject({ manufacturer: 'Crestron', deviceType: 'Control System' });
  });

  it('identifies Crestron from the device name when no manufacturer is reported', () => {
    const d = device({ ip: '192.168.1.41', name: 'CRESTRON-CP4-00107F' });
    expect(identify(d).manufacturer).toBe('Crestron');
  });

  it('falls back to Unknown when nothing matches', () => {
    const d = device({ ip: '192.168.1.99', name: 'thing' });
    expect(identify(d)).toEqual({ manufacturer: 'Unknown', deviceType: 'Unknown', reasons: [] });
  });

  it('does not call a Samsung phone a TV', () => {
    const d = device({ ip: '192.168.1.50', manufacturer: 'Samsung', model: 'Galaxy S24' });
    expect(identify(d).deviceType).toBe('Unknown');
  });

  it('uses the protocol for the type when the maker is unknown', () => {
    const d = mdns({ type: '_googlecast._tcp', name: 'TV', addresses: ['192.168.1.60'] });
    expect(identify(d)).toMatchObject({ manufacturer: 'Unknown', deviceType: 'Media Streamer' });
  });
});

describe('merge', () => {
  it('merges an mDNS and an SSDP result for the same Sonos into one device', () => {
    const fromMdns = mdns({
      type: '_sonos._tcp',
      name: 'RINCON_B8E937AABBCC01400@Kitchen',
      addresses: ['192.168.1.30'],
      port: 1443,
    });
    const fromSsdp = normalizeSsdp(
      { ip: '192.168.1.30', headers: { location: 'http://192.168.1.30:1400/xml/device_description.xml' } },
      parseUpnpDescription(SONOS_XML),
      T
    );
    const merged = mergeDevices([fromMdns, fromSsdp]);
    expect(merged).toHaveLength(1);
    expect(merged[0].sources).toEqual(['mdns', 'ssdp']);
    expect(merged[0].ports).toEqual([1400, 1443]);
    expect(merged[0].id).toBe('udn:uuid:rincon_b8e937aabbcc01400');
    expect(merged[0].manufacturer).toBe('Sonos, Inc.');
  });

  it('merges a chain: A~B by host, B~C by IP', () => {
    const a = device({ hostname: 'tv.local', name: 'A' });
    const c = device({ ip: '192.168.1.70', name: 'C', sources: ['ssdp'] });
    const b = device({ hostname: 'tv.local', ip: '192.168.1.70' });
    const merged = mergeDevices([a, c, b]);
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe('A');
    expect(merged[0].identityKeys).toEqual(['host:tv.local', 'ip:192.168.1.70']);
  });

  it('keeps devices with no shared key apart and in order', () => {
    const merged = mergeDevices([device({ ip: '10.0.0.2' }), device({ ip: '10.0.0.3' }), device({ ip: '10.0.0.2' })]);
    expect(merged.map((d) => d.ip)).toEqual(['10.0.0.2', '10.0.0.3']);
  });

  it('ranks identity keys udn > mac > castid > host > ip', () => {
    const keys = identityKeys({
      ip: '10.0.0.5',
      hostname: 'x.local',
      castId: 'ABCD',
      mac: 'AA:BB:CC:00:11:22',
      udn: 'uuid:X',
    });
    expect(keys).toEqual(['udn:uuid:x', 'mac:aa:bb:cc:00:11:22', 'castid:abcd', 'host:x.local', 'ip:10.0.0.5']);
  });
});

describe('room', () => {
  it('finds a room in the device name', () => {
    expect(suggestRoom({ name: 'Living Room TV' })).toEqual({ roomName: 'Living Room', source: 'name' });
  });

  it('prefers the longer room name', () => {
    expect(suggestRoom({ name: 'Master Bedroom Speaker' })?.roomName).toBe('Master Bedroom');
  });

  it('finds a room in a host name written as one word', () => {
    expect(suggestRoom({ name: 'Chromecast-1234', hostname: 'livingroom-tv.local' })).toEqual({
      roomName: 'Living Room',
      source: 'hostname',
    });
  });

  it('splits camel case and does not match inside words', () => {
    expect(suggestRoom({ name: 'KitchenSpeaker' })?.roomName).toBe('Kitchen');
    expect(suggestRoom({ name: 'Garden Lights' })).toBeUndefined();
  });
});

describe('MAC handling', () => {
  it('normalizes MAC formats', () => {
    expect(normalizeMac('B8-E9-37-AA-BB-CC')).toBe('b8:e9:37:aa:bb:cc');
    expect(normalizeMac('b8e937aabbcc')).toBe('b8:e9:37:aa:bb:cc');
  });

  it('rejects placeholder MACs, including the phone-own 02:00:00:00:00:00', () => {
    expect(normalizeMac('00:00:00:00:00:00')).toBeUndefined();
    expect(normalizeMac('FF:FF:FF:FF:FF:FF')).toBeUndefined();
    expect(normalizeMac('02:00:00:00:00:00')).toBeUndefined();
    expect(normalizeMac('not a mac')).toBeUndefined();
  });

  it('reads the MAC from a Sonos RINCON id', () => {
    expect(macFromSonosId('uuid:RINCON_B8E937AABBCC01400')).toBe('b8:e9:37:aa:bb:cc');
  });

  it('reads the MAC AirPlay advertises in TXT deviceid', () => {
    const d = mdns({ type: '_airplay._tcp', name: 'Apple TV', txt: { deviceid: 'AA:BB:CC:DD:EE:FF', model: 'AppleTV14,1' } });
    expect(d.mac).toBe('aa:bb:cc:dd:ee:ff');
    expect(identify(d)).toMatchObject({ manufacturer: 'Apple', deviceType: 'Media Streamer' });
  });

  it('reads the MAC from a RAOP name and strips it from the display name', () => {
    const d = mdns({ type: '_raop._tcp', name: 'AABBCCDDEEFF@Bedroom HomePod' });
    expect(d.mac).toBe('aa:bb:cc:dd:ee:ff');
    expect(d.name).toBe('Bedroom HomePod');
  });

  it('never invents a MAC for services that do not advertise one', () => {
    expect(mdns({ type: '_http._tcp', name: 'Printer', addresses: ['10.0.0.9'] }).mac).toBeUndefined();
  });

  it('shows a missing MAC as "Not available"', () => {
    const fields = displayFields(device({ ip: '10.0.0.9' }));
    expect(fields.find((f) => f.label === 'MAC')?.value).toBe(NOT_AVAILABLE);
  });
});

describe('known devices', () => {
  it('keeps a confirmed room when the device changes IP', () => {
    const saved = known({
      id: 'k1',
      name: 'Kitchen Sonos',
      identityKeys: ['udn:uuid:rincon_b8e937aabbcc01400', 'ip:192.168.1.30'],
      roomName: 'Office',
      roomConfirmed: true,
    });
    const now = device({ udn: 'uuid:RINCON_B8E937AABBCC01400', ip: '192.168.1.99', name: 'Living Room Sonos' });
    const [home] = enrich([now], [saved]);
    expect(home.status).toBe('seen');
    expect(home.known?.id).toBe('k1');
    expect(home.room).toEqual({ roomName: 'Office', source: 'known' });
  });

  it('does not match a different device that took over a known IP', () => {
    const saved = known({ id: 'k1', identityKeys: ['udn:uuid:a', 'ip:192.168.1.30'] });
    const other = device({ udn: 'uuid:B', ip: '192.168.1.30' });
    expect(keysConflict(other.identityKeys, saved.identityKeys)).toBe(true);
    expect(matchKnown(other, [saved])).toBeUndefined();
  });

  it('marks known devices that did not answer as not-seen (never offline)', () => {
    const result = enrich([], [known({ id: 'k1', identityKeys: ['ip:10.0.0.1'] })]);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('not-seen');
  });

  it('mock repository saves devices and updates them from a submitted scan', async () => {
    const repo = createMockDeviceRepository();
    const saved = await repo.saveDevice('h1', { name: 'TV', identityKeys: ['castid:abc', 'ip:10.0.0.4'] });
    const scanned = device({ castId: 'abc', ip: '10.0.0.8' });
    const result = await repo.submitScan('h1', toScanSubmission([scanned], T));
    expect(result).toEqual({ received: 1, matched: 1, notSeen: 0 });
    const [updated] = await repo.listKnownDevices('h1');
    expect(updated.id).toBe(saved.id);
    expect(updated.lastIp).toBe('10.0.0.8');
    expect(updated.lastSeenAt).toBe(T);
    expect(updated.identityKeys).toEqual(['castid:abc', 'ip:10.0.0.8']);
  });
});

describe('confidence', () => {
  it('maps scores to tiers and spec labels', () => {
    expect(tierFor(85)).toBe('hi');
    expect(tierFor(50)).toBe('md');
    expect(tierFor(10)).toBe('lo');
    expect(TIER_LABELS).toEqual({ hi: 'Probably', md: 'Still learning', lo: 'Still learning' });
  });

  it('scores a well-identified device high and an IP-only device low', () => {
    const sonos = normalizeSsdp({ ip: '192.168.1.30', headers: {} }, parseUpnpDescription(SONOS_XML), T);
    const high = scoreConfidence({ discovered: sonos, identification: identify(sonos) });
    expect(high.tier).toBe('hi');
    const bare = device({ ip: '10.0.0.1' });
    expect(scoreConfidence({ discovered: bare, identification: identify(bare) }).tier).toBe('lo');
  });
});

describe('platform parsing', () => {
  it('iOS: uses the real host name and a routable IPv4 address', () => {
    const d = normalizeMdns(
      {
        platform: 'ios',
        type: '_googlecast._tcp',
        name: 'Chromecast-abc',
        fullName: 'Chromecast-abc._googlecast._tcp.local.',
        host: 'Living-Room-TV.local.',
        addresses: ['fe80::1', '169.254.3.3', '192.168.1.20'],
        port: 8009,
        txt: { fn: 'Living Room TV', md: 'Chromecast Ultra', id: '0123456789ABCDEF0123456789ABCDEF' },
      },
      T
    );
    expect(d).toMatchObject({
      name: 'Living Room TV',
      model: 'Chromecast Ultra',
      ip: '192.168.1.20',
      hostname: 'living-room-tv.local',
      castId: '0123456789abcdef0123456789abcdef',
      ports: [8009],
    });
    expect(d.id).toBe('castid:0123456789abcdef0123456789abcdef');
  });

  it('Android: treats the host field as the service name, not a host', () => {
    const d = normalizeMdns(
      { platform: 'android', type: '_http._tcp', name: 'My NAS', fullName: 'My NAS', host: 'My NAS', addresses: ['10.0.0.5'] },
      T
    );
    expect(d.hostname).toBeUndefined();
    expect(d.name).toBe('My NAS');
    expect(d.identityKeys).toEqual(['ip:10.0.0.5']);
  });

  it('Android (NsdManager): empty host, IPv4 first, printer identified by protocol', () => {
    const d = normalizeMdns(
      {
        platform: 'android',
        type: '_ipp._tcp',
        name: 'Office Printer',
        fullName: 'Office Printer._ipp._tcp.local.',
        host: '',
        addresses: ['192.168.1.44', 'fe80::2'],
        port: 631,
        txt: { ty: 'HP LaserJet' },
      },
      T
    );
    expect(d).toMatchObject({ name: 'Office Printer', ip: '192.168.1.44', ports: [631] });
    expect(d.hostname).toBeUndefined();
    expect(identify(d).deviceType).toBe('Printer');
  });

  it('cleans meta-query service types, including UDP types', () => {
    expect(cleanServiceType('_googlecast._tcp.local.')).toBe('_googlecast._tcp');
    expect(cleanServiceType('_matterc._udp.')).toBe('_matterc._udp');
    expect(normalizeServiceType('_matterc._udp')).toBe('_matterc._udp');
  });

  it('iOS: recovers the instance name from fullName when name is missing', () => {
    expect(mdns({ type: '_http._tcp.', fullName: 'Printer._http._tcp.local.' }).name).toBe('Printer');
    expect(normalizeServiceType('_http._tcp.')).toBe('_http._tcp');
    expect(pickIp([])).toBeUndefined();
  });

  it('parses SSDP headers and USNs', () => {
    const headers = parseSsdpHeaders(
      'HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=1800\r\nLOCATION: http://10.0.0.2:49152/desc.xml\r\nUSN: uuid:abc-123::upnp:rootdevice\r\n\r\n'
    );
    expect(headers.location).toBe('http://10.0.0.2:49152/desc.xml');
    expect(udnFromUsn(headers.usn)).toBe('uuid:abc-123');
  });

  it('parses only the root device of a UPnP description, decoding entities', () => {
    const d = parseUpnpDescription(SONOS_XML.replace('Sonos, Inc.', 'Sonos &amp; Co'));
    expect(d).toMatchObject({
      manufacturer: 'Sonos & Co',
      modelName: 'Sonos One',
      udn: 'uuid:RINCON_B8E937AABBCC01400',
      deviceType: 'urn:schemas-upnp-org:device:ZonePlayer:1',
    });
  });

  it('LG webOS: replies to LG search targets collapse to one device with the reported name and model', () => {
    const usn = 'uuid:12345678-abcd-ef01-2345-6789abcdef01';
    const location = 'http://192.168.1.50:1990/device.xml';
    const replies = dedupeReplies([
      { ip: '192.168.1.50', headers: parseSsdpHeaders(`HTTP/1.1 200 OK\r\nLOCATION: ${location}\r\nST: urn:lge-com:service:webos-second-screen:1\r\nUSN: ${usn}::urn:lge-com:service:webos-second-screen:1\r\n\r\n`) },
      { ip: '192.168.1.50', headers: parseSsdpHeaders(`HTTP/1.1 200 OK\r\nLOCATION: ${location}\r\nST: urn:dial-multiscreen-org:service:dial:1\r\nUSN: ${usn}::urn:dial-multiscreen-org:service:dial:1\r\n\r\n`) },
    ]);
    expect(replies).toHaveLength(1);
    expect(canFetchDescription(replies[0])).toBe(true);

    const description = parseUpnpDescription(`<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <device>
    <deviceType>urn:schemas-upnp-org:device:Basic:1</deviceType>
    <friendlyName>[LG] webOS TV OLED55C1PUB</friendlyName>
    <manufacturer>LG Electronics</manufacturer>
    <modelName>OLED55C1PUB</modelName>
    <UDN>${usn}</UDN>
  </device>
</root>`);
    const d = normalizeSsdp(replies[0], description, T);
    expect(d).toMatchObject({
      name: '[LG] webOS TV OLED55C1PUB',
      manufacturer: 'LG Electronics',
      model: 'OLED55C1PUB',
      ip: '192.168.1.50',
      ports: [1990],
    });
    expect(d.id).toBe(`udn:${usn}`);
  });

  it('does not report an LG manufacturer for an SSDP device that does not say so', () => {
    const d = normalizeSsdp({ ip: '192.168.1.60', headers: { st: 'urn:dial-multiscreen-org:service:dial:1' } }, {}, T);
    expect(d.manufacturer).toBeUndefined();
    expect(d.model).toBeUndefined();
  });

  it('keeps one SSDP reply per device and fetches only from the replying IP', () => {
    const replies = dedupeReplies([
      { ip: '10.0.0.2', headers: { usn: 'uuid:a::upnp:rootdevice', location: 'http://10.0.0.2:1/d.xml' } },
      { ip: '10.0.0.2', headers: { usn: 'uuid:a::urn:x', location: 'http://10.0.0.2:1/d.xml' } },
      { ip: '10.0.0.3', headers: { usn: 'uuid:b::upnp:rootdevice', location: 'http://example.com/d.xml' } },
    ]);
    expect(replies).toHaveLength(2);
    expect(canFetchDescription(replies[0])).toBe(true);
    expect(canFetchDescription(replies[1])).toBe(false);
  });
});

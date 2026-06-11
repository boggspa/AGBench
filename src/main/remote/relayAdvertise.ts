/*
 * relayAdvertise — pick the address the embedded relay should advertise in
 * the pairing QR. The URL is consumed by the PHONE, so it must be an address
 * the phone can actually reach:
 *
 *   1. The Mac's Tailscale IP (100.64.0.0/10 CGNAT range) when present —
 *      works across networks, survives Wi-Fi changes, the recommended setup.
 *   2. Otherwise the first non-internal private IPv4 (same-Wi-Fi pairing).
 *   3. Otherwise loopback — only the simulator can reach that; we log it.
 *
 * Pure given an interface map (injectable for tests).
 */

import os from 'os'

type InterfaceMap = NodeJS.Dict<os.NetworkInterfaceInfo[]>

function isTailscaleAddress(address: string): boolean {
  // 100.64.0.0/10 — second octet 64..127.
  const octets = address.split('.').map(Number)
  return octets.length === 4 && octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127
}

function isPrivateAddress(address: string): boolean {
  const octets = address.split('.').map(Number)
  if (octets.length !== 4) return false
  if (octets[0] === 10) return true
  if (octets[0] === 192 && octets[1] === 168) return true
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true
  return false
}

export function pickRelayAdvertiseHost(
  interfaces: InterfaceMap = os.networkInterfaces()
): { host: string; kind: 'tailscale' | 'lan' | 'loopback' } {
  const candidates: os.NetworkInterfaceInfo[] = []
  for (const list of Object.values(interfaces)) {
    for (const info of list ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue
      candidates.push(info)
    }
  }
  const tailscale = candidates.find((info) => isTailscaleAddress(info.address))
  if (tailscale) return { host: tailscale.address, kind: 'tailscale' }
  const lan = candidates.find((info) => isPrivateAddress(info.address))
  if (lan) return { host: lan.address, kind: 'lan' }
  return { host: '127.0.0.1', kind: 'loopback' }
}

export function embeddedRelayUrl(port: number, interfaces?: InterfaceMap): string {
  const { host } = pickRelayAdvertiseHost(interfaces)
  return `ws://${host}:${port}`
}

function normaliseHost(host: string): string {
  return host.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
}

export function isLocalPlainRelayUrl(
  relayUrl: string,
  interfaces: InterfaceMap = os.networkInterfaces(),
  hostname: string = os.hostname()
): boolean {
  let parsed: URL
  try {
    parsed = new URL(relayUrl)
  } catch {
    return false
  }
  if (parsed.protocol !== 'ws:') return false

  const host = normaliseHost(parsed.hostname)
  const bareHostname = normaliseHost(hostname).replace(/\.local$/, '')
  const localHostnames = new Set([
    'localhost',
    '127.0.0.1',
    '::1',
    normaliseHost(hostname),
    bareHostname,
    `${bareHostname}.local`
  ])
  if (localHostnames.has(host)) return true

  for (const list of Object.values(interfaces)) {
    for (const info of list ?? []) {
      if (normaliseHost(info.address) === host) return true
    }
  }
  return false
}

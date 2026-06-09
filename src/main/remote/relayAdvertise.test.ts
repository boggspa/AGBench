import { describe, it, expect } from 'vitest'
import os from 'os'
import { embeddedRelayUrl, pickRelayAdvertiseHost } from './relayAdvertise'

function iface(address: string, internal = false): os.NetworkInterfaceInfo {
  return {
    address,
    netmask: '255.255.255.0',
    family: 'IPv4',
    mac: '00:00:00:00:00:00',
    internal,
    cidr: `${address}/24`
  }
}

describe('pickRelayAdvertiseHost', () => {
  it('prefers the Tailscale CGNAT address over LAN', () => {
    const picked = pickRelayAdvertiseHost({
      en0: [iface('192.168.1.50')],
      utun4: [iface('100.99.131.73')]
    })
    expect(picked).toEqual({ host: '100.99.131.73', kind: 'tailscale' })
  })

  it('falls back to a private LAN address (10.x / 172.16-31 / 192.168)', () => {
    expect(pickRelayAdvertiseHost({ en0: [iface('192.168.1.50')] }).kind).toBe('lan')
    expect(pickRelayAdvertiseHost({ en0: [iface('10.0.0.7')] }).host).toBe('10.0.0.7')
    expect(pickRelayAdvertiseHost({ en0: [iface('172.20.1.2')] }).kind).toBe('lan')
    // 172.32.x is NOT private — must not be picked over loopback.
    expect(pickRelayAdvertiseHost({ en0: [iface('172.32.1.2')] }).kind).toBe('loopback')
  })

  it('ignores internal interfaces and lands on loopback when nothing qualifies', () => {
    const picked = pickRelayAdvertiseHost({ lo0: [iface('127.0.0.1', true)] })
    expect(picked).toEqual({ host: '127.0.0.1', kind: 'loopback' })
  })

  it('100.x addresses outside 100.64/10 are not treated as Tailscale', () => {
    const picked = pickRelayAdvertiseHost({
      en0: [iface('100.20.1.1'), iface('192.168.1.9')]
    })
    expect(picked).toEqual({ host: '192.168.1.9', kind: 'lan' })
  })

  it('embeddedRelayUrl composes ws://host:port', () => {
    expect(embeddedRelayUrl(8787, { utun4: [iface('100.99.131.73')] })).toBe(
      'ws://100.99.131.73:8787'
    )
  })
})

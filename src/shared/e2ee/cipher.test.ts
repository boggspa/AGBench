import { describe, it, expect } from 'vitest'
import { randomBytes } from 'crypto'
import { buildNonce, open, seal } from './cipher'

const KEY = randomBytes(32)
const SESSION = 'sess-abc'

describe('seal/open', () => {
  it('round-trips a plaintext', () => {
    const pt = Buffer.from('hello taskwraith')
    const sealed = seal(KEY, 'mac->iphone', SESSION, 7, pt)
    expect(sealed.tag.length).toBe(16)
    const opened = open(KEY, 'mac->iphone', SESSION, 7, sealed)
    expect(opened.toString()).toBe('hello taskwraith')
  })

  it('nonce = direction prefix ‖ big-endian seq', () => {
    const n = buildNonce('iphone->mac', 5)
    expect(n.length).toBe(12)
    expect(n.readUInt32BE(0)).toBe(0x00000002)
    expect(Number(n.readBigUInt64BE(4))).toBe(5)
  })

  it('rejects a wrong key', () => {
    const sealed = seal(KEY, 'mac->iphone', SESSION, 1, Buffer.from('x'))
    expect(() => open(randomBytes(32), 'mac->iphone', SESSION, 1, sealed)).toThrow()
  })

  it('rejects a mismatched seq (AAD binding)', () => {
    const sealed = seal(KEY, 'mac->iphone', SESSION, 1, Buffer.from('x'))
    expect(() => open(KEY, 'mac->iphone', SESSION, 2, sealed)).toThrow()
  })

  it('rejects a mismatched sessionId (AAD binding)', () => {
    const sealed = seal(KEY, 'mac->iphone', SESSION, 1, Buffer.from('x'))
    expect(() => open(KEY, 'mac->iphone', 'other-session', 1, sealed)).toThrow()
  })

  it('rejects a forged wire nonce before decrypting', () => {
    const sealed = seal(KEY, 'mac->iphone', SESSION, 1, Buffer.from('x'))
    expect(() =>
      open(KEY, 'mac->iphone', SESSION, 1, { ...sealed, nonce: buildNonce('mac->iphone', 99) })
    ).toThrow('nonce mismatch')
  })

  it('rejects tampered ciphertext', () => {
    const sealed = seal(KEY, 'mac->iphone', SESSION, 1, Buffer.from('xyz'))
    const tampered = Buffer.from(sealed.ct)
    tampered[0] ^= 0xff
    expect(() => open(KEY, 'mac->iphone', SESSION, 1, { ...sealed, ct: tampered })).toThrow()
  })
})

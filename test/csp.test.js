import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {RELAYS} from '../src/relays.js'

test('CSP connect-src is exactly self plus RELAYS', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const csp = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/)[1]
  const connect = csp.split(';').map(s => s.trim()).find(s => s.startsWith('connect-src '))
  assert.deepEqual(connect.split(/\s+/).slice(1).sort(), ["'self'", ...RELAYS].sort())
})

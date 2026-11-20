// 簡易 CDP クライアント: node cdp.mjs eval '<js>' | shot <file> | console
const port = process.env.CDP_PORT ?? '9333'
const [cmd, ...rest] = process.argv.slice(2)
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
if (!page) { console.error('no page target', targets); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const events = []
ws.onmessage = (m) => {
  const d = JSON.parse(m.data)
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) }
  else if (d.method) events.push(d)
}
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
await new Promise((r) => (ws.onopen = r))
await send('Runtime.enable')
await send('Log.enable')
if (cmd === 'eval') {
  const r = await send('Runtime.evaluate', { expression: rest.join(' '), awaitPromise: true, returnByValue: true })
  console.log(JSON.stringify(r.result?.result?.value ?? r.result ?? r, null, 2))
} else if (cmd === 'shot') {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  const fs = await import('node:fs')
  fs.writeFileSync(rest[0], Buffer.from(r.result.data, 'base64'))
  console.log('saved', rest[0])
} else if (cmd === 'console') {
  await new Promise((r) => setTimeout(r, Number(rest[0] ?? 1000)))
  for (const e of events) if (e.method === 'Runtime.consoleAPICalled' || e.method === 'Runtime.exceptionThrown' || e.method === 'Log.entryAdded') console.log(JSON.stringify(e.params).slice(0, 600))
}
ws.close()

#!/usr/bin/env bun
import { Server } from "ssh2"
import { spawn } from "bun-pty"
import { readFileSync } from "fs"
import { resolve } from "path"
import { networkInterfaces } from "os"

const SSH_PORT = Number(process.env.SSH_PORT ?? 2222)
const HOST = process.env.SSH_HOST ?? "0.0.0.0"
const HOST_KEY_PATH = resolve(process.env.SSH_HOST_KEY ?? "ssh_host_key")
const CLIENT_SCRIPT = resolve(process.env.CLIENT_SCRIPT ?? "src/client.ts")
const SERVER_SCRIPT = resolve(process.env.SERVER_SCRIPT ?? "src/server.ts")
const BUN_BIN = process.env.BUN_BIN ?? "bun"
const AUTOSTART_SERVER = (process.env.AUTOSTART_SERVER ?? "1") !== "0"

const hostKey = readFileSync(HOST_KEY_PATH)

if (AUTOSTART_SERVER) {
  const proc = Bun.spawn([BUN_BIN, "run", SERVER_SCRIPT], {
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env },
  })
  console.log(`game server spawned (pid ${proc.pid})`)
  const cleanup = () => {
    try { proc.kill() } catch {}
  }
  process.on("SIGINT", () => { cleanup(); process.exit(0) })
  process.on("SIGTERM", () => { cleanup(); process.exit(0) })
  process.on("exit", cleanup)
}

const server = new Server({ hostKeys: [hostKey] }, (client) => {
  let addr = "unknown"
  client.on("authentication", (ctx) => ctx.accept())
  client.on("ready", () => {
    addr = (client as any)._sock?.remoteAddress ?? addr
    console.log(`ssh ready: ${addr}`)
  })

  client.on("session", (accept) => {
    const session = accept()
    let term = "xterm-256color"
    let cols = 80
    let rows = 24
    let pty: ReturnType<typeof spawn> | null = null

    session.on("pty", (acc, _rej, info) => {
      term = info.term || term
      cols = info.cols || cols
      rows = info.rows || rows
      acc()
    })
    session.on("window-change", (acc, _rej, info) => {
      cols = info.cols
      rows = info.rows
      pty?.resize(cols, rows)
      acc && acc()
    })

    const startClient = (ch: any) => {
      try {
        pty = spawn(BUN_BIN, ["run", CLIENT_SCRIPT], {
          name: term,
          cols,
          rows,
          env: { ...process.env, TERM: term, FORCE_COLOR: "1" },
        })
      } catch (e: any) {
        console.error(`spawn failed for ${addr}: ${e.message}`)
        try {
          ch.write(`spawn failed: ${e.message}\r\n`)
          ch.exit(1)
        } catch {}
        ch.end()
        return
      }
      pty.onData((d) => ch.write(d))
      pty.onExit(({ exitCode }) => {
        try {
          ch.exit(exitCode ?? 0)
        } catch {}
        ch.end()
      })
      ch.on("data", (d: Buffer) => pty?.write(d.toString("utf8")))
      ch.on("close", () => pty?.kill())
      console.log(`spawned client for ${addr} (${cols}x${rows} ${term})`)
    }

    session.on("shell", (acc) => startClient(acc()))
    session.on("exec", (acc) => startClient(acc()))
  })

  client.on("close", () => console.log(`ssh closed: ${addr}`))
  client.on("error", (e) => console.error(`ssh err ${addr}:`, e.message))
})

function getLanIPs(): string[] {
  const nets = networkInterfaces()
  const ips: string[] = []
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === "IPv4" && !net.internal) ips.push(net.address)
    }
  }
  return ips
}

async function getPublicIP(): Promise<string | null> {
  try {
    const res = await fetch("https://api.ipify.org", { signal: AbortSignal.timeout(2000) })
    return (await res.text()).trim()
  } catch {
    return null
  }
}

server.listen(SSH_PORT, HOST, async () => {
  console.log(`ssh listening on ${HOST}:${SSH_PORT}`)
  console.log("")
  console.log("=== Copy-paste to connect ===")
  console.log(`  ssh -p ${SSH_PORT} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null anyone@localhost`)
  for (const ip of getLanIPs()) {
    console.log(`  ssh -p ${SSH_PORT} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null anyone@${ip}`)
  }
  const pub = await getPublicIP()
  if (pub) {
    console.log(`  ssh -p ${SSH_PORT} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null anyone@${pub}  # public (needs port forward)`)
  }
  console.log("=============================")
})

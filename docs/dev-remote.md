# Remote dev: SSH port forwarding

You develop on a remote box (where the GPU + circom toolchain lives) but
preview the bounty UI in your **local** browser. SSH `LocalForward` is the
simplest way to do that — no public exposure, no extra tools, no auth shim.

This guide is for the **local** machine setup. The remote already has
the services configured; you just need to forward the right ports.

## TL;DR

After one-time setup below:

```bash
ssh zkx                        # opens shell + forwards 3000/7001/9090
# — in that shell on the server, start services as usual —
# — in your local browser: http://localhost:3000 —
```

---

## One-time setup (local machine)

### 1. Confirm SSH key access works

```bash
ssh <USER>@<SERVER>
```

If that asks for a password, set up key-based auth first (saves a lot of
typing):

```bash
# local
ssh-keygen -t ed25519                          # accept defaults
ssh-copy-id <USER>@<SERVER>                    # installs your pubkey
ssh <USER>@<SERVER>                            # should NOT ask for password now
```

### 2. Add a host entry to `~/.ssh/config`

Edit (or create) `~/.ssh/config` and append:

```
Host zkx
    HostName <SERVER hostname or IP>
    User <USER>
    # bounty UI
    LocalForward 3000 localhost:3000
    # witness service
    LocalForward 7001 localhost:7001
    # zkX prover
    LocalForward 9090 localhost:9090
    # nice-to-have
    ServerAliveInterval 30
    ServerAliveCountMax 4
```

Replace `<SERVER>` and `<USER>`. The alias `zkx` is arbitrary — anything
short works.

`ServerAliveInterval` keeps the connection from idle-timing-out while
you watch the modal animate.

### 3. Test it

```bash
ssh zkx
# (you should land in your shell on the server)
# In another local terminal:
curl -s http://localhost:3000/    # 200 only if dev server is running on the server
```

If the curl times out / refuses connection: see Troubleshooting below.

---

## Daily workflow

In one local terminal:

```bash
ssh zkx
# (now in remote shell)
cd ~/Workspace/zkx-snap
( cd witness && node app.js )                  # :7001
( cd prover  && python app.py )                # :9090 (in another tab)
( cd apps/bounty && npm run dev )              # :3000
```

In your local browser: **http://localhost:3000**

When you `exit` the SSH session, the forwards drop with it.

### Multiple tabs

Two clean ways to open multiple shells against the same forwarded
session:

- `tmux` on the server (recommended — persists through SSH disconnects):
  ```bash
  ssh zkx
  tmux new -s zkx                              # first time
  # … in tmux, start the three services in three panes …
  # detach with Ctrl-b d
  ssh zkx                                      # again later
  tmux attach -t zkx                           # reconnect to the same session
  ```
- Multiple `ssh zkx` from different local terminals: each opens its own
  channel, all sharing the same forwards. Simpler but services die when
  any one terminal closes if you started them in that terminal.

---

## Troubleshooting

### `bind: Address already in use`

Something is already listening on the local port. Either:

- Another `ssh zkx` is open (close it).
- A real local service uses the same port (kill it, or change the
  forward to `LocalForward 3001 localhost:3000` and visit `:3001`).

### Page loads but `/api/claim` hangs

The Next.js api route runs on the server and calls `localhost:7001`
(witness) and `localhost:9090` (prover). Those addresses are
**server-local** — your forwards to the same ports are unrelated. Make
sure the witness + prover services are actually running on the server.

### Connection drops every few minutes

Some networks aggressively kill idle TCP. The
`ServerAliveInterval`/`CountMax` lines fix this. If you copy/paste the
config block above, it's already there.

### Need to share with someone else (judge, teammate)

`LocalForward` is single-user. For a real shared URL, use
`ngrok http 3000` or `cloudflared tunnel --url http://localhost:3000`
on the server — both give a public HTTPS URL anyone can hit.

### Windows

- WSL2: same as Linux (use the WSL terminal, edit `~/.ssh/config` inside
  WSL).
- Native: PowerShell's `ssh` accepts the same `~/.ssh/config` (under
  `%USERPROFILE%\.ssh\config`). Or use PuTTY: load `Connection → SSH →
  Tunnels`, add three "Local" forwards (`L3000` → `localhost:3000`, etc.).

### VS Code / Cursor users

If you already use Remote-SSH, you don't need any of this — the editor
auto-forwards ports the moment a server starts listening. Open the
"Ports" tab in the bottom panel. The plain-`ssh` setup above is for
folks who code locally and only SSH in for runtime.

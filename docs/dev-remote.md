# Remote dev: SSH port forwarding

You develop on a remote box (where the GPU + circom toolchain lives) but
preview the bounty UI in your **local** browser. SSH `LocalForward` is the
simplest way to do that — no public exposure, no extra tools, no auth shim.

This guide is for the **local** machine setup. The remote already has
the services configured; you just need to forward the right ports.

## TL;DR

After one-time setup below:

```bash
ssh zkx                                # opens shell + forwards 13000/17001/19090
# — in that shell on the server, start services as usual —
# — in your local browser: http://localhost:13000 —
```

If you want the tunnel always-up (without re-typing `ssh zkx`), there's
an `autossh` recipe further down — at-login auto-start + auto-reconnect.

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
    # Local-side ports SHIFTED so they don't collide with anything you
    # might run locally on the same default port. See "Port shifting"
    # below for the rationale.
    LocalForward 13000 localhost:3000      # bounty UI
    LocalForward 17001 localhost:7001      # witness service
    LocalForward 19090 localhost:9090      # zkX prover
    ServerAliveInterval 30
    ServerAliveCountMax 4
    ExitOnForwardFailure yes
```

Replace `<SERVER>` and `<USER>`. The alias `zkx` is arbitrary — anything
short works.

`ServerAliveInterval` keeps the connection from idle-timing-out while
you watch the modal animate. `ExitOnForwardFailure yes` makes ssh fail
fast if a port is already taken (helpful with autossh — see below).

> **Browse to** `http://localhost:13000` (note the `1` prefix), not
> `:3000`. The shift means anything *you* run locally on `:3000` still
> works.

### 3. Test it

```bash
ssh zkx
# (you should land in your shell on the server)
# In another local terminal:
curl -s http://localhost:3000/    # 200 only if dev server is running on the server
```

If the curl times out / refuses connection: see Troubleshooting below.

---

## Port shifting (why `13000` instead of `3000`)

The line `LocalForward 3000 localhost:3000` says "bind **my** local port
3000 and forward everything to the server's 3000". That binds the
local port for the duration of the SSH session. While the tunnel is up:

- `localhost:3000` in your browser → the **server's** dev server
- Any local process trying to listen on 3000 → `EADDRINUSE`

If you ever code locally (run a Next dev on your laptop while also
having the tunnel up — same project, different machine), the local
`npm run dev` collides with the tunnel.

The workaround is trivial: shift the local-side number. The config
above uses `LocalForward 13000 localhost:3000`, so:

| URL in your browser | Where it lands       |
| ------------------- | -------------------- |
| `localhost:3000`    | **your laptop**'s dev server (no collision) |
| `localhost:13000`   | **server**'s dev server (via the tunnel)    |

The mnemonic — server's port with a leading `1`. Same trick for
`7001 → 17001`, `9090 → 19090`.

---

## Daily workflow

In one local terminal:

```bash
ssh zkx
# (now in remote shell)
cd ~/Workspace/zkx-live
( cd witness && node app.js )                  # :7001 on the server
( cd prover  && python app.py )                # :9090 on the server (another tab)
( cd apps/bounty && npm run dev )              # :3000 on the server
```

In your local browser: **http://localhost:13000**

When you `exit` the SSH session, the forwards drop with it.

## Make the tunnel persistent (`autossh`)

If you'd rather just leave the tunnel up all the time and not
re-`ssh zkx` whenever the connection dies, install `autossh`:

```bash
brew install autossh                           # macOS
sudo apt install autossh                       # Linux
```

One command, no shell, runs in the background, auto-reconnects on drop:

```bash
autossh -M 0 -N -f \
    -o "ServerAliveInterval 30" \
    -o "ServerAliveCountMax 4" \
    -o "ExitOnForwardFailure yes" \
    zkx
```

| Flag                    | Why                                                   |
| ----------------------- | ----------------------------------------------------- |
| `-M 0`                  | skip autossh's own monitor port (ServerAlive is enough) |
| `-N`                    | don't open a shell, just hold the tunnel              |
| `-f`                    | go background                                         |
| `ExitOnForwardFailure`  | exit immediately if a port can't bind → triggers reconnect |

Check it's alive:
```bash
ps aux | grep autossh
```

Stop it:
```bash
pkill autossh
```

### Auto-start at login (optional)

**macOS — launchd**. Save as `~/Library/LaunchAgents/com.user.zkx-tunnel.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>            <string>com.user.zkx-tunnel</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/autossh</string>
        <string>-M</string><string>0</string>
        <string>-N</string>
        <string>-o</string><string>ServerAliveInterval=30</string>
        <string>-o</string><string>ServerAliveCountMax=4</string>
        <string>-o</string><string>ExitOnForwardFailure=yes</string>
        <string>zkx</string>
    </array>
    <key>RunAtLoad</key>        <true/>
    <key>KeepAlive</key>        <true/>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.user.zkx-tunnel.plist
launchctl list | grep zkx-tunnel               # confirm running
```

(`/opt/homebrew/bin/autossh` is the Apple Silicon Homebrew path; on
Intel Macs it's `/usr/local/bin/autossh`. `which autossh` to check.)

**Linux — systemd user service**. Save as
`~/.config/systemd/user/zkx-tunnel.service`:

```ini
[Unit]
Description=Persistent SSH tunnel to zkx
After=network-online.target

[Service]
ExecStart=/usr/bin/autossh -M 0 -N \
    -o "ServerAliveInterval 30" \
    -o "ServerAliveCountMax 4" \
    -o "ExitOnForwardFailure yes" \
    zkx
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now zkx-tunnel
systemctl --user status zkx-tunnel             # confirm running
```

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

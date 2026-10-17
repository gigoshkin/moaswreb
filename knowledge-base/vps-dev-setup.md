# VPS dev setup: Claude Code + live Expo Go demos

Decided by George, 17 Oct 2026 (option A): Claude Code runs on George's VPS with Remote Control, the phone reaches the VPS over Tailscale, and George watches changes live in Expo Go. Why: the cloud sandbox can't accept connections from a phone and is blocked from TTC's API and Expo's servers.

Assumes Ubuntu 22.04/24.04 with at least 4 GB RAM. `VPS_IP` is the public IP. Run as root (or with sudo) unless a step says `dev`.

## 1. Server basics (as root)
```sh
ssh root@VPS_IP
apt update && apt install -y git curl ca-certificates build-essential tmux ufw
adduser --disabled-password --gecos "" dev        # the agent runs as this user, not root
```

## 2. Node 24 and Docker (as root)
```sh
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt install -y nodejs
curl -fsSL https://get.docker.com | sh
usermod -aG docker dev
node -v   # v24.x
```

## 3. Tailscale: private network between phone and VPS (as root)
```sh
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up            # open the printed link and log in
tailscale ip -4         # note this 100.x.y.z address
```
On the phone: install the Tailscale app, log in with the same account, turn it on.

## 4. Firewall: only SSH from the internet, everything else via Tailscale (as root)
```sh
ufw allow OpenSSH
ufw allow in on tailscale0
ufw enable
```
The dev server (8081) and API (3000) are then reachable only from devices on your tailnet.

## 5. GitHub access for the repo (as dev)
```sh
su - dev
ssh-keygen -t ed25519 -C "vps-dev" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```
GitHub → gigoshkin/hacktoberfest → Settings → Deploy keys → Add deploy key → paste it, tick **Allow write access**. Then:
```sh
git clone git@github.com:gigoshkin/hacktoberfest.git ~/maps
cd ~/maps
git config user.name "gigoshkin" && git config user.email "<your GitHub email>"
npm ci
```

## 6. Claude Code with Remote Control (as dev)
```sh
curl -fsSL https://claude.ai/install.sh | bash     # then open a new shell or: source ~/.bashrc
tmux new -s claude                                 # keeps it running after you disconnect
cd ~/maps
claude                                             # first run: log in via the printed link, then /exit
claude remote-control
```
Detach from tmux with `Ctrl-b` then `d`. Reattach later with `tmux attach -t claude`. The session appears in the Claude app on your phone.

## 7. First message to the VPS session
> Read inbox/2026-10-17-gigoshkin-vps-handoff.md and start the Expo dev server for my phone.

The session then runs Metro with the Tailscale address, e.g. `REACT_NATIVE_PACKAGER_HOSTNAME=100.x.y.z npx expo start` in `apps/mobile`, and keeps it in its own tmux window.

## 8. On the phone
Install **Expo Go** (latest; the app is on Expo SDK 58). With Tailscale on, open `exp://100.x.y.z:8081` (or scan the QR the session shows). Changes appear within seconds.

## Notes
- Secrets (`TRIPS_KEY`, `ANTHROPIC_API_KEY`, `API_KEY`) go in `~/maps/.env` on the VPS, created by you, never committed. Generate TRIPS_KEY with `openssl rand -base64 32` and back it up.
- Expo Go limits: MMKV isn't in Expo Go (the app needs a fallback, see the handoff note); remote push notifications don't work in Expo Go on Android (needs a dev build later).
- Unverified until first run: exact Claude installer behaviour on your distro, Expo Go SDK 58 availability on your phone.

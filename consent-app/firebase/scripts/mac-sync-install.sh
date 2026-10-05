#!/usr/bin/env bash
# Sets up a Mac to mirror the study's export bucket into a OneDrive folder,
# every hour, in the background, with no window open. OneDrive then carries
# the files to the team's shared storage. Run again any time to change the
# folder or the key; run with --uninstall to remove everything it set up.
#
#   bash mac-sync-install.sh <path-to-key.json> [bucket-name]
#   bash mac-sync-install.sh --uninstall
#
# What it installs, all inside your own account:
#   ~/Library/Application Support/MyPhoneMyBrain Sync/   rclone (the copying tool), the key, the settings, sync.sh
#   ~/Library/LaunchAgents/com.myphonemybrain.sync.plist   the hourly background job
#   ~/Library/Logs/MyPhoneMyBrain Sync.log                 what happened on each run
set -eo pipefail
LABEL="com.myphonemybrain.sync"
APP_DIR="$HOME/Library/Application Support/MyPhoneMyBrain Sync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/MyPhoneMyBrain Sync.log"
die() { printf '\n%s\n' "$*" >&2; exit 1; }
ok() { printf '  ✓ %s\n' "$*"; }
[[ "$(uname -s)" == "Darwin" ]] || die "This script is for a Mac."

if [[ "${1:-}" == "--uninstall" ]]; then
  launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  rm -rf "$APP_DIR"
  echo "Removed the background job, the key and the tool. The copied data in OneDrive was left alone."
  exit 0
fi

KEY_SRC="${1:-}"; BUCKET="${2:-myphone-mybrain-exports}"
[[ -n "$KEY_SRC" && -f "$KEY_SRC" ]] || die "Usage: bash mac-sync-install.sh <path-to-key.json> [bucket-name]
Tip: type 'bash mac-sync-install.sh ' then drag the key file into this window."
grep -q '"type": *"service_account"' "$KEY_SRC" || die "That file is not a service-account key."

echo
echo "Where should the data go? It will be mirrored into a folder called 'MyPhoneMyBrain data' inside the place you choose."
candidates=()
for d in "$HOME"/Library/CloudStorage/OneDrive-* "$HOME"/Library/CloudStorage/OneDrive-SharedLibraries-*/*; do [[ -d "$d" ]] && candidates+=("$d"); done
i=1
for d in "${candidates[@]}"; do echo "  $i) ${d/#$HOME/~}"; i=$((i + 1)); done
echo "  $i) Somewhere else (type a path)"
read -r -p "Choose a number: " choice
if [[ "$choice" =~ ^[0-9]+$ && "$choice" -ge 1 && "$choice" -le "${#candidates[@]}" ]]; then
  PARENT="${candidates[$((choice - 1))]}"
else
  read -r -p "Folder path (drag the folder here): " PARENT
  PARENT="${PARENT%/}"; PARENT="${PARENT/#\~/$HOME}"
fi
[[ -d "$PARENT" ]] || die "That folder does not exist: $PARENT"
DEST="$PARENT/MyPhoneMyBrain data"
mkdir -p "$DEST" "$APP_DIR" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

echo
echo "Installing…"
RCLONE="$APP_DIR/rclone"
if command -v rclone >/dev/null 2>&1; then
  RCLONE="$(command -v rclone)"
  ok "using the rclone already on this Mac ($RCLONE)"
else
  arch="$(uname -m)"; [[ "$arch" == "arm64" ]] || arch="amd64"
  tmp="$(mktemp -d)"
  curl -fsSL "https://downloads.rclone.org/rclone-current-osx-$arch.zip" -o "$tmp/rclone.zip" || die "Could not download rclone. Check the internet connection and try again."
  unzip -q -j -o "$tmp/rclone.zip" '*/rclone' -d "$APP_DIR"
  rm -rf "$tmp"
  chmod +x "$RCLONE"
  xattr -d com.apple.quarantine "$RCLONE" 2>/dev/null || true
  ok "rclone installed ($("$RCLONE" version | head -1))"
fi

cp "$KEY_SRC" "$APP_DIR/key.json"
chmod 600 "$APP_DIR/key.json"
cat > "$APP_DIR/rclone.conf" <<CONF
[exports]
type = google cloud storage
service_account_file = $APP_DIR/key.json
bucket_policy_only = true
object_acl = private
CONF
chmod 600 "$APP_DIR/rclone.conf"
ok "key and settings stored in $APP_DIR"

cat > "$APP_DIR/sync.sh" <<SYNC
#!/bin/bash
# Mirrors the export bucket into the OneDrive folder. Started by launchd every hour and at login.
RCLONE="$RCLONE"
CONF="$APP_DIR/rclone.conf"
DEST="$DEST"
LOG="$LOG"
echo "\$(date '+%Y-%m-%d %H:%M:%S') sync starting" >> "\$LOG"
if "\$RCLONE" sync "exports:$BUCKET" "\$DEST" --config "\$CONF" --exclude ".DS_Store" --exclude "Icon?" --fast-list --transfers 8 --checkers 16 --log-file "\$LOG" --log-level NOTICE --stats 0; then
  date -u +"%Y-%m-%dT%H:%M:%SZ" > "$APP_DIR/last-success"
  echo "\$(date '+%Y-%m-%d %H:%M:%S') sync finished" >> "\$LOG"
else
  echo "\$(date '+%Y-%m-%d %H:%M:%S') sync FAILED" >> "\$LOG"
  osascript -e 'display notification "The copy to OneDrive did not complete. See ~/Library/Logs/MyPhoneMyBrain Sync.log" with title "MyPhone/MyBrain sync"' >/dev/null 2>&1
  exit 1
fi
# Trim the log to its last 2,000 lines.
tail -n 2000 "\$LOG" > "\$LOG.tmp" && mv "\$LOG.tmp" "\$LOG"
SYNC
chmod +x "$APP_DIR/sync.sh"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$APP_DIR/sync.sh</string></array>
  <key>StartInterval</key><integer>3600</integer>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>LowPriorityIO</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin</string></dict>
</dict>
</plist>
PLIST
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
ok "background job installed: every hour, and whenever you log in (missed runs happen when the Mac wakes)"

echo
echo "First copy, running now…"
if bash "$APP_DIR/sync.sh"; then
  count="$(find "$DEST" -type f ! -name '.DS_Store' | wc -l | tr -d ' ')"
  ok "done: $count files in ${DEST/#$HOME/~}"
  echo
  echo "That's everything. OneDrive will now carry the folder to the team. Nothing else to do; if a copy ever fails you will get a notification."
  echo "Log: ${LOG/#$HOME/~}    Stop it: bash $(basename "$0") --uninstall"
else
  echo
  echo "The first copy did not complete. The log is at ${LOG/#$HOME/~}. Common causes:"
  echo "  • 'operation not permitted' or 'permission denied': macOS is protecting the OneDrive folder. Open"
  echo "    System Settings → Privacy & Security → Full Disk Access, click +, press Cmd-Shift-G and add:"
  echo "      $RCLONE"
  echo "    then run this script again."
  echo "  • 'AccessDenied' or 'storage.objects.list': the key cannot read the bucket; rerun setup-exports.sh in Cloud Shell and download the new key."
  echo "  • 'bucket doesn't exist': the first export has not run yet; it runs after the next backend deploy and nightly at 02:30. The hourly job will pick it up."
  exit 1
fi

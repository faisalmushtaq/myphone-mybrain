#!/usr/bin/env bash
# Sets up a Mac to mirror the study's export bucket into one or more folders
# (OneDrive, Dropbox, anywhere), every 15 minutes, in the background, with no
# window open. Runs while the Mac is offline are skipped quietly; the next one
# catches up. Run again any time; run with --uninstall to remove everything.
#
#   bash mac-sync-install.sh <path-to-key.json> [bucket-name]   first set-up (asks where the data should go)
#   bash mac-sync-install.sh --add <folder> [bids|all]           mirror into another folder too (default: bids only)
#   bash mac-sync-install.sh --remove <folder>                   stop mirroring into a folder (files are left alone)
#   bash mac-sync-install.sh --list                              show the folders and run a copy now
#   bash mac-sync-install.sh --uninstall
#
# Scope: "all" mirrors the whole export (bids/ and identifying/) into
# <folder>/MyPhoneMyBrain data; "bids" mirrors only the de-identified research
# dataset into <folder>/MyPhoneMyBrain data/bids. Use "bids" for anywhere
# outside the University's own storage unless the DPIA says otherwise.
#
# What it installs, all inside your own account:
#   ~/Library/Application Support/MyPhoneMyBrain Sync/   rclone (the copying tool), the key, the settings, destinations.txt, sync.sh
#   ~/Library/LaunchAgents/com.myphonemybrain.sync.plist   the background job (every 15 minutes)
#   ~/Library/Logs/MyPhoneMyBrain Sync.log                 what happened on each run
set -eo pipefail
LABEL="com.myphonemybrain.sync"
APP_DIR="$HOME/Library/Application Support/MyPhoneMyBrain Sync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/MyPhoneMyBrain Sync.log"
DESTS="$APP_DIR/destinations.txt"
die() { printf '\n%s\n' "$*" >&2; exit 1; }
ok() { printf '  ✓ %s\n' "$*"; }
[[ "$(uname -s)" == "Darwin" || -n "${MPMB_SYNC_TEST:-}" ]] || die "This script is for a Mac."
has_launchctl() { command -v launchctl >/dev/null 2>&1 && [[ -z "${MPMB_SYNC_TEST:-}" ]]; }

rclone_path() {
  if [[ -x "$APP_DIR/rclone" ]]; then echo "$APP_DIR/rclone"; else command -v rclone || true; fi
}

bucket_name() {
  if [[ -f "$APP_DIR/bucket" ]]; then cat "$APP_DIR/bucket"
  elif [[ -f "$APP_DIR/sync.sh" ]]; then sed -n 's/.*"exports:\([^"/ ]*\).*/\1/p' "$APP_DIR/sync.sh" | head -1
  fi
}

# Earlier versions kept a single folder inside sync.sh; carry it into destinations.txt.
migrate() {
  [[ -f "$DESTS" ]] && return 0
  [[ -f "$APP_DIR/sync.sh" ]] || return 0
  local old
  old="$(sed -n 's/^DEST="\(.*\)"$/\1/p' "$APP_DIR/sync.sh" | head -1)"
  old="${old%/MyPhoneMyBrain data}"
  [[ -n "$old" ]] && printf '%s\tall\n' "$old" > "$DESTS" && ok "kept the existing folder: ${old/#$HOME/~} (all)"
  if [[ ! -f "$APP_DIR/bucket" ]]; then
    local bucket
    bucket="$(bucket_name)"
    [[ -n "$bucket" ]] && printf '%s\n' "$bucket" > "$APP_DIR/bucket"
  fi
}

write_sync_script() {
  local rclone bucket
  rclone="$(rclone_path)"; bucket="$(cat "$APP_DIR/bucket")"
  [[ -n "$rclone" && -n "$bucket" ]] || die "The set-up is incomplete; run the first-time set-up again with the key file."
  cat > "$APP_DIR/sync.sh" <<SYNC
#!/bin/bash
# Mirrors the export bucket into every folder in destinations.txt (folder<TAB>scope).
# Started by launchd every 15 minutes and at login. Written by mac-sync-install.sh; do not edit.
RCLONE="$rclone"
CONF="$APP_DIR/rclone.conf"
BUCKET="$bucket"
LOG="$LOG"
DESTS="$DESTS"
APP_DIR="$APP_DIR"
now() { date '+%Y-%m-%d %H:%M:%S'; }
# Offline? Skip quietly; the next run catches up.
if ! curl -s --max-time 10 -o /dev/null https://storage.googleapis.com/; then
  echo "\$(now) offline, skipped" >> "\$LOG"
  exit 0
fi
status=0
while IFS=\$'\\t' read -r dest scope; do
  [ -z "\$dest" ] && continue
  if [ "\$scope" = "bids" ]; then src="exports:\$BUCKET/bids"; target="\$dest/MyPhoneMyBrain data/bids"; else src="exports:\$BUCKET"; target="\$dest/MyPhoneMyBrain data"; fi
  echo "\$(now) sync starting: \$target (\$scope)" >> "\$LOG"
  if "\$RCLONE" sync "\$src" "\$target" --config "\$CONF" --exclude ".DS_Store" --exclude "Icon?" --fast-list --transfers 8 --checkers 16 --log-file "\$LOG" --log-level NOTICE --stats 0 < /dev/null; then
    echo "\$(now) sync finished: \$target" >> "\$LOG"
  else
    echo "\$(now) sync FAILED: \$target" >> "\$LOG"
    status=1
  fi
done < "\$DESTS"
if [ \$status -eq 0 ]; then
  date -u +"%Y-%m-%dT%H:%M:%SZ" > "\$APP_DIR/last-success"
else
  # One notification per six hours at most, so a long outage does not nag.
  LAST="\$APP_DIR/last-notified"
  if [ ! -f "\$LAST" ] || [ \$(( \$(date +%s) - \$(cat "\$LAST") )) -gt 21600 ]; then
    date +%s > "\$LAST"
    osascript -e 'display notification "A copy did not complete. See ~/Library/Logs/MyPhoneMyBrain Sync.log" with title "MyPhone/MyBrain sync"' >/dev/null 2>&1
  fi
fi
# Trim the log to its last 2,000 lines.
tail -n 2000 "\$LOG" > "\$LOG.tmp" && mv "\$LOG.tmp" "\$LOG"
exit \$status
SYNC
  chmod +x "$APP_DIR/sync.sh"
}

write_agent() {
  mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$APP_DIR/sync.sh</string></array>
  <key>StartInterval</key><integer>900</integer>
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
  if has_launchctl; then
    launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
  fi
}

list_destinations() {
  echo "Folders being mirrored:"
  while IFS=$'\t' read -r dest scope; do
    [[ -z "$dest" ]] && continue
    if [[ "$scope" == "bids" ]]; then echo "  • ${dest/#$HOME/~}/MyPhoneMyBrain data/bids   (research dataset only)"; else echo "  • ${dest/#$HOME/~}/MyPhoneMyBrain data   (everything, including identifying/)"; fi
  done < "$DESTS"
}

run_now() {
  echo
  echo "Copying now…"
  if bash "$APP_DIR/sync.sh"; then
    ok "done"
    tail -n 4 "$LOG" | sed 's/^/    /'
    return 0
  fi
  echo
  echo "A copy did not complete. The log is at ${LOG/#$HOME/~}. Common causes:"
  echo "  • 'operation not permitted' or 'permission denied': macOS is protecting that folder. Open"
  echo "    System Settings → Privacy & Security → Full Disk Access, click +, press Cmd-Shift-G and add:"
  echo "      $(rclone_path)"
  echo "    then run this script again."
  echo "  • 'AccessDenied' or 'storage.objects.list': the key cannot read the bucket; rerun setup-exports.sh in Cloud Shell and download the new key."
  echo "  • 'bucket doesn't exist': the first export has not run yet; it runs after the next backend deploy and then hourly. The background job will pick it up."
  return 1
}

case "${1:-}" in
  --uninstall)
    has_launchctl && { launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true; }
    rm -f "$PLIST"
    rm -rf "$APP_DIR"
    echo "Removed the background job, the key and the tool. The copied data was left alone."
    exit 0 ;;
  --list)
    [[ -d "$APP_DIR" ]] || die "Nothing is set up yet. Run the first-time set-up with the key file."
    migrate; list_destinations; write_sync_script; run_now; exit $? ;;
  --add)
    [[ -d "$APP_DIR" ]] || die "Run the first-time set-up with the key file before adding folders."
    folder="${2:-}"; scope="${3:-bids}"
    [[ -n "$folder" ]] || die "Usage: bash mac-sync-install.sh --add <folder> [bids|all]"
    folder="${folder%/}"; folder="${folder/#\~/$HOME}"
    [[ -d "$folder" ]] || die "That folder does not exist: $folder"
    [[ "$scope" == "bids" || "$scope" == "all" ]] || die "The scope must be 'bids' (research dataset only) or 'all'."
    migrate
    grep -v -F "$folder"$'	' "$DESTS" > "$DESTS.tmp" 2>/dev/null || true; mv "$DESTS.tmp" "$DESTS"
    printf '%s\t%s\n' "$folder" "$scope" >> "$DESTS"
    mkdir -p "$folder/MyPhoneMyBrain data"
    if [[ "$scope" == "bids" ]]; then
      printf 'This folder holds the de-identified research dataset (bids/) only, mirrored automatically.\nNames, contact details and consent records are kept in the University OneDrive copy.\nDo not edit or add files here.\n' > "$folder/MyPhoneMyBrain data/README.txt"
    fi
    ok "added ${folder/#$HOME/~} ($scope)"
    write_sync_script; list_destinations; run_now; exit $? ;;
  --remove)
    folder="${2:-}"; [[ -n "$folder" ]] || die "Usage: bash mac-sync-install.sh --remove <folder>"
    folder="${folder%/}"; folder="${folder/#\~/$HOME}"
    migrate
    grep -v -F "$folder"$'	' "$DESTS" > "$DESTS.tmp" || true; mv "$DESTS.tmp" "$DESTS"
    ok "no longer mirroring into ${folder/#$HOME/~} (its files were left as they are)"
    write_sync_script; list_destinations; exit 0 ;;
esac

# ── First-time set-up (or re-install with a new key) ───────────────────────
KEY_SRC="${1:-}"; BUCKET="${2:-myphone-mybrain-exports}"
[[ -n "$KEY_SRC" && -f "$KEY_SRC" ]] || die "Usage: bash mac-sync-install.sh <path-to-key.json> [bucket-name]
Tip: type 'bash mac-sync-install.sh ' then drag the key file into this window."
grep -q '"type": *"service_account"' "$KEY_SRC" || die "That file is not a service-account key."
mkdir -p "$APP_DIR"
migrate

if [[ ! -s "$DESTS" ]]; then
  echo
  echo "Where should the data go? It will be mirrored into a folder called 'MyPhoneMyBrain data' inside the place you choose."
  candidates=()
  for d in "$HOME"/Library/CloudStorage/OneDrive-* "$HOME"/Library/CloudStorage/OneDrive-SharedLibraries-*/*; do [[ -d "$d" ]] && candidates+=("$d"); done
  i=1
  for d in ${candidates[@]+"${candidates[@]}"}; do echo "  $i) ${d/#$HOME/~}"; i=$((i + 1)); done
  echo "  $i) Somewhere else (type a path)"
  read -r -p "Choose a number: " choice
  if [[ "$choice" =~ ^[0-9]+$ && "$choice" -ge 1 && "$choice" -le "${#candidates[@]}" ]]; then
    PARENT="${candidates[$((choice - 1))]}"
  else
    read -r -p "Folder path (drag the folder here): " PARENT
    PARENT="${PARENT%/}"; PARENT="${PARENT/#\~/$HOME}"
  fi
  [[ -d "$PARENT" ]] || die "That folder does not exist: $PARENT"
  printf '%s\tall\n' "$PARENT" > "$DESTS"
  mkdir -p "$PARENT/MyPhoneMyBrain data"
fi

echo
echo "Installing…"
if [[ -z "$(rclone_path)" ]]; then
  arch="$(uname -m)"; [[ "$arch" == "arm64" ]] || arch="amd64"
  tmp="$(mktemp -d)"
  curl -fsSL "https://downloads.rclone.org/rclone-current-osx-$arch.zip" -o "$tmp/rclone.zip" || die "Could not download rclone. Check the internet connection and try again."
  unzip -q -j -o "$tmp/rclone.zip" '*/rclone' -d "$APP_DIR"
  rm -rf "$tmp"
  chmod +x "$APP_DIR/rclone"
  xattr -d com.apple.quarantine "$APP_DIR/rclone" 2>/dev/null || true
fi
ok "rclone ready ($("$(rclone_path)" version | head -1))"

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
printf '%s\n' "$BUCKET" > "$APP_DIR/bucket"
ok "key and settings stored in $APP_DIR"

write_sync_script
write_agent
ok "background job installed: every 15 minutes and whenever you log in; offline runs are skipped and the next one catches up"
list_destinations
if run_now; then
  echo
  echo "That's everything. OneDrive (or whichever app syncs the folder) now carries the data to the team. If a copy ever fails you will get a notification."
  echo "Log: ${LOG/#$HOME/~}    Another folder: bash $(basename "$0") --add <folder> [bids|all]    Stop it: bash $(basename "$0") --uninstall"
else
  exit 1
fi

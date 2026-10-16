#!/usr/bin/env bash
# Sets up a Mac to mirror the study's export bucket into one or more folders
# (OneDrive, Dropbox, anywhere), every 15 minutes, in the background, with no
# window open. Runs while the Mac is offline are skipped quietly; the next one
# catches up. Run again any time; run with --uninstall to remove everything.
#
#   bash mac-sync-install.sh <path-to-key.json> [bucket-name]   first set-up (asks where the data should go)
#   bash mac-sync-install.sh --add <folder> [all|bids]           mirror into another folder too (default: all)
#   bash mac-sync-install.sh --remove <folder>                   stop mirroring into a folder (files are left alone)
#   bash mac-sync-install.sh --list                              show the folders and run a copy now
#   bash mac-sync-install.sh --uninstall
#
# Since 16 October 2026 the OneDrive copy is the team's main way into the
# data, so it should hold all of it.
#
# Scope: "all" (the default, and the one to use for the University's own
# OneDrive or SharePoint) mirrors everything the website writes into
# <folder>/MyPhoneMyBrain data: every file at the top and in each study's
# folder (README.md, manifest.json), each study's donations/, identifying/
# and schools/upn-uploads/, and any other folder the export writes, such as
# website-usage/. "bids" is for any copy outside the University's own
# storage: each study's donations/ only, nothing identifying (a copy of
# identifying/ or the UPN lists left there by an earlier version is deleted).
# Each written folder is mirrored on its own, so the team's own datasets kept
# beside them (for example social-media-break/lab-visits/) are never touched.
#
# Nothing the mirror deletes or overwrites vanishes: it goes to
# <folder>/MyPhoneMyBrain removed/<YYYY-MM-DD>/ (rclone's --backup-dir), kept
# for 90 days. In a "bids" folder, identifying data found there is deleted
# outright, never kept. Folders from the layout before October 2026
# (bids/, lab/, identifying/ inside MyPhoneMyBrain data) are moved there once.
#
# After every run, each folder gets "MyPhoneMyBrain data/SYNC STATUS.txt": when
# it was last copied, which export (the manifest's exportedAt) and from which
# Mac, whether the export itself has files still to copy or failures
# (binaryBacklog, copyFailures), or when and why the last copy failed. It
# sits beside README.md and manifest.json, which are copied file by file
# (never mirrored), so nothing removes it. A bucket or study that cannot be
# listed counts as a failed copy.
#
# The background job runs sync.sh, which this script writes. After updating
# this script, run it again on the Mac (bash mac-sync-install.sh --list is
# enough) so the job picks up the new sync.sh; until then the old one runs.
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
  # The settings first, quoted for bash; then the script itself, written as it reads (a quoted here-document: nothing in it is expanded now).
  {
    printf '#!/bin/bash\n'
    printf '# Mirrors the export bucket into every folder in destinations.txt (folder<TAB>scope).\n'
    printf '# Started by launchd every 15 minutes and at login. Written by mac-sync-install.sh; do not edit.\n'
    printf 'RCLONE=%q\nCONF=%q\nBUCKET=%q\nLOG=%q\nDESTS=%q\nAPP_DIR=%q\n' "$rclone" "$APP_DIR/rclone.conf" "$bucket" "$LOG" "$DESTS" "$APP_DIR"
    printf '# For mac-sync-install.sh to find the bucket again: "exports:%s"\n' "$bucket"
    cat <<'SYNC'
now() { date '+%Y-%m-%d %H:%M:%S'; }
TODAY="$(date '+%Y-%m-%d')"
MAC="$(scutil --get ComputerName 2>/dev/null || hostname)"
# Offline? Skip quietly; the next run catches up (SYNC STATUS.txt keeps the last real run).
if ! curl -s --max-time 10 -o /dev/null https://storage.googleapis.com/; then
  echo "$(now) offline, skipped" >> "$LOG"
  exit 0
fi
status=0
# Where this run starts in the log, so the last error reported is this run's own.
from_line=$(( $(wc -l < "$LOG" 2>/dev/null || echo 0) + 1 ))
RC=("$RCLONE" --config "$CONF" --log-file "$LOG" --log-level NOTICE --stats 0)
# The last thing that went wrong, for SYNC STATUS.txt: our own FAILED line, or rclone's last ERROR before it.
fail() {
  echo "$(now) $1" >> "$LOG"
  status=1; dest_status=1
  last_error="$(tail -n +"$from_line" "$LOG" 2>/dev/null | grep -E 'ERROR|could not|FAILED' | tail -n 1)"
  [ -n "$last_error" ] || last_error="$1"
}
# How many entries a top-level list in manifest.json has (the export writes it indented by two spaces, one object per entry).
count_list() {
  awk -v key="  \"$1\": [" 'index($0, key) == 1 { if ($0 ~ /\[\],?$/) exit; on = 1; next } on && /^  \]/ { exit } on && /^    \{/ { n++ } END { print n + 0 }' "$2" 2>/dev/null || echo 0
}
# What the export itself says about its last run (manifest.json): files still to copy, or anything it could not do (16 October 2026).
export_report() {
  local m="$1/manifest.json" backlog copies unpack writes
  [ -f "$m" ] || return 0
  backlog="$(sed -n 's/^  "binaryBacklog": *\([0-9][0-9]*\).*/\1/p' "$m" | head -n 1)"
  [ -n "$backlog" ] || return 0
  copies="$(count_list copyFailures "$m")"; unpack="$(count_list unpackFailures "$m")"; writes="$(count_list writeFailures "$m")"
  if [ "$backlog" -eq 0 ] && [ "$copies" -eq 0 ] && [ "$unpack" -eq 0 ] && [ "$writes" -eq 0 ]; then
    printf '\nThe export reports everything in place: no files still to copy, nothing failed.\n'
  else
    printf '\nTHE EXPORT REPORTS PROBLEMS (manifest.json lists them, with why):\n  files still to copy (binaryBacklog; later runs catch up, 500 an hour): %s\n  files that could not be copied (copyFailures): %s\n  archives that could not be unpacked (unpackFailures; tried again daily): %s\n  tables that could not be written (writeFailures): %s\n' "$backlog" "$copies" "$unpack" "$writes"
  fi
}
# What the people using the folder see: when it was last copied, and which export, or why not (16 October 2026).
write_status() {
  local exported
  if [ "$2" -eq 0 ]; then
    exported="$(sed -n 's/.*"exportedAt": *"\([^"]*\)".*/\1/p' "$1/manifest.json" 2>/dev/null | head -n 1)"
    printf 'MyPhone/MyBrain data: copied from the export bucket.\n\nLast successful copy: %s (this Mac'"'"'s time)\nExport copied (manifest.json exportedAt, UTC): %s\nCopied by: %s\n%s\n\nThe export runs every hour and this Mac copies it every 15 minutes, so this should never be more than about an hour and a half old. If it is, check that Mac. Anything the copy deleted or replaced is kept for 90 days in "MyPhoneMyBrain removed", next to this folder.\n' "$(now)" "${exported:-unknown}" "$MAC" "$(export_report "$1")" > "$1/SYNC STATUS.txt.tmp"
  else
    printf 'MyPhone/MyBrain data: THE LAST COPY FAILED, so these files may be out of date.\n\nFailed at: %s (this Mac'"'"'s time)\nLast error: %s\nLast successful copy (any folder): %s\nCopied by: %s\n%s\n\nThe log on that Mac is ~/Library/Logs/MyPhoneMyBrain Sync.log.\n' "$(now)" "${last_error:-unknown}" "$(cat "$APP_DIR/last-success" 2>/dev/null || echo never)" "$MAC" "$(export_report "$1")" > "$1/SYNC STATUS.txt.tmp"
  fi
  mv -f "$1/SYNC STATUS.txt.tmp" "$1/SYNC STATUS.txt"
}
# The files (not folders) at one level of the bucket: the top (README.md, manifest.json) or a study's folder (README.md), every one the export writes.
# Copied, never mirrored, so files beside them (SYNC STATUS.txt, README.txt) are left alone; a file replaced goes to the removed folder first.
copy_files() {
  local from="exports:$BUCKET${1:+/$1}" to="$2${1:+/$1}" keep="$3${1:+/$1}"
  "${RC[@]}" copy "$from" "$to" --max-depth 1 --exclude ".DS_Store" --backup-dir "$keep" < /dev/null || fail "copy FAILED: the files in ${1:-the top folder}"
}
# One website-written folder, mirrored exactly; folders beside it (the team's own datasets) are never touched. Whatever it deletes or replaces goes to the removed folder.
mirror() {
  echo "$(now) sync starting: $2/$1" >> "$LOG"
  if "${RC[@]}" sync "exports:$BUCKET/$1" "$2/$1" --exclude ".DS_Store" --exclude "Icon?" --fast-list --transfers 8 --checkers 16 --backup-dir "$3/$1" < /dev/null; then
    echo "$(now) sync finished: $2/$1" >> "$LOG"
  else
    fail "sync FAILED: $2/$1"
  fi
}
# Folders from the layout before October 2026 were mirrors too: moved out once, to the removed folder (deleted outright from a research-only folder), never again.
MIGRATED="$APP_DIR/old-layout-cleared.txt"
migrate_old_layout() {
  local old
  grep -qxF "$1" "$MIGRATED" 2>/dev/null && return 0
  for old in bids lab identifying; do
    [ -d "$2/$old" ] || continue
    if [ "$4" = "bids" ]; then
      rm -rf "$2/$old" && echo "$(now) deleted old-layout folder $old from a research-only folder" >> "$LOG"
    else
      mkdir -p "$3/old-layout" && mv "$2/$old" "$3/old-layout/$old.$(date +%H%M%S)" && echo "$(now) moved old-layout folder $old to $3/old-layout" >> "$LOG"
    fi
  done
  printf '%s\n' "$1" >> "$MIGRATED"
}
# The removed folder keeps 90 days, one dated folder per day.
prune_removed() {
  local base="$1/MyPhoneMyBrain removed" cutoff day
  [ -d "$base" ] || return 0
  cutoff="$(date -v-90d '+%Y-%m-%d' 2>/dev/null || date -d '90 days ago' '+%Y-%m-%d')"
  for day in "$base"/????-??-??; do
    [ -d "$day" ] || continue
    if [[ "${day##*/}" < "$cutoff" ]]; then rm -rf "$day" && echo "$(now) pruned $day (over 90 days)" >> "$LOG"; fi
  done
  [ -f "$base/README.txt" ] || printf 'Files the MyPhone/MyBrain copy deleted or replaced in "MyPhoneMyBrain data" (for example after a withdrawal, or an older version of a table), one folder per day, kept for 90 days and then deleted. A withdrawal is final only once its day has gone from here, and from the recycle bin.\n' > "$base/README.txt"
}
# What the bucket holds at the top: the studies (and any other folder the export writes, such as website-usage/), discovered, so a new one appears by itself.
if ! tops="$("${RC[@]}" lsf "exports:$BUCKET" --dirs-only 2>>"$LOG" < /dev/null)"; then
  fail "could not list the bucket"
  while IFS=$'\t' read -r dest scope; do [ -n "$dest" ] && [ -d "$dest/MyPhoneMyBrain data" ] && write_status "$dest/MyPhoneMyBrain data" 1; done < "$DESTS"
  exit 1
fi
while IFS=$'\t' read -r dest scope; do
  [ -z "$dest" ] && continue
  target="$dest/MyPhoneMyBrain data"
  removed="$dest/MyPhoneMyBrain removed/$TODAY"
  dest_status=0
  mkdir -p "$target"
  migrate_old_layout "$dest" "$target" "$removed" "$scope"
  copy_files "" "$target" "$removed"
  for top in $tops; do
    top="${top%/}"
    # A folder that cannot be listed is a failed copy, not an empty one (16 October 2026).
    if ! subs="$("${RC[@]}" lsf "exports:$BUCKET/$top" --dirs-only 2>>"$LOG" < /dev/null)"; then
      fail "could not list $top"
      continue
    fi
    if printf '%s\n' "$subs" | grep -qx 'donations/'; then
      # A study: its own files, then each written folder on its own.
      copy_files "$top" "$target" "$removed"
      for sub in $subs; do
        sub="${sub%/}"
        # Research data only: each study's donations/, nothing else the website writes (identifying/, the schools' UPN lists), and that deleted, not kept.
        if [ "$scope" = "bids" ] && [ "$sub" != "donations" ]; then
          [ -d "$target/$top/$sub" ] && rm -rf "$target/$top/$sub" && echo "$(now) removed $top/$sub from a research-only folder" >> "$LOG"
          continue
        fi
        mirror "$top/$sub" "$target" "$removed"
      done
    elif [ "$scope" != "bids" ]; then
      # A folder the export writes whole (website-usage/): mirrored as one.
      mirror "$top" "$target" "$removed"
    fi
  done
  write_status "$target" "$dest_status"
  prune_removed "$dest"
done < "$DESTS"
if [ $status -eq 0 ]; then
  date -u +"%Y-%m-%dT%H:%M:%SZ" > "$APP_DIR/last-success"
else
  # One notification per six hours at most, so a long outage does not nag.
  LAST="$APP_DIR/last-notified"
  if [ ! -f "$LAST" ] || [ $(( $(date +%s) - $(cat "$LAST") )) -gt 21600 ]; then
    date +%s > "$LAST"
    osascript -e 'display notification "A copy did not complete. See ~/Library/Logs/MyPhoneMyBrain Sync.log" with title "MyPhone/MyBrain sync"' >/dev/null 2>&1
  fi
fi
# Trim the log to its last 2,000 lines.
tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
exit $status
SYNC
  } > "$APP_DIR/sync.sh"
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
    if [[ "$scope" == "bids" ]]; then echo "  • ${dest/#$HOME/~}/MyPhoneMyBrain data   (bids: research data only, each study's donations/; for copies outside University storage)"; else echo "  • ${dest/#$HOME/~}/MyPhoneMyBrain data   (all: everything, including identifying/; for the University's own OneDrive or SharePoint)"; fi
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
    folder="${2:-}"; scope="${3:-all}"
    [[ -n "$folder" ]] || die "Usage: bash mac-sync-install.sh --add <folder> [all|bids]   (all, the default, for the University's own OneDrive or SharePoint; bids for anywhere else)"
    folder="${folder%/}"; folder="${folder/#\~/$HOME}"
    [[ -d "$folder" ]] || die "That folder does not exist: $folder"
    [[ "$scope" == "bids" || "$scope" == "all" ]] || die "The scope must be 'all' (everything: the University's own OneDrive or SharePoint) or 'bids' (research datasets only: anywhere else)."
    migrate
    grep -v -F "$folder"$'	' "$DESTS" > "$DESTS.tmp" 2>/dev/null || true; mv "$DESTS.tmp" "$DESTS"
    printf '%s\t%s\n' "$folder" "$scope" >> "$DESTS"
    mkdir -p "$folder/MyPhoneMyBrain data"
    if [[ "$scope" == "bids" ]]; then
      printf 'This folder holds the de-identified research datasets only, mirrored automatically:\nschools/donations (the young people'"'"'s study) and social-media-break/donations (the adult lab study).\nNames, contact details and consent records are kept in the University OneDrive copy.\nThe donations/ folders are mirrors: do not edit or add files inside them. Other datasets may be kept beside them.\n' > "$folder/MyPhoneMyBrain data/README.txt"
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
  echo "Where should the data go? Everything the website records will be mirrored into a folder called 'MyPhoneMyBrain data'"
  echo "inside the place you choose, including names and consent records (scope 'all'). Choose the University's own OneDrive"
  echo "or SharePoint library: this copy is the team's main way into the data. For a copy anywhere else, add it afterwards"
  echo "with research data only: bash $(basename "$0") --add <folder> bids"
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
  echo "Anything the copy deletes or replaces is kept for 90 days in 'MyPhoneMyBrain removed', next to the data folder."
  echo "Log: ${LOG/#$HOME/~}    Another folder: bash $(basename "$0") --add <folder> [all|bids]    Stop it: bash $(basename "$0") --uninstall"
else
  exit 1
fi

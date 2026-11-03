#!/usr/bin/env bash
# Checks the Mac copy's scopes against a fake bucket (no Mac, no rclone, no
# network): what "all", "no-documents" and "bids" folders end up holding.
#   bash consent-app/firebase/scripts/test-mac-sync-scopes.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
B="$T/bucket"
mkdir -p "$B/schools/donations/sub-00001" "$B/schools/identifying" "$B/staff-portal/tables" "$B/staff-portal/documents/Jane_Smith" "$B/website-usage" "$T/bin"
echo m > "$B/manifest.json"; echo r > "$B/README.md"
echo d > "$B/schools/donations/sub-00001/a.tsv"; echo i > "$B/schools/identifying/consents.tsv"
echo t > "$B/staff-portal/tables/people.csv"; echo r > "$B/staff-portal/README.md"
echo pdf > "$B/staff-portal/documents/Jane_Smith/dbs_2026-11-01.pdf"; echo u > "$B/website-usage/daily.tsv"

# A stand-in rclone: lsf, copy --max-depth 1 and sync, on local folders ("exports:<bucket>" is $B).
cat > "$T/bin/rclone" <<'RC'
#!/bin/bash
while [[ "$1" == --* ]]; do case "$1" in --stats|--config|--log-file|--log-level) shift 2;; *) shift;; esac; done
cmd="$1"; shift
loc() { local p="${1#exports:}"; p="${p#*/}"; [[ "$1" == "exports:${1#exports:}" && "${1#exports:}" != */* ]] && p=""; echo "$FAKE_BUCKET${p:+/$p}"; }
case "$cmd" in
  lsf) src="$(loc "$1")"; [ -d "$src" ] || exit 3; for d in "$src"/*/; do [ -d "$d" ] && basename "$d" | sed 's|$|/|'; done; exit 0 ;;
  copy) src="$(loc "$1")"; mkdir -p "$2"; for f in "$src"/*; do [ -f "$f" ] && cp "$f" "$2/"; done; exit 0 ;;
  sync) src="$(loc "$1")"; rm -rf "$2"; mkdir -p "$(dirname "$2")"; cp -R "$src" "$2"; exit 0 ;;
esac
RC
printf '#!/bin/bash\nexit 0\n' > "$T/bin/curl"
chmod +x "$T/bin/rclone" "$T/bin/curl"

# The sync script as the installer writes it, with the stand-ins.
{
  printf 'RCLONE=%q\nCONF=/dev/null\nBUCKET=b\nLOG=%q\nDESTS=%q\nAPP_DIR=%q\n' "$T/bin/rclone" "$T/log" "$T/dests" "$T"
  awk "/cat <<'SYNC'/{on=1;next} on && /^SYNC\$/{exit} on" "$HERE/mac-sync-install.sh"
} > "$T/sync.sh"
touch "$T/log"
for s in all no-documents bids; do mkdir -p "$T/$s"; printf '%s\t%s\n' "$T/$s" "$s" >> "$T/dests"; done
PATH="$T/bin:$PATH" FAKE_BUCKET="$B" bash "$T/sync.sh" || { cat "$T/log"; exit 1; }

fails=0
has() { if [ -e "$T/$1/MyPhoneMyBrain data/$2" ]; then :; else echo "FAIL: $1 should have $2"; fails=1; fi; }
lacks() { if [ -e "$T/$1/MyPhoneMyBrain data/$2" ]; then echo "FAIL: $1 should not have $2"; fails=1; fi; }
has all staff-portal/documents/Jane_Smith/dbs_2026-11-01.pdf; has all staff-portal/tables/people.csv; has all schools/identifying/consents.tsv; has all website-usage/daily.tsv
has no-documents staff-portal/tables/people.csv; has no-documents staff-portal/README.md; has no-documents schools/donations/sub-00001/a.tsv
lacks no-documents staff-portal/documents; lacks no-documents schools/identifying; lacks no-documents website-usage
has bids schools/donations/sub-00001/a.tsv; lacks bids staff-portal; lacks bids schools/identifying
[ "$fails" = 0 ] && echo "ok: all, no-documents and bids folders hold what they should"
exit "$fails"

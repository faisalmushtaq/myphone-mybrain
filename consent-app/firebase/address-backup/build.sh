#!/usr/bin/env bash
# Builds the address finder's West Yorkshire backup (docs/address-lookup.md)
# from the official open data, into <out>/site/data/{pc,st}. The address-backup
# workflow runs this monthly and uploads the result to the private bucket; the
# files themselves are never committed.
#
#   bash consent-app/firebase/address-backup/build.sh <work-dir>
#
# Needs python3 with pandas, pyproj and openpyxl, curl and unzip.
set -euo pipefail
WORK="${1:?Usage: build.sh <work-dir>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$WORK/cpo" "$WORK/on" "$WORK/out"

echo "OS Code-Point Open (postcodes)"
curl -sSfL -o "$WORK/cpo.zip" "https://api.os.uk/downloads/v1/products/CodePointOpen/downloads?area=GB&format=CSV&redirect"
unzip -q -o "$WORK/cpo.zip" -d "$WORK/cpo"

echo "OS Open Names (streets)"
curl -sSfL -o "$WORK/on.zip" "https://api.os.uk/downloads/v1/products/OpenNames/downloads?area=GB&format=CSV&redirect"
unzip -q -o "$WORK/on.zip" -d "$WORK/on"

echo "HM Land Registry Price Paid Data (addresses), West Yorkshire only"
curl -sSfL "https://price-paid-data.publicdata.landregistry.gov.uk/pp-complete.csv" | grep '"WEST YORKSHIRE"' > "$WORK/pp_wy.csv" || true
rows=$(wc -l < "$WORK/pp_wy.csv")
# A truncated download would quietly shrink the backup, so refuse anything implausibly small.
[[ "$rows" -gt 1000000 ]] || { echo "Only $rows West Yorkshire sales downloaded; expected over a million. Stopping."; exit 1; }

python3 -I "$HERE/build.py" "$WORK/cpo" "$WORK/pp_wy.csv" "$WORK/out"
python3 -I "$HERE/build_streets.py" "$WORK/on" "$WORK/out"
echo "Built: $(ls "$WORK/out/site/data/pc" | wc -l) postcode files, $(ls "$WORK/out/site/data/st" | wc -l) street files"

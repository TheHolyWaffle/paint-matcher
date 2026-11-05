#!/bin/sh
# Refresh both paint catalogs and rebuild web/colors.js. Delete data/.cache to force a full re-download.
set -e
cd "$(dirname "$0")/.."
python3 -I scripts/fetch_levis.py
python3 -I scripts/fetch_boss.py
python3 -I scripts/build_data.py

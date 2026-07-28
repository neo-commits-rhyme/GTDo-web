#!/usr/bin/env bash
# Subsets Source Serif 4 Variable (SIL Open Font License 1.1) down to what the
# UI actually renders: Latin plus the punctuation our copy uses. Both axes are
# kept — the weight range costs almost nothing next to the glyph set, and opsz
# is most of what makes a text serif look right at display sizes.
#
# Run once; the result is committed, so a build never touches the network.
#
#   python3 -m pip install --user fonttools brotli
#   ./scripts/subset-font.sh
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="${1:-/tmp/SourceSerif4Variable-Roman.ttf}"
if [ ! -f "$SRC" ]; then
  echo "Source font not found at $SRC"
  echo "Fetch it with:"
  echo "  curl -sSL -o /tmp/SourceSerif4Variable-Roman.ttf \\"
  echo "    https://github.com/adobe-fonts/source-serif/raw/release/VAR/SourceSerif4Variable-Roman.ttf"
  exit 1
fi

mkdir -p public/fonts
python3 -m fontTools.subset "$SRC" \
  --output-file=public/fonts/gtdo-serif.woff2 \
  --flavor=woff2 \
  --layout-features='kern,liga,calt,onum,tnum' \
  --unicodes='U+0020-007E,U+00A0-00FF,U+2018-201D,U+2026,U+2013,U+2014,U+2192' \
  --drop-tables+=DSIG \
  --no-hinting

ls -lh public/fonts/gtdo-serif.woff2

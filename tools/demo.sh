#!/bin/sh
# Fly through Shinjuku. Optional start position is x,z or x,y,z in metres.
set -eu
cd "$(dirname "$0")/.."
room="tokyo-${1:-day}"
[ -z "${2:-}" ] || room="$room-at=$2"
node tools/bundle.ts >/dev/null
# The viewer takes points. Target 1280x720 physical pixels on the main display.
pixels_per_point=1
if [ "$(uname -s)" = Darwin ]; then
  pixels_per_point=$(osascript -l JavaScript -e 'ObjC.import("AppKit"); $.NSScreen.mainScreen.backingScaleFactor' 2>/dev/null) || pixels_per_point=1
fi
case "$pixels_per_point" in 2|3) ;; *) pixels_per_point=1 ;; esac
width=${W:-$((1280 / pixels_per_point))}
height=${H:-$((720 / pixels_per_point))}
THREERT_SCRIPT_MB=12288 exec ./engine/renderer/target/release/threert-render play out/bundles/city.js --assets . --room "$room" --presets engine/presets --width "$width" --height "$height"

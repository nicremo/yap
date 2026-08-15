#!/usr/bin/env bash
# Checks whether anything still holds the built-in microphone or speaker open.
#
# Usage:
#   scripts/check-audio-assertions.sh
#
# Matches the assertion NAME, not the "Resources:" line, so unrelated holders
# such as an iOS Simulator audio device do not produce a false alarm.
set -uo pipefail

if [[ "$(uname)" != "Darwin" ]]; then
  echo "This check only applies to macOS."
  exit 0
fi

assertions="$(/usr/bin/pmset -g assertions)"
device_pattern='com\.apple\.audio\.(BuiltInMicrophoneDevice|BuiltInSpeakerDevice)\.context'

held="$(printf '%s\n' "$assertions" | grep -E "$device_pattern" || true)"

echo "OpenWhisp processes: $(pgrep -f 'OpenWhisp' | wc -l | tr -d ' ')"
echo

if [[ -z "$held" ]]; then
  echo "PASS: no built-in microphone or speaker assertion is open."
  exit 0
fi

echo "FAIL: an audio device is still held open."
echo
printf '%s\n' "$held"
echo
echo "Other audio assertions on this machine (context only):"
printf '%s\n' "$assertions" | grep -E 'com\.apple\.audio\.' | grep -Ev "$device_pattern" || echo "  none"
exit 1

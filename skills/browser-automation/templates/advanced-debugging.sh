#!/usr/bin/env bash
# Template: Advanced Debugging Workflow
# Purpose: Capture a trace around a failing interaction with playwright-cli.
# Usage: ./advanced-debugging.sh <url> [session-name]

set -euo pipefail

TARGET_URL="${1:?Usage: $0 <url>}"
SESSION_NAME="${2:-browser-debug}"

echo "Advanced debugging: $TARGET_URL"
echo "Session: $SESSION_NAME"

playwright-cli -s="$SESSION_NAME" open "$TARGET_URL"
playwright-cli -s="$SESSION_NAME" tracing-start
playwright-cli -s="$SESSION_NAME" snapshot

echo
echo "Run the failing interaction in another shell using the same session, for example:"
echo "  playwright-cli -s=\"$SESSION_NAME\" click e1"
echo "  playwright-cli -s=\"$SESSION_NAME\" fill e2 \"value\""
echo "  playwright-cli -s=\"$SESSION_NAME\" snapshot"
echo
read -r -p "Press Enter after the failing interaction has been reproduced... " _

playwright-cli -s="$SESSION_NAME" console
playwright-cli -s="$SESSION_NAME" network
playwright-cli -s="$SESSION_NAME" tracing-stop
playwright-cli -s="$SESSION_NAME" close

echo "Saved trace and inspection artifacts under .playwright-cli/"

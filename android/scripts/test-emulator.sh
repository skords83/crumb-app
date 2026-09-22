#!/usr/bin/env bash
# Only an explicitly named emulator is accepted; test fixtures overwrite Crumb's test-app data.
set -euo pipefail
serial=${1:?Usage: test-emulator.sh emulator-PORT [adb-server-port]}
[[ "$serial" =~ ^emulator-[0-9]+$ ]] || { echo 'Refusing a non-emulator target.' >&2; exit 2; }
server_port=${2:-5037}
[[ "$server_port" =~ ^[0-9]+$ ]] || exit 2
: "${ANDROID_HOME:?Set ANDROID_HOME to the Android SDK}"
android_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
adb=("$ANDROID_HOME/platform-tools/adb" -P "$server_port" -s "$serial")
[[ "$("${adb[@]}" shell getprop sys.boot_completed | tr -d '\r')" == 1 ]] || { echo 'Emulator is not fully booted.' >&2; exit 1; }
mkdir -p "$android_root/app/build/reports/device"
"${adb[@]}" install -r "$android_root/app/build/outputs/apk/debug/app-debug.apk"
"${adb[@]}" install -r "$android_root/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
"${adb[@]}" shell am instrument -w -r -e notClass de.crumb.companion.RecoveryFixtureTest de.crumb.companion.test/androidx.test.runner.AndroidJUnitRunner | tee "$android_root/app/build/reports/device/instrumentation.txt"
grep -Eq 'OK \([0-9]+ tests?\)' "$android_root/app/build/reports/device/instrumentation.txt"

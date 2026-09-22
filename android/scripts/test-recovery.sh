#!/usr/bin/env bash
# Opt-in destructive-to-fixtures tests; only the specified emulator's Crumb data is cleared.
set -euo pipefail
serial=${1:?Usage: test-recovery.sh emulator-PORT [adb-server-port]}
[[ "$serial" =~ ^emulator-[0-9]+$ ]] || { echo 'Refusing a non-emulator target.' >&2; exit 2; }
server_port=${2:-5037}
[[ "$server_port" =~ ^[0-9]+$ ]] || exit 2
: "${ANDROID_HOME:?Set ANDROID_HOME to the Android SDK}"
android_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
reports="$android_root/app/build/reports/device"
mkdir -p "$reports"
results="$reports/recovery-results.txt"
: > "$results"
adb=("$ANDROID_HOME/platform-tools/adb" -P "$server_port" -s "$serial")
cleanup() {
    "${adb[@]}" shell dumpsys deviceidle unforce >/dev/null 2>&1 || true
    "${adb[@]}" shell dumpsys battery reset >/dev/null 2>&1 || true
    "${adb[@]}" shell input keyevent 224 >/dev/null 2>&1 || true
    "${adb[@]}" shell pm clear de.crumb.companion >/dev/null 2>&1 || true
}
trap cleanup EXIT
seed() {
    "${adb[@]}" shell pm clear de.crumb.companion >/dev/null
    "${adb[@]}" shell pm grant de.crumb.companion android.permission.POST_NOTIFICATIONS
    "${adb[@]}" shell appops set de.crumb.companion SCHEDULE_EXACT_ALARM allow
    "${adb[@]}" shell am instrument -w -r -e class de.crumb.companion.RecoveryFixtureTest \
        -e recoveryFixture true -e delayMillis "$1" \
        de.crumb.companion.test/androidx.test.runner.AndroidJUnitRunner > "$reports/recovery-seed.txt"
    grep -Eq 'OK \(1 test\)' "$reports/recovery-seed.txt"
}
await_alarm() {
    local name=$1 deadline=$((SECONDS + 150))
    while (( SECONDS < deadline )); do
        "${adb[@]}" shell dumpsys notification --noredact > "$reports/$name-notifications.txt"
        if grep -Eq 'NotificationRecord\(.*pkg=de\.crumb\.companion.*tag=recovery-fixture' "$reports/$name-notifications.txt"; then
            echo "PASS: $name alarm posted" | tee -a "$results"
            return
        fi
        sleep 2
    done
    echo "FAIL: $name alarm not observed" >&2
    return 1
}
seed 45000
"${adb[@]}" shell am kill de.crumb.companion
if [[ -n "$("${adb[@]}" shell pidof de.crumb.companion | tr -d '\r')" ]]; then
    echo 'Test app remained alive; process-death test is invalid.' >&2; exit 1
fi
"${adb[@]}" shell dumpsys battery unplug >/dev/null
"${adb[@]}" shell input keyevent 223
"${adb[@]}" shell dumpsys deviceidle enable deep > "$reports/doze-enable.txt"
"${adb[@]}" shell dumpsys deviceidle force-idle > "$reports/doze-state.txt"
grep -q 'Now forced in to deep idle mode' "$reports/doze-state.txt"
await_alarm process-death-doze
"${adb[@]}" shell dumpsys deviceidle unforce >/dev/null
"${adb[@]}" shell dumpsys battery reset >/dev/null
"${adb[@]}" shell input keyevent 224
seed 90000
"${adb[@]}" reboot
deadline=$((SECONDS + 120))
until [[ "$("${adb[@]}" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == 1 ]]; do
    (( SECONDS < deadline )) || { echo 'Emulator reboot timeout' >&2; exit 1; }
    sleep 2
done
"${adb[@]}" shell input keyevent 82
await_alarm reboot
seed 45000
"${adb[@]}" shell am force-stop de.crumb.companion
"${adb[@]}" shell am start -W -n de.crumb.companion/.MainActivity > "$reports/offline-reopen.txt"
"${adb[@]}" shell screencap -p /sdcard/crumb-recovery.png
"${adb[@]}" pull /sdcard/crumb-recovery.png "$reports/offline-overview.png" >/dev/null
await_alarm force-stop-offline-reopen

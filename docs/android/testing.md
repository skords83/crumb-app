# Prüfungen Android V1

Stand 22.09.2026. Ausschließlich synthetische Daten, kein produktiver Serverzugriff.
**26 JVM-Tests**, **4 Instrumentierungstests auf AOSP Android 15/API 35**, App-/Test-APK
und Lint (0 Fehler) erfolgreich. API: 9 Testdateien; Web: 2 Testdateien erfolgreich.
Instrumentierung verwendet echte Android-Komponenten und einen temporären lokalen
HTTPS-Server. Sie ersetzt keine Tests gegen einen bereitgestellten Crumb-Server.

| Fall | Prüfung / Ergebnis |
|---|---|
| Drei parallele Sessions / gleichzeitige Fälligkeit | Robolectric-Planung und drei getrennte echte Android-Meldungen geprüft |
| Direktaktion mit Fehler und Retry | Android-Broadcast → WorkManager → HTTPS → Repository; Fehler bleibt sichtbar, Retry bestätigt und entfernt nur die erledigte Meldung |
| Alte Notification nach Abschluss | keine weitere Mutation; im Android-Emulator geprüft |
| Alte Aktion nach Kontowechsel | PendingIntent-Systemidentität enthält Anmeldegeneration; JVM-Regressionstest plus serverseitige Besitzerprüfung |
| Normale Meldung / Deduplizierung | persistente Planung und Wiederholungsschutz geprüft; lange OEM-Laufzeit offen |
| Kritischer Alarm / Rechte | exakter Alarm bei Erlaubnis; Fallback und entzogene Meldungsrechte Robolectric-geprüft |
| Beendeter App-Prozess + Doze | PID-Abwesenheit geprüft, tiefer Doze erzwungen, echte kritische Meldung danach im Emulator nachgewiesen |
| Vollständiger Emulator-Neustart | gespeicherter Plan nach Boot/Entsperren wiederhergestellt, echte Meldung nachgewiesen |
| Force-stop + Offline-Wiederöffnung | Plan beim Öffnen neu geplant; echte Alarmzustellung trotz unerreichbarem Server im Emulator nachgewiesen |
| Monotone Uhr | lokale Countdowns und mehrere Termine JUnit-geprüft; physische Uhr-/Zeitzonenänderungen offen |
| Web/Android gleichzeitig | PGlite/Router: genau ein Fortschreiben; Gegenstelle 409 |
| Bestätigung: HTTP 503 / verlorene Antwort | kein optimistischer Erfolg; TLS-/Socket-Integration prüft verlorene Antwort nach Commit ohne zweite Fortschreibung |
| Folge-GET scheitert nach Erfolg | akzeptierte Aktion bleibt gegen Wiederalarmierung geschützt, auch nach Cache-Neustart und Rechtewechsel |
| Zustellwechsel / Folge-GET scheitert | bestätigter Web-Modus bleibt nach Prozessneustart erhalten |
| JWT abgelaufen | 401 löscht Credentials, Cache und Alarme; HTTPS-Integration geprüft |
| Login / Tokenablage | Compose-Login lehnt HTTP ab; echter Android-Keystore-Roundtrip ohne Klartexttoken geprüft |
| TLS / Weiterleitung | fremdes Zertifikat und Redirect werden abgelehnt; Loopback-HTTPS geprüft |
| Serveränderung während Schlaf | ohne Push-Invalidierung bis Sync möglicherweise veralteter Alarm; bleibt ausdrückliche Grenze |

## Reproduzieren

JDK 17, SDK 35, vollständig gestarteter dedizierter AOSP-35-Emulator mit KVM.
Hier: ausschließlich `emulator-5580`, separater ADB-Server auf Port 5047.
Die Sandbox blendete `/dev/kvm` aus; Prüfung auf dem Host bestätigte verfügbares KVM.
Der vorherige unbeschleunigte Lauf hatte System-ANRs und zählt nicht als Gerätetest.

```sh
cd android
./gradlew :app:assembleDebug :app:assembleDebugAndroidTest :app:testDebugUnitTest :app:lintDebug
./scripts/test-emulator.sh emulator-5580 5047
./scripts/test-recovery.sh emulator-5580 5047
```

Die Skripte akzeptieren nur Emulator-Seriennummern. Recovery löscht ausschließlich die
Crumb-Appdaten im Testemulator, legt synthetische Offline-Fixtures an, setzt Testrechte,
aktiviert Doze und startet den Emulator neu. Cleanup entfernt die synthetischen Daten
und hebt erzwungenen Idle-/Batteriezustand auf. Der Fixture-Test ist ohne explizites
`recoveryFixture=true` deaktiviert. Der reguläre Runner schließt ihn aus.

Reports unter `android/app/build/reports/device/`: `instrumentation.txt`,
`process-death-doze-notifications.txt`, `reboot-notifications.txt`,
`force-stop-offline-reopen-notifications.txt`, `offline-overview.png`.
Die dumpsys-Ausgaben enthalten ausschließlich Daten des dedizierten Testemulators.
Vorgehen nach [Android Developers: Doze testen](https://developer.android.com/training/monitoring-device-state/doze-standby).

## Vor Freigabe auf echter Hardware

Mindestens ein Android-13+-Smartphone und ein Gerät mit stärkerer OEM-Energieverwaltung:
Ton/Vibration physisch wahrnehmen; gesperrtes Gerät mit PIN; DND/kanalweise Sperren;
mehrstündige Backvorgänge und kritische Wiederholungen; echte Netzwerkwechsel;
Passwortwiderruf gegen eine freigegebene Testinstanz. Kein Hardwaregerät wurde verbunden
oder verändert. Keine pauschale Zustellgarantie für Force-stop, ausgeschaltete Geräte,
DND oder OEM-Eingriffe. Während eines Force-stop gibt es keine Alarmgarantie; der
getestete Fall stellt Alarme erst beim anschließenden Öffnen wieder her.

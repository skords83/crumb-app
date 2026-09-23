# Prüfungen Android V1

Stand 23.09.2026. Ausschließlich synthetische Daten, kein produktiver Serverzugriff.
**36 JVM-Tests**, **6 Instrumentierungstests auf AOSP Android 15/API 35**, App-/Test-APK
und Lint (0 Fehler) erfolgreich. API: 10 Testdateien; Web: 2 Testdateien erfolgreich.
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
| Zugriffstoken abgelaufen | Erneuerung innerhalb der Gerätesitzung; bei widerrufenem Refresh-Token lokale Daten/Alarme entfernen; bei 503 erhalten |
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

## Erweiterungen 0.2.0
- JVM: drei parallele Chronometer-Meldungen, Abschalten nur der Countdown-Anzeige,
  Entfernen bei Abschluss/Web-Modus, blockierte Kanäle. HTTP-401-Erneuerung mit
  ursprünglicher Aktionsversion, 503 während Erneuerung, widerrufene Sitzung und
  fehlschlagender Logout nach bereits akzeptierter Rückkehr zu Web-Push.
- API: echte PGlite-Tabelle inklusive wiederholbarer Migration; nur Refresh-Hash
  gespeichert; festes Ablaufdatum; wiederholbarer Refresh nach verlorener Antwort;
  Logout, Passwortversion, Ablauf, Kontolöschung; echter Login/Middleware mit getrennten
  Web-/Android-Sitzungen. Keine produktive Datenbank verwendet.
- AOSP 35: fünf Instrumentierungstests erfolgreich. Neu: drei echte Chronometer-
  Benachrichtigungen und dauerhaft sichtbarer Alarmstatus, erneuter Zugang zu den
  Einstellungen sowie Activity-Neuerstellung. Keystore prüft auch Refresh-Token.
  Erste neue Testmethode hatte irrtümlich einen nicht-void-Rückgabetyp; korrigiert.
- Signierung: fehlende Release-Secrets müssen Build abbrechen; anschließend APK mit
  kurzlebigem synthetischem Schlüssel gebaut, Release-Lint und `apksigner verify`
  erfolgreich. Testschlüssel entfernt; Test-APK liegt nur unter /tmp, ausdrücklich
  nicht zur Verteilung. Kein produktiver Schlüssel, kein GitHub-Release-Lauf.
- Sperrbildschirmdarstellung mit echter PIN und physische Wahrnehmung von Ton/Vibration
  weiterhin offen. Der Chronometer-Test prüft tatsächliche Android-Benachrichtigungen
  und ihre Countdown-Konfiguration, nicht jede OEM-Sperrbildschirmdarstellung.
- Finale Recovery-Wiederholung am 23.09.2026: alle drei Szenarien erneut erfolgreich
  (Prozessende/Doze, Neustart, Force-stop/Offline-Wiederöffnung). Screenshot der
  Offline-Übersicht visuell geprüft; Alarmstatus und Einstellungszugang sichtbar.

## Größere Timerdarstellung 0.2.1
- Drei zusätzliche JVM-Tests: Restanteil aus Serverintervall, fehlende/ungültige Dauer,
  native RemoteViews/monotone Countdown-Basis und ein gemeinsamer nicht aufweckender
  Anzeige-Alarm neben drei unabhängigen Aufgabenalarmen. Insgesamt 36 JVM-Tests grün.
- Sechs Instrumentierungstests auf AOSP 35 grün. `DeviceTimerLayoutTest` rendert 16
  Varianten (hell/dunkel, Schriftfaktor 1.0/1.3, Minuten/Stunden, kompakt/aufgeklappt),
  prüft Textgrenzen und schreibt PNGs. Visuelle Kontrolle der finalen Bilder erfolgreich.
  Native Autosize-Schrift; Textfarben passen sich dem Systemthema an.
- `DeviceSettingsTest`: drei laufende Timer, synthetischer Server-Zeitsprung über die
  Fälligkeit, anschließend drei Aufgabenmeldungen mit Direktaktion und keine alten
  Timer. Schritte bleiben unbestätigt. Keine Änderung echter Benutzerdaten.
- `test-emulator.sh` kopiert die Layoutbilder unter `app/build/reports/device/timer-layouts/`.
  Das sind unter Android gerenderte Inhaltslayouts, keine Garantie für dieselbe Höhe
  oder Darstellung im Sperrbildschirm jedes Herstellers. Große Ansicht erfordert
  gegebenenfalls Aufklappen. Physische Wahrnehmung von Ton/Vibration bleibt Gerätetest.
- Recovery mit 0.2.1 erneut vollständig grün: Prozessende/Doze, Reboot und Force-stop
  mit Offline-Wiederöffnung. Zusätzlicher Anzeige-Takt beeinträchtigte in diesen
  Emulator-Szenarien die kritischen Fälligkeitsalarme nicht.

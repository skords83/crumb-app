# Fortschritt Android V1

Stand: 22.09.2026. V1 implementiert, Debug-APK gebaut; Android-15-Emulatorprüfungen ergänzt. **Keine Freigabe für reale Geräte/OEMs.**
Keine Commits, Pushes, produktiven Migrationen oder Deployments ausgeführt. Die
bereits vorhandene `install-arch.sh` wurde nicht verändert.

## A – Bestandsaufnahme abgeschlossen
README/PRODUCT/DESIGN, Engine, Sessions/Persistenz, Widget, Auth, Benachrichtigungen,
Web-API/Backplan, DB-Struktur und Tests untersucht. Ergebnis: `architecture.md`.
Anfangs nur Java 26/ADB vorhanden; SDK/Gradle fehlten. Keine Produktion angesprochen.

## B – API abgeschlossen
Dateien: `api/android-companion.js`, `android-companion.test.js`, `bake-sessions.js`,
`bake-persistence.test.js`, `index.js`, `notification-engine.js`.
Ergänzt: Companion-Projektion mit UTC-Serverzeit, stabilen Schritt-/Alarm-IDs,
Versionen, Gate-/Ofen-/Erledigt-Aktionen und Dringlichkeit; kontoweite Zustellwahl.
Bestehende Engine und atomarer Versionsschutz bleiben maßgeblich. Gate-Voraussetzungen
werden auch beim Schreiben geprüft. Schemaergänzung erst bei künftigem API-Start.
Tests: `npm test --prefix api` erfolgreich, **9 Testdateien**, darunter PGlite-Race
Web/Android, stale Retry, Besitzertrennung, parallele Sessions, Timerverlängerung,
UTC-Termine, tatsächliche Ofenbereitschaft, Gates und Web-Push-Unterdrückung.

## C – Grundgerüst abgeschlossen
Dateien: `android/` Gradle-Projekt/Wrapper, Manifest/Ressourcen, `CrumbApi.kt`,
`SecureStore.kt`, `Repository.kt`. Kotlin/Compose; HTTPS, Keystore-AES/GCM,
kein gespeichertes Passwort, keine eingebauten Zugangsdaten. Backup/Transfer ausgeschlossen.
JDK 17, SDK 35 und Gradle 8.11.1 mit Freigabe isoliert unter `/tmp/crumb-android-tools`
installiert; damit tatsächliche Kompilierung möglich. Gradle-Version/Checksum festgelegt.

## D – Backübersicht abgeschlossen
Dateien: `Models.kt`, `ServerClock.kt`, `MainActivity.kt`, `ServerClockTest.kt`.
Alle aktiven Sessions und ausführbaren Aufgaben, nächster Schritt, aktuelle Phase,
Timeline und große Aktionen. Lokale monotone Countdowns; Cache und sichtbare
Veraltungs-/Netzwerkhinweise. Nach Prozessneustart monotone gespeicherte Zeitbasis
innerhalb desselben Boots; nach Reboot bis Sync ausdrücklich geschätzte Offlinezeit.

## E – Bestätigung abgeschlossen
Dateien: `Repository.kt`, `MainActivity.kt`, vorhandene Backend-Transition-Route.
Keine optimistischen Erfolge, keine blinde Offline-Wiederholung. Ursprüngliche Version
bleibt bei der Aktion erhalten; 409 lädt neu. Kontowechsel schützt eine lokale
Anmeldegeneration, zusätzlich wird sie innerhalb der Repository-Sperre geprüft.
API-Race-/Replaytests erfolgreich. Echter Netzwerk-End-to-End-Test noch offen.

## F – Benachrichtigungen abgeschlossen
Dateien: `Alarms.kt`, Manifest, `AlarmSchedulerTest.kt`.
AlarmManager unabhängig vom Polling, getrennte Kanäle, exakte kritische Alarme bei
Erlaubnis, ungenauer Fallback, Wiederholung frühestens nach 10 Minuten, persistente
Deduplizierung, Direktaktionen mit sichtbarem Übertragungs-/Fehlerstatus und WorkManager.
Neustart-/Update-Receiver implementiert. Zustellwechsel und besondere Rechte explizit.
Robolectric prüft drei Sessions, Deduplizierung, Terminwechsel, leere Sessions,
bestätigte Aktionen aus altem Cache, fehlende exakte Alarmrechte und globale Meldungssperre.

## G – Stabilisierung und Dokumentation
Erfolgreich: Android `assembleDebug`, `testDebugUnitTest` (**26 Tests**, JUnit/Robolectric/HTTPS),
`lintDebug` (keine Fehler; verbleibende Hinweise zu synchroner Persistenz, KTX-Stil und
neueren Bibliotheksversionen). API-Tests oben und `npm test --prefix ui` (**2 Testdateien**)
erfolgreich. Web-Abhängigkeiten aus bestehendem Lockfile nachinstalliert, Lockfile unverändert.
Der erste zusätzliche Android-Testlauf hatte einen fehlenden Test-Import; korrigiert,
danach alle Tests grün. Web-Tests liefen zunächst ohne TypeScript nicht; nach Installation grün.

Dokumentation: `android/README.md`, `architecture.md`, `testing.md`, Root-README.
APK: `android/app/build/outputs/apk/debug/app-debug.apk`.
Reports: `android/app/build/reports/tests/testDebugUnitTest/` und
`android/app/build/reports/lint-results-debug.html` (generiert, nicht versioniert).

Offen: echte Hardware-/OEM-Tests und physische Wahrnehmung von Ton/Vibration.
Die ergänzten Android-15-Emulator-/HTTPS-Prüfungen sind unten aufgeführt.
Kein FCM/Push-Invalidierungskanal: Web-Änderungen erreichen schlafende Geräte erst beim
nächsten Sync. Nur ein natives Alarmgerät pro Konto vorgesehen. JWT nach 24h erneut
anmelden; serverseitige Zustellwahl bleibt bei Ablauf bestehen. Force-stop, abgeschaltete
Geräte, DND und OEM-Energiesparen verhindern jede pauschale Alarmgarantie.

Nächster konkreter Schritt nach Emulatorprüfung: Backend in freigegebener Testumgebung
bereitstellen und `testing.md` auf realem Testgerät abarbeiten. Kein automatisches Deployment;
App-Installation ausschließlich auf dem eigens angelegten Emulator.

## Fortsetzung – lokale HTTPS-Integration und Android 15
- `CompanionApi`/`CredentialStore` ermöglichen isolierte Tests; Produktions-TLS bleibt
  unverändert. **26 JVM-Tests** erfolgreich, davon 14 echte lokale HTTPS-Integrationstests.
- Behoben: bestätigter Web-Zustellwechsel bleibt bei Nachladefehler dauerhaft erhalten;
  Hintergrund-Sync startet auch nach initialem Lesefehler; Fehlerhinweis verschwindet
  nach erfolgreichem Sync; falsches Passwort erhält eine passende Meldung.
- Alte PendingIntents enthalten jetzt die Anmeldegeneration in ihrer Systemidentität.
  Rechteentzug löscht keine Bestätigungsmarker. Offline-Wiederöffnung stellt den letzten
  bekannten Alarmplan wieder her. Regressionstests für diese Fehlerfälle grün.
- **Vier Instrumentierungstests auf Android 15 erfolgreich:** Compose-Login/HTTPS-Zwang,
  echter Keystore ohne Klartexttoken, HTTPS mit fehlgeschlagener/erfolgreicher Bestätigung,
  drei parallele Android-Meldungen mit Direktaktion, Fehler/Retry und alter Aktion.
- `android/scripts/test-emulator.sh` reproduziert diese Tests ausschließlich auf einem
  expliziten Emulator. `test-recovery.sh` prüft Prozessende/Doze, Reboot und Offline-Neustart
  mit synthetischem Alarm; Fixture ist ohne ausdrückliches Testargument deaktiviert.
- Der erste Software-Emulatorlauf war wegen Android-System-Timeouts ungültig. KVM war
  nur innerhalb der Sandbox unsichtbar; auf dem Host verfügbar. Beschleunigter AOSP-35-
  Emulator unter /tmp, eigenes ADB (5047), ausschließlich emulator-5580. Kein Hardwaregerät.
- App-/Test-APK, Lint und alle JVM-Tests erfolgreich. Im ersten Notification-Gerätetest
  war eine falsche Annahme über WorkManager-Joblisten; auf neue Job-ID statt Anzahl korrigiert.
- **Drei Recovery-Szenarien erfolgreich auf AOSP 35:** kritischer Alarm nach Prozessende
  bei erzwungenem tiefem Doze; nach vollständigem Emulator-Reboot; nach Force-stop und
  Offline-Wiederöffnung. Jeweils tatsächliche NotificationRecord-Zustellung nachgewiesen.
  Screenshot der Offline-Übersicht visuell geprüft. Ton/Vibration auf Hardware weiter offen.
- Reports unter `android/app/build/reports/device/`, einschließlich `recovery-results.txt`.
  Produktions-API unverändert gegenüber Etappe B; kein Deployment, kein produktiver DB-Zugriff.

Abschlussprüfung der Fortsetzung: finale APK erneut gebaut; 26 JVM-Tests, vier Android-15-
Instrumentierungstests und Lint erfolgreich. Drei Recovery-Protokolle enthalten jeweils
eine tatsächlich zugestellte kritische Meldung. Kleine UI-Korrekturen: Singular bei einem
Backvorgang und Android-Zurück aus der Detailansicht. Kein Commit/Push/Deployment.

## GitHub Actions – Android-Build
- `.github/workflows/android.yml`: eigener Workflow für relevante Pushes auf `main`,
  Pull Requests und manuellen Start. Java 17, SDK/Build Tools 35, Gradle Wrapper,
  Gradle-Cache, begrenzte Leserechte und Abbruch überholter Läufe.
- Baut Debug- und Instrumentierungs-APK; JVM-Tests und Lint müssen erfolgreich sein.
  Debug-APK als Download mit Commit-SHA; Prüfberichte auch bei Fehlern, jeweils 14 Tage.
  Kein Emulatorlauf, Release-Signing oder Server-Deployment in diesem Workflow.
- `android/README.md`: Auslöser, Download, Testumfang und wechselnde CI-Debugsignaturen
  dokumentiert. Bestehender Docker-Workflow bleibt unabhängig.
- Prüfung: `actionlint 1.7.7 .github/workflows/android.yml` und `git diff --check`
  erfolgreich. Dieselben vier Gradle-Aufgaben lokal mit vorhandenem Gradle 8.11.1/SDK
  erfolgreich (8 Sekunden; bestehende Build-/Testergebnisse überwiegend UP-TO-DATE,
  kein erneuter Emulatorlauf). Actions-Setup und Upload sind lokal nicht ausführbar.
- Nächster Schritt: nach freigegebenem Commit/Push ersten GitHub-Lauf und APK-Download
  prüfen. Keine zusätzlichen Secrets nötig. Kein Commit, Push oder Deployment erfolgt.

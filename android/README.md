# Crumb Backbegleiter für Android

Native V1, Kotlin/Compose, Android 8+ (minSdk 26), target/compileSdk 35.

## Bauen

JDK **17**, Android SDK 35 und Build Tools 35.0.0 installieren. `ANDROID_HOME`
auf das SDK setzen oder `sdk.dir` in der ignorierten `local.properties` eintragen.

```sh
cd android
./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```

APK: `app/build/outputs/apk/debug/app-debug.apk`. Installation auf einem ausdrücklich
für Entwicklung vorgesehenen Gerät: `adb install -r app/build/outputs/apk/debug/app-debug.apk`.
Debugsignatur ist keine Release-Signatur; produktive Verteilung benötigt eine getrennte Signierkonfiguration.
Keine Zugangsdaten, Serveradressen oder Signierschlüssel sind im Projekt hinterlegt.

## GitHub Actions

Der Workflow [Android](../.github/workflows/android.yml) läuft bei Änderungen unter
`android/` oder an seiner Workflow-Datei: nach Push auf `main`, bei Pull Requests und
manuell über **Actions → Android → Run workflow** (sobald er im Standardbranch liegt).
Er verwendet Java 17, SDK 35 und den versionierten Gradle Wrapper mit Prüfsumme.
JVM-Tests und Lint müssen erfolgreich sein, bevor die Debug-APK hochgeladen wird.
Die Instrumentierungs-APK wird ebenfalls kompiliert; Emulator-/Recovery-Tests werden
hier **nicht ausgeführt** und bleiben Teil des unten beschriebenen Testablaufs.

Unter **Actions → Android → Workflow-Lauf → Artifacts** steht
`crumb-android-debug-<Commit-SHA>` für 14 Tage zum Download bereit. ZIP entpacken und
`app-debug.apk` auf dem Testgerät installieren. Test-/Lint-Berichte werden auch bei
fehlgeschlagenen Prüfungen als separates Artefakt gespeichert, soweit vorhanden.
Es werden keine zusätzlichen Repository-Secrets benötigt und keine Server deployt.
Der bestehende Docker-Workflow läuft unabhängig; Android-Prüfungen blockieren ihn nicht.

Die APK ist ausschließlich eine Testversion. Frische CI-Runner erzeugen jeweils einen
Debugschlüssel; deshalb können APKs verschiedener Läufe unterschiedliche Signaturen
haben. Bei einem Signaturkonflikt muss die alte Test-App deinstalliert werden (lokale
Appdaten gehen verloren). Für dauerhafte Updates braucht es eine stabile Release-Signatur.

## Einrichtung

1. Backend muss die Änderungen dieses Branches enthalten. Beim nächsten **freigegebenen**
   API-Start wird `users.android_bake_delivery` idempotent ergänzt; Standard ist Web-Push.
   Hier wurde kein produktiver Dienst gestartet oder migriert.
2. In der App HTTPS-API-Adresse inklusive `/api` und bestehendes Konto eingeben.
3. Backvorgang wie bisher in Crumb starten. App zeigt alle aktiven Sessions.
4. „Android-Benachrichtigungen einrichten“ erlaubt Systemmeldungen und bietet die
   ausdrückliche kontoweite Umstellung von Backmeldungen an. Nur **ein Android-Gerät**
   pro Konto als Alarmempfänger verwenden. Bestehende Web-Subscriptions bleiben erhalten.
5. Bei Bedarf „Genaue Backtimer erlauben“ aktivieren. Ohne Erlaubnis bleibt ein
   sichtbar gekennzeichneter ungenauer Ersatz. Android-Kanäle regeln Ton und Vibration;
   Web-Ruhezeiten und Web-Vorlaufzeiten werden auf Android nicht übernommen.
6. „Zurück zu Web-Push“ oder erfolgreiche Abmeldung stellt Web-Zustellung wieder her.
   Offline-Abmeldung wird abgelehnt, damit die Zustellwahl nicht unbemerkt hängenbleibt.
   Bei abgelaufenem JWT erneut anmelden; die serverseitige Android-Wahl bleibt bestehen.

Server und Gerät berechnen keine konkurrierenden Timelines: Android sendet die
ursprüngliche Session-Version an die bestehende Transition-API. Bei 409 neu prüfen
und ausdrücklich erneut bestätigen. Offline-Aktionen werden nicht blind wiederholt.

## Tests und bekannte Grenzen

Siehe [Fortschritt](../docs/android/PROGRESS.md), [Architektur](../docs/android/architecture.md)
und [Gerätetestmatrix](../docs/android/testing.md).
Robolectric prüft Android-Systemintegration in einer JVM, nicht reales Doze-/OEM-Verhalten.
Ohne FCM/vergleichbaren Änderungskanal können Web-Änderungen lokale Alarme bis zum
nächsten Sync veralten lassen. Vordergrund: 30 Sekunden; WorkManager: mindestens
15 Minuten und unter Energiesparbedingungen später. Kritische Alarme werden lokal
über AlarmManager geplant und hängen nicht von diesem Polling ab.

Ein bereits an den Web-Push-Provider übergebener Hinweis kann nach dem Wechsel noch
ankommen. Mehrere native Geräte, DND, abgeschaltete Kanäle, ausgeschaltetes Gerät und
Force-stop erlauben kein garantiertes, exklusives Alarmverhalten.

## Reproduzierbare Android-Integrationstests

```sh
./gradlew :app:assembleDebug :app:assembleDebugAndroidTest :app:testDebugUnitTest :app:lintDebug
# Dedizierten AOSP-Emulator (API 35) vollständig starten; KVM außerhalb einer Sandbox prüfen.
./scripts/test-emulator.sh emulator-5554
./scripts/test-recovery.sh emulator-5554
```

Optionaler zweiter Parameter: eigener ADB-Server-Port (hier getestet: `emulator-5580 5047`).
Beide Skripte verweigern physische Geräte. Ausschließlich einen **dedizierten Testemulator**
verwenden: Recovery löscht Crumb-Appdaten, setzt testweise Rechte/Doze, beendet den
App-Prozess und startet den Emulator neu. Am Ende werden synthetische Daten entfernt
und Batterie-/Idle-Zustand zurückgesetzt. Normale Tests verwenden temporäre lokale
HTTPS-Zertifikate ausschließlich im Testprozess; die App vertraut ihnen nicht dauerhaft.

Protokolle/Screenshot: `app/build/reports/device/`. Recovery-Fixtures sind bei normalen
JUnit-/Instrumentierungsläufen deaktiviert. Kein physisches Gerät wurde getestet.

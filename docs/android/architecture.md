# Android Backbegleiter V1

## Bestand und Entscheidungen
- Sessions: `startSession` speichert unveränderlichen Rezept-Snapshot; IDs und flache Schrittindizes bleiben innerhalb einer Session stabil. `finished_at IS NULL` definiert aktiv.
- Engine: locked → ready → active → done, Wartephasen zusätzlich soft_done. `getPendingGates` entsperrt abhängige Phasen; Backen benötigt `start_baking`. `buildUITimeline` liefert geplante Starts, tatsächliche Starts und Timerenden; `calculateProjectedEnd` bleibt ausschließlich serverseitig.
- Schreiben: vorhandenes POST `/api/bake-sessions/:id/transition` mit `expectedVersion`; `saveTransition` prüft Besitzer, Version und offenen Zustand atomar. Gleichzeitige/erneute Aktionen erhalten 409 statt erneut fortzuschreiben. Nach unklarer Netzwerkantwort neu laden, keine automatische Wiederholung mit neuer Version.
- Lesen: GET `/api/bake-sessions/active` bleibt unverändert. Ergänzung `/companion` liefert UTC-Serverzeit, Versionen, stabile IDs, Aktionen und Alarmzeitpunkte. Alle relevanten Schritte bleiben erhalten, auch parallele Phasen. Keine zweite Engine auf Android.
- Auth: bestehendes `/api/auth/login`, Bearer-JWT, 24 Stunden, Widerruf via users.token_version. Android erhält ab 0.2.0 optional eine Gerätesitzung (siehe unten); Token und HTTPS-API-Adresse liegen verschlüsselt mit Android Keystore, nie das Passwort.
- Bestehendes Web-Push: evaluateSession, Nutzereinstellungen/Ruhezeit, DB-Unique-Schlüssel in sent_notifications; fehlgeschlagene Zustellungen werden erneut versucht. ntfy existiert nicht mehr. Widget-Schlüssel ist kein Android-Login.

## Android
Kotlin / Compose / ViewModel → Repository → HTTPS-API; AlarmManager und WorkManager als getrennte Systemintegration. Persistierter letzter Snapshot, monotone elapsedRealtime-Zeitbasis nach Synchronisation. Nach Reboot ist Offlinezeit nur eine Schätzung; sichtbare Warnung. Vordergrund-Sync 30 Sekunden, Hintergrund mindestens 15 Minuten, lokale Alarme unabhängig davon. Keine Offline-Erfolgsbehauptung und keine blinde Aktionswarteschlange.

Normal: einmal je Schritt/Aktion/Termin. Kritisch: jeder laufende Backen-Schritt (auch Temperaturwechsel) mit Alarmkanal und Wiederholung frühestens nach 10 Minuten. Nur aktuell ausführbare Schritte werden alarmiert; Prognosen gesperrter Schritte sind keine verbindlichen Alarmtermine. Gates und Ofenstart haben eigene Aktionen.

Eine explizite kontoweite Zustellwahl `web`/`android` verhindert doppelte Backmeldungen. Android plant nur im Android-Modus; Web unterdrückt dann Backmeldungen, Startermeldungen bleiben erhalten. Mehrere native Geräte sind V1 nicht als exklusive Alarmempfänger koordiniert. Rückwechsel zu Web ausdrücklich möglich.

## Grenzen / Freigabe
Kein FCM-Dienst vorhanden: Änderungen aus dem Web erreichen schlafende Geräte erst bei nächstem Sync. Daher können lokale Meldungen veraltet sein; Aktionen tragen weiterhin die ursprüngliche Version und werden serverseitig abgewiesen. Kein zuverlässiges sofortiges Fern-Stornieren ohne Push-Infrastruktur. Abgelaufene Zugriffstokens werden innerhalb der Gerätesitzung erneuert; deren Ablauf oder Widerruf verlangt eine neue Anmeldung.

SCHEDULE_EXACT_ALARM nur auf ausdrücklichen Nutzerwunsch; sonst ungenaue Ersatzalarme mit sichtbarem Hinweis. POST_NOTIFICATIONS ab Android 13. Kein Fullscreen-Intent, kein DND-Bypass. Doze begrenzt Alarmfrequenz; Gerätehersteller, ausgeschaltetes Gerät, Force-stop und entzogene Rechte können Zustellung verhindern. Reboot plant nach Entsperren neu. Kein Zuverlässigkeitsversprechen ohne Gerätetests.

Quellen: [AlarmManager](https://developer.android.com/develop/background-work/services/alarms), [Android 14](https://developer.android.com/about/versions/14/changes/schedule-exact-alarms), [Compose Compiler](https://developer.android.com/develop/ui/compose/setup-compose-dependencies-and-compiler).

## Verifikation der Android-Systemintegration
Testgrenzen sind explizit: JVM/Robolectric prüft Planung und lokale HTTPS-Fehlerfälle;
separate Test-APK prüft Keystore, Compose und Notification-PendingIntents auf AOSP 35.
Die Produktions-API erhält weder Testendpunkte noch Testzertifikate. Ein eigens angelegter
Emulator verwendet einen eigenen ADB-Port; Recovery-Skripte akzeptieren keine Hardware-Seriennummer.
Doze-Verfahren nach [Android Developers](https://developer.android.com/training/monitoring-device-state/doze-standby).
Die Sandbox kann KVM ausblenden; Verfügbarkeit daher zusätzlich auf dem Host prüfen.

## Erweiterungen 0.2.0
- Native System-Countdowns (`setUsesChronometer`/`setChronometerCountDown`) je zukünftiger
  Aufgabe auf stillem Kanal `timers`. Serverzeitdifferenz wird auf Gerätezeit abgebildet;
  Android führt die laufende Anzeige aus. Kein sekündliches Polling/Foreground-Service.
  Timer-Meldung läuft bei Fälligkeit aus; Alarm bleibt separat und unabhängig geplant.
  Sichtbarkeit ist privat und folgt Android-/Kanal-/Sperrbildschirmeinstellungen.
- Dauerhafter Rechte-Status; Neulesen bei ON_RESUME und erneute Alarmplanung nach
  Rückkehr. Kanalstatus inklusive gesperrter kritischer Meldungen einsehbar.
- Android-Login mit `client: android` erstellt `mobile_sessions`: 256-Bit-Zufallstoken,
  serverseitig ausschließlich SHA-256-Hash; Lebensdauer fest 30 Tage, keine Verlängerung.
  POST `/auth/mobile/refresh` tauscht es gegen einen maximal 24h gültigen JWT.
  Dieser trägt `mobileSessionId`, das jede authentifizierte Anfrage gegen die DB prüft.
  Abmeldung löscht die Sitzung; Passwortwechsel/-reset widerruft über token_version.
  Das Refresh-Token bleibt bis Widerruf/Ablauf unverändert, damit ein verlorener
  Erneuerungs-Response nicht aussperrt. Es ist ein langlebiges Bearer-Geheimnis und
  liegt ausschließlich im Keystore-verschlüsselten Blob; kein Passwort gespeichert.
- Repository serialisiert Erneuerung. Nur ein 401 erlaubt Erneuerung und einen erneuten
  Versuch derselben Anfrage mit ursprünglicher Session-Version. Netzwerkfehler/409
  führen weiterhin nie zu blindem Replay. 503 beim Refresh bewahrt Cache und Anmeldung.
- Release-Signierung optional über Environment-Secrets, stabiler produktiver Schlüssel
  noch bereitzustellen. Bestehende Debugsignaturen sind nicht auf Release übertragbar.

Weitere Quellen: [System-Chronometer](https://developer.android.com/reference/androidx/core/app/NotificationCompat.Builder#setChronometerCountDown(boolean)),
[App-Signierung](https://developer.android.com/studio/publish/app-signing).

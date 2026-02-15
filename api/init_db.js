// api/init_db.js
const db = require('./db');

const initDatabase = async () => {
  // 1. Das SQL-Schema definieren (JSONB-Felder)
  const schema = `
    CREATE TABLE IF NOT EXISTS recipes (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        subtitle TEXT,
        description TEXT,
        image_url TEXT,
        source_url TEXT,
        ingredients JSONB,
        dough_sections JSONB,
        steps JSONB,
        is_favorite BOOLEAN DEFAULT false,
        planned_at TIMESTAMP WITHOUT TIME ZONE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  // 2. Die Retry-Logik, um auf die DB zu warten
  let retries = 5;
  while (retries > 0) {
    try {
      await db.query(schema);
      console.log("✅ Datenbank-Schema wurde erfolgreich überprüft/erstellt.");
      return; // Erfolg! Wir verlassen die Funktion
    } catch (err) {
      console.log(`🔌 Warte auf Datenbank... (${retries} Versuche verbleibend)`);
      console.log("❌ Datenbank-Fehler Details:", err); // Hilft beim Debuggen
      retries -= 1;
      
      // 5 Sekunden warten vor dem nächsten Versuch
      await new Promise(res => setTimeout(res, 5000));
    }
  }

  // Wenn wir hier ankommen, sind alle Versuche fehlgeschlagen
  throw new Error("❌ Datenbank konnte nach mehreren Versuchen nicht erreicht werden.");
};

module.exports = initDatabase;
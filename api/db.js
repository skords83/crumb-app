// api/db.js
require('dotenv').config();
const { Pool } = require('pg');

const dbUrl = process.env.DATABASE_URL;

console.log("-----------------------------------------");
console.log("📡 VERBINDUNGS-CHECK:");
console.log("DATABASE_URL konfiguriert:", Boolean(dbUrl));

if (!dbUrl) {
  console.log("❌ FEHLER: DATABASE_URL ist komplett leer!");
} else if (dbUrl.includes("localhost") || dbUrl.includes("127.0.0.1")) {
  console.log("⚠️ WARNUNG: Du versuchst localhost in Docker zu nutzen. Das wird scheitern!");
  console.log("💡 INFO: Die Adresse muss 'db' statt 'localhost' enthalten.");
}
console.log("-----------------------------------------");

const pool = new Pool({
  connectionString: dbUrl,
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};

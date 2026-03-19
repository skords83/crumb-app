// migrate-categories.js — Einmaliges Script zum Kategorisieren aller Bestandsrezepte
// Ausführen mit: node migrate-categories.js

const { Pool } = require('pg');
const { categorizeRecipe } = require('./categorize');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5432/crumb_db',
});

async function run() {
  const client = await pool.connect();
  try {
    // Alle Rezepte ohne Kategorie oder mit Default 'brot' holen
    const { rows } = await client.query(
      `SELECT id, title, dough_sections FROM recipes`
    );

    console.log(`${rows.length} Rezepte werden kategorisiert...`);

    const counts = { brot: 0, broetchen: 0, pizza: 0, suesses: 0, cracker: 0 };

    for (const recipe of rows) {
      const category = categorizeRecipe(recipe);
      await client.query(
        `UPDATE recipes SET category = $1 WHERE id = $2`,
        [category, recipe.id]
      );
      counts[category]++;
      console.log(`  [${recipe.id}] "${recipe.title}" → ${category}`);
    }

    console.log('\nFertig. Ergebnis:');
    for (const [cat, count] of Object.entries(counts)) {
      console.log(`  ${cat}: ${count}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => {
  console.error('Fehler:', err);
  process.exit(1);
});

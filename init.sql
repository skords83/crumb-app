-- Rezepte-Tabelle mit JSONB-Feldern und Benutzer-Zuordnung
CREATE TABLE IF NOT EXISTS recipes (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
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

-- Users-Tabelle für Authentifizierung
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    reset_token_hash TEXT,
    reset_token_expires TIMESTAMP WITHOUT TIME ZONE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index für schnellere Abfragen nach user_id
CREATE INDEX IF NOT EXISTS idx_recipes_user_id ON recipes(user_id);

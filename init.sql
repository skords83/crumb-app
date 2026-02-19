-- Rezepte-Tabelle mit JSONB-Feldern
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

-- Users-Tabelle für Authentifizierung
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Default-Admin-User (Passwort: admin123)
-- Das Passwort muss nach dem ersten Login geändert werden!
INSERT INTO users (email, password_hash) 
VALUES ('admin@crumb.local', '$2b$10$YourHashedPasswordHere')
ON CONFLICT (email) DO NOTHING;

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
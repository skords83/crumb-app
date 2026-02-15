# Wir nehmen das gleiche Basis-Image
FROM postgres:15-alpine

# Wir kopieren die SQL-Datei direkt an den Ort, 
# den Postgres beim Start automatisch scannt
COPY init.sql /docker-entrypoint-initdb.d/

# Wir stellen sicher, dass die Rechte im Container stimmen
RUN chmod 644 /docker-entrypoint-initdb.d/init.sql
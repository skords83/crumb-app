# Root Dockerfile für Coolify
# Dieses Dockerfile baut das UI aus dem ui/ Verzeichnis

FROM node:20-alpine

WORKDIR /usr/src/app

# Kopiere package.json aus ui/
COPY ui/package*.json ./
RUN npm install

# Kopiere den Rest
COPY ui/ .

# Build-Argument für NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

# Next.js baut die Anwendung für die Produktion
RUN npm run build

EXPOSE 3000

# Startet den Next.js Server
CMD ["npm", "start"]

FROM node:20-alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .

# Build-Argument für NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

# Next.js baut die Anwendung für die Produktion
RUN npm run build

EXPOSE 3000

# Startet den Next.js Server
CMD ["npm", "start"]

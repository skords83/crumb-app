FROM node:20-alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .

# Next.js baut die Anwendung für die Produktion
RUN npm run build

EXPOSE 3000

# Startet den Next.js Server
CMD ["npm", "start"]

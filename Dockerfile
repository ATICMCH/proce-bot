# Use official Node.js image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy the rest of the code
COPY . .

# Expose port (cambia si tu app usa otro puerto)
EXPOSE 3000

# Start the app
CMD ["node", "index.js"]

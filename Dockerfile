FROM ghcr.io/puppeteer/puppeteer:21.6.1

# Switch to root to configure the app
USER root

WORKDIR /app

# Install dependencies first for better caching
COPY package*.json ./
RUN npm install

# Copy application files
COPY . .

# Ensure correct ownership
RUN chown -R pptruser:pptruser /app

# Switch back to the non-root user provided by the image
USER pptruser

EXPOSE 3000

CMD ["npm", "start"]

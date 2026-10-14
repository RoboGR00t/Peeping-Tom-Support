# Use a lightweight Node.js image
FROM node:18-alpine

# Set the working directory inside the container
WORKDIR /usr/src/app

# Install native compilation tools (Required for sqlite3 and bcrypt on Alpine)
RUN apk add --no-cache python3 make g++ 

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the application code
COPY . .

# Ensure the data directory exists for the SQLite database
RUN mkdir -p data

# Expose the port the app runs on
EXPOSE 3000

# Command to run the application
CMD ["node", "server.js"]

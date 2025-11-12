#!/bin/bash
# Installation script for web-search MCP server

echo "🔍 Installing web-search MCP server..."

# Check if web-search directory already exists
if [ -d "web-search" ]; then
    echo "⚠️  web-search directory already exists. Skipping clone."
    cd web-search
else
    echo "📦 Cloning web-search repository..."
    git clone https://github.com/pskill9/web-search.git
    cd web-search
fi

echo "📥 Installing dependencies..."
npm install

echo "🔨 Building server..."
npm run build

if [ -f "build/index.js" ]; then
    echo "✅ Web-search MCP server installed successfully!"
    echo "📁 Server location: $(pwd)/build/index.js"
    echo ""
    echo "Next steps:"
    echo "1. The server is already configured in backend/src/mcp-servers-config.ts"
    echo "2. Enable it by setting MCP_ENABLED_SERVERS=business,chart,websearch in .env"
    echo "3. Restart your backend server"
else
    echo "❌ Build failed. Please check the errors above."
    exit 1
fi

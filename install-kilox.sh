#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
BIN_SRC="$ROOT/packages/opencode/bin/kilox-dev"
LINK_TARGET="$HOME/bin/kilox"

echo "==> Installing dependencies..."
bun install --ignore-scripts

echo "==> Creating kilox-dev wrapper script..."
cat > "$BIN_SRC" << 'WRAPPER'
#!/bin/bash
export KILO_ORIG_CWD="$(pwd)"
cd /Users/junx/Workspace/opensource/kilocodex/packages/opencode && bun run --conditions=browser ./src/index.ts "$@"
WRAPPER
chmod +x "$BIN_SRC"

echo "==> Linking kilox command..."
mkdir -p ~/bin
ln -sf "$BIN_SRC" "$LINK_TARGET"

if ! echo "$PATH" | tr ':' '\n' | grep -q "^$HOME/bin$"; then
  echo 'export PATH="$HOME/bin:$PATH"' >> ~/.zshrc
  echo "    Added ~/bin to PATH in ~/.zshrc"
fi

export PATH="$HOME/bin:$PATH"

echo "==> Testing kilox..."
VERSION=$(kilox --version 2>&1)
echo "    kilox --version => $VERSION"

echo ""
echo "✅ kilox installed successfully!"
echo "   Command: kilox"
echo "   Link:    $LINK_TARGET -> $BIN_SRC"
echo "   Run 'kilox' to start TUI"

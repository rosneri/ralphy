.PHONY: install help build copy-bin copy-assets init-tasks configure-mcp configure-package

# Capture additional arguments (e.g., make install /path/to/install)
ARGS := $(wordlist 2,$(words $(MAKECMDGOALS)),$(MAKECMDGOALS))
$(eval $(ARGS):;@:)

# Installation path - appends /.ralph to the provided path
BASE_PATH ?= $(if $(ARGS),$(ARGS),.)
INSTALL_PATH := $(BASE_PATH)/.ralph

# --- Targets ---

help:
	@echo "Available targets:"
	@echo "  make install              Install to ./.ralph (default)"
	@echo "  make install /path/to/dir Install to /path/to/dir/.ralph"
	@echo ""
	@echo "Examples:"
	@echo "  make install ~"
	@echo "  → Installs to ~/.ralph"

install: build copy-bin copy-assets init-tasks configure-mcp configure-package init-openspec
	@echo "✓ Installation complete at $(INSTALL_PATH)"
	@echo "  cli: $(abspath $(INSTALL_PATH)/bin/cli.js)"
	@echo "  mcp: $(abspath $(INSTALL_PATH)/bin/mcp.js)"

build:
	@echo "Building..."
	@bunx nx run-many --target=build --projects=cli,mcp --output-style=stream

copy-bin:
	@mkdir -p "$(INSTALL_PATH)/bin"
	@cp dist/cli/index.js "$(INSTALL_PATH)/bin/cli.js"
	@cp dist/mcp/index.js "$(INSTALL_PATH)/bin/mcp.js"
	@echo "  ✓ Copied binaries"

copy-assets:
	@echo "  ✓ Copied assets"

init-tasks:
	@if [ ! -d "$(INSTALL_PATH)/tasks" ]; then \
		mkdir -p "$(INSTALL_PATH)/tasks"; \
	else \
		echo "  ℹ️  Preserving existing tasks directory"; \
	fi
	@touch "$(INSTALL_PATH)/tasks/.gitkeep"

configure-mcp:
	@MCP_FILE="$(BASE_PATH)/.mcp.json"; \
	ENTRY="{\"type\":\"stdio\",\"command\":\"bun\",\"args\":[\".ralph/bin/mcp.js\"],\"env\":{}}"; \
	if [ -f "$$MCP_FILE" ]; then \
		jq --argjson ralph "$$ENTRY" '.mcpServers.ralph = $$ralph' "$$MCP_FILE" | \
		perl -0777 -pe 's/\[\s*\n\s*(".*?")\s*\n\s*\]/[\1]/g' > "$$MCP_FILE.tmp" && \
		mv "$$MCP_FILE.tmp" "$$MCP_FILE"; \
	else \
		echo "{}" | jq --argjson ralph "$$ENTRY" '.mcpServers.ralph = $$ralph' | \
		perl -0777 -pe 's/\[\s*\n\s*(".*?")\s*\n\s*\]/[\1]/g' > "$$MCP_FILE"; \
	fi
	@echo "  ✓ MCP server configured in .mcp.json"

init-openspec:
	@echo "  Initializing OpenSpec..."
	@cd "$(BASE_PATH)" && bunx @fission-ai/openspec init --tools none --force
	@echo "  ✓ OpenSpec initialized"

configure-package:
	@if [ -f "$(BASE_PATH)/package.json" ] && command -v jq &> /dev/null; then \
		jq '.scripts.ralph = "bun .ralph/bin/cli.js"' "$(BASE_PATH)/package.json" > "$(BASE_PATH)/package.json.tmp" && \
		mv "$(BASE_PATH)/package.json.tmp" "$(BASE_PATH)/package.json"; \
		echo "  ✓ Added ralph script to package.json"; \
	fi

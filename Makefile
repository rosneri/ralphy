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
	@echo "  shell: $(abspath $(INSTALL_PATH)/bin/shell.js)"
	@echo "  mcp:   $(abspath $(INSTALL_PATH)/bin/mcp.js)"

build:
	@echo "Building..."
	@bunx nx run-many --target=build --projects=shell,mcp --output-style=stream

copy-bin:
	@mkdir -p "$(INSTALL_PATH)/bin"
	@cp dist/shell/index.js "$(INSTALL_PATH)/bin/shell.js"
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
		CURRENT=$$(jq -cS '.mcpServers.ralph // empty' "$$MCP_FILE" 2>/dev/null); \
		WANT=$$(echo "$$ENTRY" | jq -cS '.'); \
		if [ "$$CURRENT" = "$$WANT" ]; then \
			echo "  ℹ️  MCP server already configured; leaving .mcp.json untouched"; \
		else \
			jq --argjson ralph "$$ENTRY" '.mcpServers.ralph = $$ralph' "$$MCP_FILE" | \
			perl -0777 -pe 's/\[\s*("(?:[^"\\]|\\.)*"(?:\s*,\s*"(?:[^"\\]|\\.)*")*)\s*\]/"[" . join(", ", $$1 =~ m{("(?:[^"\\]|\\.)*")}g) . "]"/ge' > "$$MCP_FILE.tmp" && \
			mv "$$MCP_FILE.tmp" "$$MCP_FILE"; \
			echo "  ✓ MCP server configured in .mcp.json"; \
		fi; \
	else \
		echo "{}" | jq --argjson ralph "$$ENTRY" '.mcpServers.ralph = $$ralph' | \
		perl -0777 -pe 's/\[\s*("(?:[^"\\]|\\.)*"(?:\s*,\s*"(?:[^"\\]|\\.)*")*)\s*\]/"[" . join(", ", $$1 =~ m{("(?:[^"\\]|\\.)*")}g) . "]"/ge' > "$$MCP_FILE"; \
		echo "  ✓ MCP server configured in .mcp.json"; \
	fi

init-openspec:
	@echo "  Initializing OpenSpec..."
	@cd "$(BASE_PATH)" && bunx @fission-ai/openspec init --tools none --force
	@echo "  ✓ OpenSpec initialized"

configure-package:
	@if [ -f "$(BASE_PATH)/package.json" ] && command -v jq &> /dev/null; then \
		jq '.scripts.ralphy = "bun .ralph/bin/shell.js"' "$(BASE_PATH)/package.json" > "$(BASE_PATH)/package.json.tmp" && \
		mv "$(BASE_PATH)/package.json.tmp" "$(BASE_PATH)/package.json"; \
		echo "  ✓ Added ralphy script to package.json"; \
	fi

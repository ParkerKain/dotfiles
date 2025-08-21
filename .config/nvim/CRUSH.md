# Neovim Configuration - CRUSH Guidelines

## Build/Test Commands
- **Plugin Management**: `nvim --headless -c "Lazy! sync" -c "qa"` (sync plugins)
- **Plugin Update**: `nvim --headless -c "Lazy! update" -c "qa"` (update plugins)
- **Treesitter Update**: `nvim --headless -c "TSUpdate" -c "qa"` (update parsers)
- **Health Check**: `nvim --headless -c "checkhealth" -c "qa"` (validate config)
- **Test Config**: `nvim --clean -u init.lua` (test configuration)

## Code Style Guidelines

### File Structure
- Main config in `init.lua` at root
- Plugin configs in `lua/plugins/` directory  
- Core configs in `lua/config/` directory
- Each plugin returns a table with setup configuration

### Lua Conventions
- Use snake_case for variables and functions
- Use double quotes for strings consistently
- Indent with tabs (consistent with existing codebase)
- Plugin tables should have explicit name field when needed
- Use lazy loading (`lazy = false`) only when necessary

### Plugin Configuration
- Each plugin file returns a single table
- Include dependencies explicitly in plugin specs
- Use config function for setup code
- Prefer lazy.nvim plugin manager syntax
- Set colorscheme in install config and plugin config

### LSP Configuration  
- Use vim.lsp.config() for client setup
- Set root_markers to { '.git' } for project detection
- Enable LSPs explicitly with vim.lsp.enable()
- Use uvx for Python tools when available
require("config.lazy")

vim.opt.number = true

vim.diagnostic.config {
	signs = {
		text = {
			[vim.diagnostic.severity.ERROR] = " ",
			[vim.diagnostic.severity.WARN] = " ",
			[vim.diagnostic.severity.INFO] = " ",
			[vim.diagnostic.severity.HINT] = " ",
		},
	},
}

-- =====================================================
-- Configure LSP clients 
-- =====================================================

-- Set default root markers for all clients
vim.lsp.config('*', {
  root_markers = { '.git' },
})

-- Set configuration for python
vim.lsp.config['pyrightls'] =  {
  cmd = { 'pyright-langserver', '--stdio' },
  filetypes = { 'python' },
  root_markers = {
    "pyproject.toml",
    "setup.py",
    "setup.cfg",
    "requirements.txt",
  },
  settings = {
    python = {
      analysis = {
	autoSearchPaths = true,
	useLibraryCodeForTypes = true,
      },
    },
  },
}

vim.lsp.config['luals'] = {
  -- Command and arguments to start the server.
  cmd = { 'lua-language-server' },
  -- Filetypes to automatically attach to.
  filetypes = { 'lua' },
  -- Sets the "workspace" to the directory where any of these files is found.
  -- Files that share a root directory will reuse the LSP server connection.
  -- Nested lists indicate equal priority, see |vim.lsp.Config|.
  root_markers = { { '.luarc.json', '.luarc.jsonc' }, '.git' },
  -- Specific settings to send to the server. The schema is server-defined.
  -- Example: https://raw.githubusercontent.com/LuaLS/vscode-lua/master/setting/schema.json
  settings = {
    Lua = {
      runtime = {
        version = 'LuaJIT',
      }
    }
  }
}

-- Enable LSPs
vim.lsp.enable('pyrightls')
vim.lsp.enable('luals')

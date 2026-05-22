-- nvim-treesitter rewrite (Neovim 0.12+): no configs module, no ensure_installed.
-- Parsers are installed via :install(); highlight/indent are Neovim-native, enabled via autocmds in init.lua.
return {
	"nvim-treesitter/nvim-treesitter",
	lazy = false,
	build = ":TSUpdate",
	config = function()
		require("nvim-treesitter").install({
			-- core vim
			"vim", "vimdoc", "lua", "query",
			-- systems
			"c", "cpp", "rust", "go",
			-- scripting / web
			"python", "ruby", "javascript", "typescript", "tsx", "bash",
			-- markup / styles
			"html", "css", "markdown", "markdown_inline",
			-- data / config
			"json", "yaml", "toml", "ini", "dockerfile",
			-- sql
			"sql",
			-- git
			"gitignore", "gitcommit", "gitattributes",
			-- misc
			"regex",
		})
	end,
}

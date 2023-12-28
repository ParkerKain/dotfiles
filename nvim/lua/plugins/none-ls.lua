return {
	"nvimtools/none-ls.nvim",
	config = function()
		local null_ls = require("null-ls")
		null_ls.setup({
			sources = {
        -- lua
				null_ls.builtins.formatting.stylua,

        -- python
	      null_ls.builtins.diagnostics.mypy,
	      null_ls.builtins.diagnostics.ruff,
	      null_ls.builtins.formatting.black,

        -- webdev
	      null_ls.builtins.formatting.eslint,
	      null_ls.builtins.formatting.prettier.with { filetypes = { "html", "markdown", "css", "svelte" } }, -- so prettier works only on these filetypes
			},
		})

		vim.keymap.set("n", "<leader>gf", vim.lsp.buf.format, {})
	end,
}

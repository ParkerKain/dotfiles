return {
	"nvim-treesitter/nvim-treesitter",
	build = ":TSUpdate",
	config = function()
		-- Treesitter
		local config = require("nvim-treesitter.configs")
		config.setup({
      autoinstall = true,
			highlight = { enable = true },
			indent = { enable = true },

		})
	end,
}

return {
	"nvim-telescope/telescope.nvim",
	dependencies = { "nvim-lua/plenary.nvim" },
	keys = {
		{ "<leader>sf", "<cmd>Telescope find_files<cr>", desc = "Find Files" },
	},
}

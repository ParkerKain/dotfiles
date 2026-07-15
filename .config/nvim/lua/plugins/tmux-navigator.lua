return {
	"christoomey/vim-tmux-navigator",
	lazy = false,
	init = function()
		vim.g.tmux_navigator_no_mappings = 1
	end,
	keys = {
		{ "<C-Left>", "<cmd>TmuxNavigateLeft<cr>" },
		{ "<C-Down>", "<cmd>TmuxNavigateDown<cr>" },
		{ "<C-Up>", "<cmd>TmuxNavigateUp<cr>" },
		{ "<C-Right>", "<cmd>TmuxNavigateRight<cr>" },
	},
}

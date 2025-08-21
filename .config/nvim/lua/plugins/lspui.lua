return {
	"jinzhongjia/LspUI.nvim",
	branch = "main",
	lazy = false,
	config = function()
		require("LspUI").setup({})
	end,
	keys = {
		{ "K", "<cmd>LspUI hover<CR>", desc = "Hover" },
		{ "gr", "<cmd>LspUI reference<CR>", desc = "Go-To References" },
		{ "gd", "<cmd>LspUI definition<CR>", desc = "Go-To Definition" },
		{ "gt", "<cmd>LspUI type_definition<CR>", desc = "Type Definition" },
		{ "gi", "<cmd>LspUI implementation<CR>", desc = "Go To Implementation" },
		{ "<leader>cr", "<cmd>LspUI rename<CR>", desc = "Rename" },
		{ "<leader>ca", "<cmd>LspUI code_action<CR>", desc = "Code Actions" },
		{ "<leader>ci", "<cmd>LspUI call_hierarchy incoming_calls<CR>", desc = "Incoming Calls" },
		{ "<leader>co", "<cmd>LspUI call_hierarchy outgoing_calls<CR>", desc = "Outgoing Calls" },
	},
}

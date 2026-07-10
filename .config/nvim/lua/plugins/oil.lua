return {
	"stevearc/oil.nvim",
	---@module 'oil'
	---@type oil.SetupOpts
	opts = {
		keymaps = {
			["gx"] = {
				callback = function()
					local oil = require("oil")
					local entry = oil.get_cursor_entry()
					local dir = oil.get_current_dir()
					if entry and dir then
						vim.ui.open(dir .. entry.name)
					end
				end,
				desc = "Open entry with system default",
			},
		},
	},
	-- Optional dependencies
	dependencies = { { "echasnovski/mini.icons", opts = {} } },
	-- dependencies = { "nvim-tree/nvim-web-devicons" }, -- use if you prefer nvim-web-devicons
	-- Lazy loading is not recommended because it is very tricky to make it work correctly in all situations.
	lazy = false,
	keys = {
		{ "<leader>e", "<CMD>Oil<CR>", { desc = "Open parent directory" } },
	},
}

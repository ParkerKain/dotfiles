return {
	"nvim-telescope/telescope.nvim",
	dependencies = { "nvim-lua/plenary.nvim" },
	keys = {
		{ "<leader>sf", "<cmd>Telescope find_files<cr>", desc = "Find Files" },
		{ "<leader>sg", "<cmd>Telescope live_grep<cr>", desc = "Find Grep" },
	},
	opts = function()
		local actions = require("telescope.actions")
		local action_state = require("telescope.actions.state")

		local function system_open(prompt_bufnr)
			local entry = action_state.get_selected_entry()
			actions.close(prompt_bufnr)
			if entry then
				local path = entry.path or entry.filename or entry.value
				vim.ui.open(vim.fn.fnamemodify(path, ":p"))
			end
		end

		return {
			defaults = {
				mappings = {
					i = { ["<C-o>"] = system_open },
					n = { ["<C-o>"] = system_open },
				},
			},
			pickers = {
				find_files = {
					-- include gitignored + hidden files, but never .git/, node_modules, or site-packages
					hidden = true,
					no_ignore = true,
					file_ignore_patterns = { "%.git/", "node_modules/", "site%-packages/" },
				},
				live_grep = {
					additional_args = { "--hidden", "--no-ignore" },
					file_ignore_patterns = { "%.git/", "node_modules/", "site%-packages/" },
				},
			},
		}
	end,
}

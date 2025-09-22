return {
	"olimorris/codecompanion.nvim",
	opts = {
		strategies = {
			-- Change the default chat adapter and model
			chat = {
				adapter = "ollama",
				model = "gpt-oss:20b",
			},
			inline = {
				adapter = "ollama",
				model = "gpt-oss:20b",
			},
			cmd = {
				adapter = "ollama",
				model = "gpt-oss:20b",
			},
		},
		-- NOTE: The log_level is in `opts.opts`
		opts = {
			log_level = "DEBUG",
		},
	},
	dependencies = {
		"nvim-lua/plenary.nvim",
	},
	keys = {
		{ "<C-a>", "<cmd>CodeCompanionActions<cr>", desc = "Code Companion Actions" },
		{ "<leader>a", "<cmd>CodeCompanionChat Toggle<cr>", desc = "Code Companion Chat Toggle" },
		{ "ga", "<cmd>CodeCompanionChat Add<cr>", desc = "Code Companion Chat Add", mode = "v" },
	},
}

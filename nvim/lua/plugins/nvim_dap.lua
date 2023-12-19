return {
	"mfussenegger/nvim-dap",
	config = function(_, opts)
		local dap = require("dap")
		dap.adapters.gdb = {
			type = "executable",
			command = "gdb",
			args = { "-i", "dap" },
		}
		dap.configurations.c = {
			{
				name = "Launch",
				type = "gdb",
				request = "launch",
				program = function()
					return vim.fn.input("Path to executable: ", vim.fn.getcwd() .. "/", "file")
				end,
				cwd = "${workspaceFolder}",
			},
		}
	end,
	keys = {
		{ "<leader>db", "<cmd> DapToggleBreakpoint <CR>", desc = "Toggle Breakpoint" },
		{ "<F1>", "<cmd> DapStepInto <CR>", desc = "Step Into" },
		{ "<F2>", "<cmd> DapStepOver <CR>", desc = "Step Over" },
		{ "<F3>", "<cmd> DapStepOut <CR>", desc = "Step Out" },
		{ "<F5>", "<cmd> DapContinue <CR>", desc = "DAP Continue" },
	},
}

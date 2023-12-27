return {
  {
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
  },
  {
    "rcarriga/nvim-dap-ui",
    dependencies = "mfussenegger/nvim-dap",
    config = function()
      local dap = require "dap"
      local dapui = require "dapui"
      dapui.setup()
      dap.listeners.after.event_initialized["dapui_config"] = function()
        dapui.open()
      end
      dap.listeners.before.event_terminated["dapui_config"] = function()
        dapui.close()
      end
      dap.listeners.before.event_exited["dapui_config"] = function()
        dapui.close()
      end
    end,
  },
  {
    "mfussenegger/nvim-dap-python",
    ft = "python",
    dependencies = {
      "mfussenegger/nvim-dap",
      "rcarriga/nvim-dap-ui",
    },
    config = function(_, opts)
      local path = "~/.local/share/nvim/mason/packages/debugpy/venv/bin/python"
      require("dap-python").setup(path)
      require("dap").configurations.python = {
        {
          type = "python",
          request = "launch",
          name = "Launch file",
          program = "${file}", -- This configuration will launch the current file if used.
        },
        {
          type = "python",
          request = "launch",
          name = "Launch module with arguments",
          module = function()
            local module_name = vim.fn.input "Module name: "
            return module_name
          end,
          args = function()
            local args_string = vim.fn.input "Arguments: "
            local list_to_return = vim.split(args_string, " +")
            return list_to_return
          end,
        },
        {
          type = "python",
          request = "launch",
          name = "Launch module",
          module = function()
            local module_name = vim.fn.input "Module name: "
            return module_name
          end,
        },
        {
          type = "python",
          request = "launch",
          name = "Run Pytests",
          module = "pytest",
        },
      }
    end,
  }
}

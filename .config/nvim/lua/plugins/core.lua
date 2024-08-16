return {
  {
    "nvimdev/dashboard-nvim",
    opts = function()
      local logo = [[
	    ██████╗  █████╗ ██████╗ ██╗  ██╗      ██████╗ ███████╗
	    ██╔══██╗██╔══██╗██╔══██╗██║ ██╔╝     ██╔═══██╗██╔════╝
	    ██████╔╝███████║██████╔╝█████╔╝█████╗██║   ██║███████╗
	    ██╔═══╝ ██╔══██║██╔══██╗██╔═██╗╚════╝██║   ██║╚════██║
	    ██║     ██║  ██║██║  ██║██║  ██╗     ╚██████╔╝███████║
	    ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝      ╚═════╝ ╚══════╝
      ]]

      logo = string.rep("\n", 8) .. logo .. "\n\n"

      local opts = {
        theme = "doom",
        hide = {
          -- this is taken care of by lualine
          -- enabling this messes up the actual laststatus setting after loading a file
          statusline = false,
        },
        config = {
          header = vim.split(logo, "\n"),
      -- stylua: ignore
      center = {
        { action = "Telescope find_files",                                     desc = " Find file",       icon = " ", key = "f" },
        { action = "ene | startinsert",                                        desc = " New file",        icon = " ", key = "n" },
        { action = "Telescope oldfiles",                                       desc = " Recent files",    icon = " ", key = "r" },
        { action = "Telescope live_grep",                                      desc = " Find text",       icon = " ", key = "g" },
        { action = [[lua require("lazyvim.util").telescope.config_files()()]], desc = " Config",          icon = " ", key = "c" },
        { action = 'lua require("persistence").load()',                        desc = " Restore Session", icon = " ", key = "s" },
        { action = "LazyExtras",                                               desc = " Lazy Extras",     icon = " ", key = "x" },
        { action = "Lazy",                                                     desc = " Lazy",            icon = "󰒲 ", key = "l" },
        { action = "qa",                                                       desc = " Quit",            icon = " ", key = "q" },
      },
          footer = function()
            local stats = require("lazy").stats()
            local ms = (math.floor(stats.startuptime * 100 + 0.5) / 100)
            return { "⚡ Neovim loaded " .. stats.loaded .. "/" .. stats.count .. " plugins in " .. ms .. "ms" }
          end,
        },
      }

      for _, button in ipairs(opts.config.center) do
        button.desc = button.desc .. string.rep(" ", 43 - #button.desc)
        button.key_format = "  %s"
      end

      -- close Lazy and re-open when the dashboard is ready
      if vim.o.filetype == "lazy" then
        vim.cmd.close()
        vim.api.nvim_create_autocmd("User", {
          pattern = "DashboardLoaded",
          callback = function()
            require("lazy").show()
          end,
        })
      end

      return opts
    end,
  },
  {

    "nvim-tree/nvim-web-devicons",
    config = function()
      require("nvim-web-devicons").setup({
        override = {
          toml = {
            icon = "",
            color = "#428850",
            cterm_color = "65",
            name = "toml",
          },
        },
      })
    end,
  },
  {
    -- add rose pine
    -- { "shaunsingh/nord.nvim" },
    { "rose-pine/neovim", name = "rose-pine" },
    { "projekt0n/github-nvim-theme" },
    { "ewilazarus/preto" },

    -- Configure LazyVim to load gruvbox
    {
      "LazyVim/LazyVim",
      opts = {
        -- colorscheme = "github_dark_high_contrast",
        -- colorscheme = "preto",
        colorscheme = "rose-pine",
      },
    },
  },
  {
    "nvim-neotest/nvim-nio",
  },
  {
    "rcarriga/nvim-dap-ui",
    dependencies = "mfussenegger/nvim-dap",
    config = function()
      local dap = require("dap")
      local dapui = require("dapui")
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
            local module_name = vim.fn.input("Module name: ")
            return module_name
          end,
          args = function()
            local args_string = vim.fn.input("Arguments: ")
            local list_to_return = vim.split(args_string, " +")
            return list_to_return
          end,
        },
        {
          type = "python",
          request = "launch",
          name = "Launch module",
          module = function()
            local module_name = vim.fn.input("Module name: ")
            return module_name
          end,
        },
        {
          type = "python",
          request = "launch",
          name = "Run Pytests",
          module = "pytest",
          args = function()
            local args_string = vim.fn.input("Arguments: ")
            local list_to_return = vim.split(args_string, " +")
            return list_to_return
          end,
        },
      }
    end,
  },
}

return { 
    "zbirenbaum/copilot.lua",
      cmd = "Copilot",
      event = "InsertEnter",
      config = function()
        require('copilot').setup({
          panel = {
            auto_refresh = false,
            keymap = {
              jump_prev = "[[",
              jump_next = "]]",
              accept = "<CR>",
              open = "<C-CR>"
            },
          },
            suggestion = {
              auto_trigger = true,
              keymap = {
                accept = "<C-l>",
                next = "<C-]>",
                prev = "<C-}>",
                dismiss = "<C-k>",
          },
          },
          filetypes = {
            yaml = true,
            markdown = false,
          },
        })
      end,
    }

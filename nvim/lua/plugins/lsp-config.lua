return {
  {
    "williamboman/mason.nvim",
    config = function()
      require("mason").setup()
    end
  },
  {
    "williamboman/mason-lspconfig.nvim",
    config = function()
      require("mason-lspconfig").setup({
        ensure_installed = {
          "lua_ls",
          "cssls",
          "dockerls",
          "grammarly",
          "jsonls",
          "tsserver",
          "marksman",
          "pyright",
          "rust_analyzer",
          "svelte",
          "terraformls",
          "yamlls",
        }
      })
    end
  },
  {
    "neovim/nvim-lspconfig",
    config = function()
      local lspconfig = require("lspconfig")

      -- Language Servers
      lspconfig.lua_ls.setup({})
      lspconfig.cssls.setup({})
      lspconfig.dockerls.setup({})
      lspconfig.grammarly.setup({})
      lspconfig.jsonls.setup({})
      lspconfig.tsserver.setup({})
      lspconfig.marksman.setup({})
      lspconfig.pyright.setup({})
      lspconfig.svelte.setup({})
      lspconfig.rust_analyzer.setup({})
      lspconfig.terraformls.setup({})
      lspconfig.yamlls.setup({})

      -- Bindings
      vim.keymap.set("n", "K", vim.lsp.buf.hover, {})
      vim.keymap.set("n", "gd", vim.lsp.buf.definition, {})
      vim.keymap.set({"n", "v"}, "<leader>ca", vim.lsp.buf.code_action, {})
    end
  }
}

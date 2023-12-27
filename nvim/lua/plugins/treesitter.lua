return {
  "nvim-treesitter/nvim-treesitter", 
  build = ":TSUpdate",
  config = function()
    -- Treesitter
    local config = require("nvim-treesitter.configs")
    config.setup({
      ensure_installed = {
        "lua", "javascript", "rust", "python", "typescript", "bash", "c", "css", 
        "csv", "dockerfile", "gitignore", "json", "lua", "markdown", "markdown_inline", 
        "sql", "svelte", "terraform", "toml", "yaml"
      },
      highlight = {enable = true}, 
      indent = {enable = true}
    })
  end
}

-- Tab management
vim.cmd("set expandtab")
vim.cmd("set tabstop=2")
vim.cmd("set softtabstop=2")
vim.cmd("set shiftwidth=2")

-- Leader
vim.g.mapleader = " "

-- Line Numbers
vim.wo.number = true
vim.wo.relativenumber = true

-- Remove highlighting on double ESC
vim.keymap.set("n", "<ESC><ESC>", "<cmd>:noh<CR>", { noremap = true, silent = true })

-- Keybind for vertical split
vim.keymap.set("n", "<leader>vs", "<cmd>:vsplit<CR>", { noremap = true, silent = true })

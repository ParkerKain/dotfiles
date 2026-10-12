-- Ctrl+Arrow moves between nvim splits and, at an edge, out to the
-- neighboring multiplexer pane. Inside tmux this is vim-tmux-navigator.
-- Inside herdr, herdr's `nav` script forwards Ctrl+Arrow to nvim, and at
-- the edge nvim asks herdr to move focus (dotfiles/herdr/bin/nav).
local function navigate(wincmd, tmux_cmd, herdr_dir)
	return function()
		if vim.env.TMUX then
			vim.cmd(tmux_cmd)
			return
		end
		local win = vim.api.nvim_get_current_win()
		vim.cmd("wincmd " .. wincmd)
		if vim.api.nvim_get_current_win() == win and vim.env.HERDR_ENV == "1" and vim.env.HERDR_PANE_ID then
			vim.fn.jobstart({
				vim.env.HERDR_BIN_PATH or "herdr",
				"pane", "focus", "--direction", herdr_dir, "--pane", vim.env.HERDR_PANE_ID,
			}, { detach = true })
		end
	end
end

return {
	"christoomey/vim-tmux-navigator",
	lazy = false,
	init = function()
		vim.g.tmux_navigator_no_mappings = 1
	end,
	keys = {
		{ "<C-Left>", navigate("h", "TmuxNavigateLeft", "left"), desc = "Window or pane left" },
		{ "<C-Down>", navigate("j", "TmuxNavigateDown", "down"), desc = "Window or pane down" },
		{ "<C-Up>", navigate("k", "TmuxNavigateUp", "up"), desc = "Window or pane up" },
		{ "<C-Right>", navigate("l", "TmuxNavigateRight", "right"), desc = "Window or pane right" },
	},
}

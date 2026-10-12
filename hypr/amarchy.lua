-- amarchy keybindings and window rules for Omarchy's Hyprland config.
--
-- install.sh loads this from ~/.config/hypr/hyprland.lua. To change the keys,
-- set a table named `amarchy` before the dofile line, e.g.
--
--   amarchy = { mod = "MOD3", open_key = "A", new_key = "N" }
--
-- Getting to amarchy, from anywhere:
--   mod          modifier for these keys (default "SUPER + ALT")
--   open_key     go to the last session you were in (default "A")
--   new_key      start a session: pick a project (default "N")
--
-- Moving around inside it:
--   nav_mod      modifier for these keys (default "CTRL + ALT")
--   next_key     the session below in the list (default "J")
--   prev_key     the session above (default "K")
--   terminal_key toggle the session's terminal under Claude (default "RETURN")
--   nav_new_key  start a session (default "N")
--   add_key      add a project (default "A")
--   close_key    close this session, after asking (default "X")
--
-- Moving between Claude and the terminal is Omarchy's own Super+arrows.
--
--   bin          path to the amarchy script (default ~/.local/bin/amarchy)
--
-- Any key set to false is left unbound.

local cfg = amarchy or {}
local home = os.getenv("HOME")
local mod = cfg.mod or "SUPER + ALT"
local bin = cfg.bin or (home .. "/.local/bin/amarchy")

if cfg.open_key ~= false then
  o.bind(mod .. " + " .. (cfg.open_key or "A"), "Open amarchy", bin .. " open")
end
if cfg.new_key ~= false then
  o.bind(mod .. " + " .. (cfg.new_key or "N"), "New amarchy session", bin .. " new")
end

-- The descriptions are how `amarchy ui` finds these keys for the hints under
-- the session list.
local nav_mod = cfg.nav_mod or "CTRL + ALT"
local function nav(key, default, description, command)
  if key ~= false then
    o.bind(nav_mod .. " + " .. (key or default), description, bin .. " " .. command)
  end
end
nav(cfg.next_key, "J", "Next amarchy session", "next")
nav(cfg.prev_key, "K", "Previous amarchy session", "prev")
nav(cfg.terminal_key, "RETURN", "Toggle amarchy terminal", "terminal")
nav(cfg.nav_new_key, "N", "New amarchy session here", "new")
nav(cfg.add_key, "A", "Add amarchy project", "add")
nav(cfg.close_key, "X", "Close amarchy session", "close --confirm")

-- The zen column on session workspaces; sized for your monitor by
-- `amarchy layout` (runs on install and before every new session).
local layout = home .. "/.local/state/amarchy/layout.lua"
local f = io.open(layout)
if f then
  f:close()
  dofile(layout)
end

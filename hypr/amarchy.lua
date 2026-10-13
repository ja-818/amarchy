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
--   list_key     drop the session list from the Ⓐ in the bar (default "L")
--
-- Moving around inside it:
--   nav_mod      modifier for these keys (default "CTRL + ALT")
--   next_key     the session below in the list (default "J")
--   prev_key     the session above (default "K")
--   terminal_key toggle the session's terminal under Claude (default "RETURN")
--   run_key      run the project in that terminal; again restarts it (default "R")
--   commands_key choose another saved command of the project to run there (default "C")
--   nav_new_key  start a session (default "N")
--   add_key      add a project (default "A")
--   theme_key    pick the theme amarchy wears (default "T")
--   rename_key   name this session yourself (default "E")
--   close_key    close this session, after asking (default "X")
--   menu_key     everything above in one menu, each with its key (default "M")
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
if cfg.list_key ~= false then
  o.bind(mod .. " + " .. (cfg.list_key or "L"), "amarchy sessions", bin .. " show")
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
nav(cfg.run_key, "R", "Run amarchy project", "run")
nav(cfg.commands_key, "C", "Run amarchy command", "run --pick")
nav(cfg.nav_new_key, "N", "New amarchy session here", "new")
nav(cfg.add_key, "A", "Add amarchy project", "add")
nav(cfg.theme_key, "T", "Pick amarchy theme", "theme")
nav(cfg.rename_key, "E", "Rename amarchy session", "rename")
nav(cfg.close_key, "X", "Close amarchy session", "close --confirm")
nav(cfg.menu_key, "M", "amarchy menu", "menu")

-- amarchy in its own theme (`amarchy theme`): repaints the desktop as you enter
-- and leave a session. Exits right away when no theme is set.
o.launch_on_start(bin .. " watch")

-- Session windows snap into place: the terminal toggles in and out under
-- Claude without Hyprland animating the move and then the resize.
o.window("^(amarchy|factory)\\.(claude|term)\\..+$", { no_anim = true })

-- Claude and the session terminal are terminals under amarchy's own classes;
-- say so, so Omarchy's Super+C/V copy and paste in them.
o.window("amarchy\\.(claude|term)\\..*", { tag = "+terminal" })

-- The zen column on session workspaces; sized for your monitor by
-- `amarchy layout` (runs on install and before every new session).
local layout = home .. "/.local/state/amarchy/layout.lua"
local f = io.open(layout)
if f then
  f:close()
  dofile(layout)
end

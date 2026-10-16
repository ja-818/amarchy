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
--   search_key   type to find a session by name, as if you clicked the search: in
--                the list beside Claude, or under the Ⓐ in zen mode (default "S")
--   zen_key      toggle zen mode: Claude alone, without the sessions and the
--                terminal beside it (default "Z")
--   terminal_key move the keyboard between Claude and the terminal; leaves
--                zen mode (default "RETURN")
--   run_key      run the project in that terminal; again restarts it (default "R")
--   commands_key choose another saved command of the project to run there (default "C")
--   nav_new_key  start a session (default "N")
--   project_key  start a new project: one of your GitHub repos, a git URL or an
--                empty one (default "P"; add_key, its old name, still works)
--   theme_key    pick the theme amarchy wears (default "T")
--   rename_key   name this session yourself (default "E")
--   raise_key    raise this session's priority: higher ones come first in the
--                list (default "UP")
--   lower_key    lower it (default "DOWN")
--   close_key    close this session, after asking (default "X")
--   menu_key     everything above in one menu, each with its key (default "M")
--
-- Moving between Claude and the terminal is Omarchy's own Super+arrows.
--
--   bin          path to the amarchy script (default ~/.local/bin/amarchy)
--
-- Any key set to false is left unbound.
--
-- The two modifiers can also be picked in amarchy's menu (Keys, or `amarchy
-- keys`), which writes them to ~/.local/state/amarchy/keys.lua. What's picked
-- there wins over this table; `amarchy keys reset` drops it.

local home = os.getenv("HOME")
local cfg = {}
for k, v in pairs(amarchy or {}) do cfg[k] = v end
local picked_file = home .. "/.local/state/amarchy/keys.lua"
local pf = io.open(picked_file)
if pf then
  pf:close()
  local ok, picked = pcall(dofile, picked_file)
  if ok and type(picked) == "table" then
    for k, v in pairs(picked) do cfg[k] = v end
  end
end
local mod = cfg.mod or "SUPER + ALT"
local bin = cfg.bin or (home .. "/.local/bin/amarchy")

if cfg.open_key ~= false then
  o.bind(mod .. " + " .. (cfg.open_key or "A"), "Open amarchy", bin .. " open")
end
if cfg.new_key ~= false then
  o.bind(mod .. " + " .. (cfg.new_key or "N"), "New amarchy session", bin .. " new")
end

-- The descriptions are how `amarchy ui` and `amarchy menu` find these keys, to
-- show each next to what it does.
local nav_mod = cfg.nav_mod or "CTRL + ALT"
local function nav(key, default, description, command)
  if key ~= false then
    o.bind(nav_mod .. " + " .. (key or default), description, bin .. " " .. command)
  end
end
nav(cfg.next_key, "J", "Next amarchy session", "next")
nav(cfg.prev_key, "K", "Previous amarchy session", "prev")
nav(cfg.search_key, "S", "Search amarchy sessions", "search")
nav(cfg.zen_key, "Z", "Toggle amarchy zen", "zen")
nav(cfg.terminal_key, "RETURN", "Toggle amarchy terminal", "terminal")
nav(cfg.run_key, "R", "Run amarchy project", "run")
nav(cfg.commands_key, "C", "Run amarchy command", "run --pick")
nav(cfg.nav_new_key, "N", "New amarchy session here", "new")
local project_key = cfg.project_key
if project_key == nil then project_key = cfg.add_key end
nav(project_key, "P", "New amarchy project", "add")
nav(cfg.theme_key, "T", "Pick amarchy theme", "theme")
nav(cfg.rename_key, "E", "Rename amarchy session", "rename")
nav(cfg.raise_key, "UP", "Raise amarchy priority", "priority up")
nav(cfg.lower_key, "DOWN", "Lower amarchy priority", "priority down")
nav(cfg.close_key, "X", "Close amarchy session", "close --confirm")
nav(cfg.menu_key, "M", "amarchy menu", "menu")

-- amarchy in its own theme (`amarchy theme`): repaints the desktop as you enter
-- and leave a session. Exits right away when no theme is set.
o.launch_on_start(bin .. " watch")

-- Session windows snap into place: the terminal lands beside
-- Claude without Hyprland animating the move and then the resize.
o.window("^(amarchy|factory)\\.(claude|term)\\..+$", { no_anim = true })

-- A session terminal opens out of sight, floating on amarchy's hidden
-- workspace, and only comes beside Claude once it's in place: it never tiles
-- under Claude first, so nothing on screen moves.
o.window("^amarchy\\.term\\..+$", { float = true, workspace = "special:amarchy silent" })

-- Claude's window opens out of sight too, and amarchy moves it to the session's
-- workspace once it's there, before going to it: you land on the session
-- with Claude already in place, not on an empty workspace that fills in.
o.window("^amarchy\\.claude\\..+$", { workspace = "special:amarchy silent" })

-- So do the list beside Claude and the strip above it: zen mode (and moving
-- between sessions) shows and hides them at once, together with the terminal,
-- instead of Hyprland fading them in after it.
hl.layer_rule({ match = { namespace = "^amarchy-(sessions|header)$" }, no_anim = true, animation = "none" })

-- Claude and the session terminal are terminals under amarchy's own classes;
-- say so, so Omarchy's Super+C/V copy and paste in them.
o.window("amarchy\\.(claude|term)\\..*", { tag = "+terminal" })

-- Claude's column on session workspaces; sized for your monitor by
-- `amarchy layout` (runs on install and before every new session).
local layout = home .. "/.local/state/amarchy/layout.lua"
local f = io.open(layout)
if f then
  f:close()
  dofile(layout)
end

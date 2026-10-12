-- amarchy keybindings and window rules for Omarchy's Hyprland config.
--
-- install.sh loads this from ~/.config/hypr/hyprland.lua. To change the keys,
-- set a table named `amarchy` before the dofile line, e.g.
--
--   amarchy = { mod = "MOD3", open_key = "A", new_key = "N", cockpit_key = false }
--
-- Getting to amarchy, from anywhere:
--   mod          modifier for these keys (default "SUPER + ALT")
--   open_key     go to the last session you were in (default "A")
--   new_key      start a session: pick a project (default "N")
--   cockpit_key  toggle Mission Control + terminal on a session (default "Z");
--                false skips the binding, e.g. to call `amarchy cockpit` from
--                your own zen-mode key instead
--
-- Moving around inside it:
--   nav_mod      modifier for these keys (default "CTRL + ALT")
--   next_key     the session below in Mission Control (default "J")
--   prev_key     the session above (default "K")
--   nav_new_key  start a session (default "N")
--   add_key      add a project (default "A")
--   close_key    close this session, after asking (default "X")
--
-- Moving between Claude and the terminal is Omarchy's own Super+arrows.
--
--   focus_key    give Mission Control the keyboard, on `mod` (off by default)
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
if cfg.cockpit_key ~= false then
  o.bind(mod .. " + " .. (cfg.cockpit_key or "Z"), "amarchy cockpit", bin .. " cockpit")
end
if cfg.focus_key then
  o.bind(mod .. " + " .. cfg.focus_key, "amarchy Mission Control", bin .. " focus")
end

-- The descriptions are how `amarchy ui` finds these keys for Mission Control's hints.
local nav_mod = cfg.nav_mod or "CTRL + ALT"
local function nav(key, default, description, command)
  if key ~= false then
    o.bind(nav_mod .. " + " .. (key or default), description, bin .. " " .. command)
  end
end
nav(cfg.next_key, "J", "Next amarchy session", "next")
nav(cfg.prev_key, "K", "Previous amarchy session", "prev")
nav(cfg.nav_new_key, "N", "New amarchy session here", "new")
nav(cfg.add_key, "A", "Add amarchy project", "add")
nav(cfg.close_key, "X", "Close amarchy session", "close --confirm")

-- Focus in the cockpit uses Omarchy's own active/inactive border. The cockpit
-- windows float flush with the bar and screen edges, so their top border
-- tucks under the bar and the bottom one falls off-screen: borders show only
-- on the sides, with no gap at the top.

-- The zen column for Claude on session workspaces; sized for your monitor by
-- `amarchy layout` (runs on install and before every new session).
local layout = home .. "/.local/state/amarchy/layout.lua"
local f = io.open(layout)
if f then
  f:close()
  dofile(layout)
end

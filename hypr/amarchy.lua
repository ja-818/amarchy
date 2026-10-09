-- amarchy keybindings and window rules for Omarchy's Hyprland config.
--
-- install.sh loads this from ~/.config/hypr/hyprland.lua. To change the keys,
-- set a table named `amarchy` before the dofile line, e.g.
--
--   amarchy = { mod = "MOD3", open_key = "A", new_key = "N", cockpit_key = false }
--
--   mod          modifier for all keys (default "SUPER + ALT")
--   open_key     go to the last session, or cycle to the next (default "A")
--   new_key      start a session: pick a project (default "N")
--   cockpit_key  toggle Mission Control + terminal on a session (default "Z");
--                false skips the binding, e.g. to call `amarchy cockpit` from
--                your own zen-mode key instead
--   focus_key    give Mission Control the keyboard (default "M")
--   bin          path to the amarchy script (default ~/.local/bin/amarchy)

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
if cfg.focus_key ~= false then
  o.bind(mod .. " + " .. (cfg.focus_key or "M"), "amarchy Mission Control", bin .. " focus")
end

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

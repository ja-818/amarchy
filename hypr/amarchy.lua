-- amarchy keybindings and window rules for Omarchy's Hyprland config.
--
-- install.sh loads this from ~/.config/hypr/hyprland.lua. To change the keys,
-- set a table named `amarchy` before the dofile line, e.g.
--
--   amarchy = { mod = "MOD3", new_key = "N", cockpit_key = false }
--
--   mod          modifier for both keys (default "SUPER + ALT")
--   new_key      start a session: pick a repo, name it (default "N")
--   cockpit_key  toggle Mission Control + terminal on a session (default "M");
--                false skips the binding, e.g. to call `amarchy cockpit` from
--                your own zen-mode key instead
--   bin          path to the amarchy script (default ~/.local/bin/amarchy)

local cfg = amarchy or {}
local home = os.getenv("HOME")
local mod = cfg.mod or "SUPER + ALT"
local bin = cfg.bin or (home .. "/.local/bin/amarchy")

if cfg.new_key ~= false then
  o.bind(mod .. " + " .. (cfg.new_key or "N"), "New amarchy session", bin .. " new")
end
if cfg.cockpit_key ~= false then
  o.bind(mod .. " + " .. (cfg.cockpit_key or "M"), "amarchy cockpit", bin .. " cockpit")
end

o.window("^amarchy\\.picker$", { float = true, center = true, size = { 640, 420 } })

-- The zen column for Claude on session workspaces; sized for your monitor by
-- `amarchy layout` (runs on install and before every new session).
local layout = home .. "/.local/state/amarchy/layout.lua"
local f = io.open(layout)
if f then
  f:close()
  dofile(layout)
end

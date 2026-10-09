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
--   cockpit_key  toggle Mission Control + terminal on a session (default "M");
--                false skips the binding, e.g. to call `amarchy cockpit` from
--                your own zen-mode key instead
--   bin          path to the amarchy script (default ~/.local/bin/amarchy)
--   focus_width     side bar width on the focused cockpit window (default 3)
--   focus_strength  how much accent is in it, 0-1 (default 0.55; 1 = full accent)

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
  o.bind(mod .. " + " .. (cfg.cockpit_key or "M"), "amarchy cockpit", bin .. " cockpit")
end

-- Focus in the cockpit: the focused window gets a soft accent bar on its left
-- and right edges only. Hyprland borders can't skip sides, so this is a
-- left-to-right gradient that fades into the background before the corners
-- (top and bottom disappear against the dark desktop). Unfocused windows get
-- background-colored borders. Colors follow the current Omarchy theme; only
-- applies while other windows share the workspace, so Claude alone in the zen
-- column stays borderless.
local function theme_color(name, fallback)
  local f = io.open(home .. "/.local/state/omarchy/current/theme/colors.toml")
  if not f then return fallback end
  local text = f:read("*a")
  f:close()
  return text:match("\n%s*" .. name .. '%s*=%s*"#(%x%x%x%x%x%x)"') or fallback
end

local function mix(a, b, t)
  local out = ""
  for i = 1, 5, 2 do
    local x, y = tonumber(a:sub(i, i + 1), 16), tonumber(b:sub(i, i + 1), 16)
    out = out .. string.format("%02x", math.floor(x + (y - x) * t + 0.5))
  end
  return out
end

local background = theme_color("background", "121212")
local side = "rgb(" .. mix(background, theme_color("accent", "e68e0d"), cfg.focus_strength or 0.55) .. ")"
local fade = "rgb(" .. background .. ")"
o.window({ class = "^amarchy\\..*", workspace = "w[v2-99]" }, {
  border_size = cfg.focus_width or 3,
  border_color = table.concat({ side, fade, fade, fade, fade, fade, fade, fade, fade, side }, " ")
    .. " 0deg " .. fade,
})

-- The zen column for Claude on session workspaces; sized for your monitor by
-- `amarchy layout` (runs on install and before every new session).
local layout = home .. "/.local/state/amarchy/layout.lua"
local f = io.open(layout)
if f then
  f:close()
  dofile(layout)
end

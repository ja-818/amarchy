-- amarchy on Omarchy's Hyprland: stop babysitting your agents, manage them.
--
-- install.sh loads this from ~/.config/hypr/hyprland.lua (the line that ends
-- in "-- amarchy"); its --uninstall takes that line away.
--
--   Super + Alt + A   amarchy at the front: the desktop app's window, or the
--                     app started (`amarchy open`). Without the desktop app,
--                     your chats in a browser window.
--
--   The desktop app's window (class amarchy) is see-through as Omarchy's
--   terminals are, in each of Omarchy's window modes (Appearance > Windows >
--   Window Opacity): Transparent, Omarchy's standard transparency; Opaque,
--   solid; Glassy, as glassy as every window. Wearing the desktop's look
--   live, it draws no wallpaper of its own: the desktop's shows through.
--
-- Super + A and Super + Shift + A are Omarchy's own (select all, the AI web
-- app). For another key, set a table named `amarchy` before the line:
--
--   amarchy = { open_key = "SUPER + CTRL + ALT + A" }   -- false: no key
--   amarchy = { transparent = false }                    -- a solid window

if type(o) ~= "table" or type(o.bind) ~= "function" then
  return -- not Omarchy's Lua config: nothing to bind with
end

local cfg = type(amarchy) == "table" and amarchy or {}
local bin = cfg.bin or ((os.getenv("HOME") or "") .. "/.local/bin/amarchy")
local quoted = "'" .. bin:gsub("'", "'\\''") .. "'"

if cfg.open_key ~= false then
  o.bind(cfg.open_key or "SUPER + ALT + A", "Amarchy", quoted .. " open")
end

-- The window mode Omarchy is in: its Opaque and Glassy are toggle files, and
-- switching mode reloads Hyprland, which reads this file again. This line
-- comes after Omarchy's toggles (the end of hyprland.lua), so a rule of its
-- own would win over theirs: in Opaque it takes none (the window stays
-- solid), in Glassy none either (Glassy's own rule fades every window), and
-- only in Transparent, Omarchy's default, it opts in as the terminals do.
local function toggle_on(name)
  local ok, paths = pcall(require, "default.hypr.paths")
  local xdg = os.getenv("XDG_STATE_HOME")
  local state = ok and type(paths) == "table" and paths.state_home
    or (xdg ~= nil and xdg ~= "" and xdg) or ((os.getenv("HOME") or "") .. "/.local/state")
  local f = io.open(state .. "/omarchy/toggles/hypr/" .. name .. ".lua", "r")
  if f then
    f:close()
    return true
  end
  return false
end

if cfg.transparent ~= false and type(o.transparent_window) == "function"
  and not toggle_on("window-opaque") and not toggle_on("window-glassy") then
  o.transparent_window("amarchy")
end

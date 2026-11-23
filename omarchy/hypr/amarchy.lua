-- amarchy on Omarchy's Hyprland: stop babysitting your agents, manage them.
--
-- install.sh loads this from ~/.config/hypr/hyprland.lua (the line that ends
-- in "-- amarchy", after Omarchy's own config); its --uninstall takes that
-- line away.
--
-- One key brings amarchy to the front (`amarchy open`: the desktop app's
-- window, or the app started; without the desktop app, your chats in a
-- browser window): Super + Alt + A, which Omarchy leaves free (Super + A and
-- Super + Shift + A are its own).
--
-- The key is a setting, `amarchy key`, kept in ~/.config/amarchy/key (a
-- chord as Omarchy writes them, "SUPER + CTRL + M", or "off"); it changes
-- at once (Hyprland reloads). A key you pick that Omarchy uses gives way to
-- amarchy while it's picked; another pick, or `amarchy key default`, gives it
-- back (a reload binds everything afresh).
--
-- The desktop app's window (class amarchy) is faded as Omarchy's terminals
-- are, in each of Omarchy's window modes (Appearance > Windows > Window
-- Opacity): Transparent, Omarchy's standard transparency; Opaque, solid;
-- Glassy, as glassy as every window. The window itself is see-through:
-- wearing the desktop's look live, it draws no wallpaper of its own, and the
-- desktop's shows through its panes.

if type(o) ~= "table" or type(o.bind) ~= "function" then
  return -- not Omarchy's Lua config: nothing to bind with
end

local home = os.getenv("HOME") or ""
local config = os.getenv("XDG_CONFIG_HOME")
if config == nil or config == "" then
  config = home .. "/.config"
end

local key, picked = "SUPER + ALT + A", false
local setting = io.open(config .. "/amarchy/key")
if setting then
  local said = (setting:read("*l") or ""):gsub("^%s+", ""):gsub("%s+$", "")
  setting:close()
  -- Only a chord amarchy key would write; anything else keeps the default.
  if said == "off" or said:match("^[%w_]+[%w_ +:]*$") then
    key, picked = said, true
  end
end

if key ~= "off" then
  local bin = home .. "/.local/bin/amarchy"
  local quoted = "'" .. bin:gsub("'", "'\\''") .. "'"
  -- A key you picked: whatever was bound there first gives way.
  if picked and type(hl) == "table" and type(hl.unbind) == "function" then
    pcall(hl.unbind, key)
  end
  o.bind(key, "Amarchy", quoted .. " open")
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
    or (xdg ~= nil and xdg ~= "" and xdg) or (home .. "/.local/state")
  local f = io.open(state .. "/omarchy/toggles/hypr/" .. name .. ".lua", "r")
  if f then
    f:close()
    return true
  end
  return false
end

if type(o.transparent_window) == "function" and not toggle_on("window-opaque") and not toggle_on("window-glassy") then
  o.transparent_window("amarchy")
end

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

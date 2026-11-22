-- amarchy on Omarchy's Hyprland: stop babysitting your agents, manage them.
--
-- install.sh loads this from ~/.config/hypr/hyprland.lua (the line that ends
-- in "-- amarchy"); its --uninstall takes that line away.
--
--   Super + Alt + A   amarchy at the front: the desktop app's window, or the
--                     app started (`amarchy open`). Without the desktop app,
--                     your chats in a browser window.
--
-- Super + A and Super + Shift + A are Omarchy's own (select all, the AI web
-- app). For another key, set a table named `amarchy` before the line:
--
--   amarchy = { open_key = "SUPER + CTRL + ALT + A" }   -- false: no key

if type(o) ~= "table" or type(o.bind) ~= "function" then
  return -- not Omarchy's Lua config: nothing to bind with
end

local cfg = type(amarchy) == "table" and amarchy or {}
local bin = cfg.bin or ((os.getenv("HOME") or "") .. "/.local/bin/amarchy")
local quoted = "'" .. bin:gsub("'", "'\\''") .. "'"

if cfg.open_key ~= false then
  o.bind(cfg.open_key or "SUPER + ALT + A", "Amarchy", quoted .. " open")
end

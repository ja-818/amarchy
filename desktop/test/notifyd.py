# A notification daemon for the desktop app's tests: it owns
# org.freedesktop.Notifications on the session bus it's given (the test's
# own), prints each notification it's asked to show as a JSON line
# ({"id", "app", "replaces", "icon", "summary", "body", "actions", "hints"}),
# and takes commands on stdin: "invoke <id> <action>" (a button pressed, or
# "default": the notification clicked), "close <id>".
#
#   DBUS_SESSION_BUS_ADDRESS=... python3 desktop/test/notifyd.py

import json
import sys

import gi

gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib  # noqa: E402

XML = """
<node>
  <interface name="org.freedesktop.Notifications">
    <method name="GetCapabilities"><arg type="as" direction="out"/></method>
    <method name="Notify">
      <arg type="s" direction="in"/><arg type="u" direction="in"/><arg type="s" direction="in"/>
      <arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="as" direction="in"/>
      <arg type="a{sv}" direction="in"/><arg type="i" direction="in"/><arg type="u" direction="out"/>
    </method>
    <method name="CloseNotification"><arg type="u" direction="in"/></method>
    <method name="GetServerInformation">
      <arg type="s" direction="out"/><arg type="s" direction="out"/><arg type="s" direction="out"/><arg type="s" direction="out"/>
    </method>
    <signal name="NotificationClosed"><arg type="u"/><arg type="u"/></signal>
    <signal name="ActionInvoked"><arg type="u"/><arg type="s"/></signal>
  </interface>
</node>
"""
PATH, IFACE = "/org/freedesktop/Notifications", "org.freedesktop.Notifications"
state = {"next": 0, "conn": None}


def plain(v):
    try:
        return v.unpack() if hasattr(v, "unpack") else v
    except Exception:  # noqa: BLE001 (a hint it can't print)
        return str(v)


def call(conn, sender, path, iface, method, params, inv):
    if method == "GetCapabilities":
        inv.return_value(GLib.Variant("(as)", (["actions", "body", "icon-static", "persistence"],)))
    elif method == "GetServerInformation":
        inv.return_value(GLib.Variant("(ssss)", ("notifyd", "amarchy tests", "1", "1.2")))
    elif method == "Notify":
        app, replaces, icon, summary, body, actions, hints, _timeout = params.unpack()
        nid = replaces or state["next"] + 1
        state["next"] = max(state["next"], nid)
        print(json.dumps({"id": nid, "app": app, "replaces": replaces, "icon": icon, "summary": summary, "body": body,
                          "actions": list(actions), "hints": {k: plain(v) for k, v in hints.items()}}), flush=True)
        inv.return_value(GLib.Variant("(u)", (nid,)))
    elif method == "CloseNotification":
        (nid,) = params.unpack()
        conn.emit_signal(None, PATH, IFACE, "NotificationClosed", GLib.Variant("(uu)", (nid, 3)))
        inv.return_value(None)


def command(source, _cond):
    line = sys.stdin.readline()
    if not line:
        loop.quit()
        return False
    parts = line.split()
    conn = state["conn"]
    if len(parts) == 3 and parts[0] == "invoke":
        nid = int(parts[1])
        conn.emit_signal(None, PATH, IFACE, "ActionInvoked", GLib.Variant("(us)", (nid, parts[2])))
        conn.emit_signal(None, PATH, IFACE, "NotificationClosed", GLib.Variant("(uu)", (nid, 2)))
    elif len(parts) == 2 and parts[0] == "close":
        conn.emit_signal(None, PATH, IFACE, "NotificationClosed", GLib.Variant("(uu)", (int(parts[1]), 2)))
    return True


def acquired(conn, _name):
    state["conn"] = conn
    print(json.dumps({"ready": True}), flush=True)


def bus(conn, _name):
    info = Gio.DBusNodeInfo.new_for_xml(XML).interfaces[0]
    conn.register_object(PATH, info, call, None, None)


loop = GLib.MainLoop()
GLib.io_add_watch(GLib.IOChannel.unix_new(sys.stdin.fileno()), GLib.IO_IN | GLib.IO_HUP, command)
Gio.bus_own_name(Gio.BusType.SESSION, IFACE, Gio.BusNameOwnerFlags.NONE, bus, acquired, lambda *a: loop.quit())
loop.run()

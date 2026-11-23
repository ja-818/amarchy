# amarchy's own Tailscale node (app/libs/tailnet.aar, gomobile) is found by
# name at run time (OwnNode.kt): keep its class, its methods and gomobile's
# runtime, which its native code calls back into.
-keep class mobile.** { *; }
-keep class go.** { *; }
-dontwarn mobile.**
-dontwarn go.**

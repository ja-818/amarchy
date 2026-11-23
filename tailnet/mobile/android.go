//go:build android

package mobile

// On Android, an app's own code is denied what Tailscale's netmon asks the
// system for (its network interfaces: NETLINK_ROUTE and /proc/net, Android
// 11 and later), and has no /etc/resolv.conf: without these the node can't
// start, and can't find Tailscale's coordination server. Tailscale's
// androidbin feature stands in for both (an interface found by routing a
// UDP socket, which sends nothing; DNS from Android's own resolver; the CA
// roots from Android's store). Tailscale's own Android app lists its
// interfaces from Java instead; one is enough for a phone reaching its
// amarchy machines.
import _ "tailscale.com/feature/androidbin"

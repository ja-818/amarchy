//go:build tools

package mobile

// gomobile bind (.github/workflows/tailnet.yml, "Phone builds") needs its
// bind package in this module.
import _ "golang.org/x/mobile/bind"

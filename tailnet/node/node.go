// Package node is amarchy's own Tailscale node, for a computer without the
// system's Tailscale (docs/plan-omarchy-and-machines.md, "Tailscale inside
// the apps"): a tsnet node of the computer's, signed in as its user, with
// Tailscale's own LocalAPI on a socket (so Tailscale's CLI and everything
// amarchy asks the system's Tailscale works the same against it), what
// `tailscale serve` sets done on the tailnet, and a proxy to reach the
// tailnet from this computer. The phone apps use the node and its proxy.
package node

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"tailscale.com/client/local"
	"tailscale.com/ipn"
	"tailscale.com/ipn/ipnstate"
	"tailscale.com/tsnet"
)

// Config says where the node keeps its state and what it's called.
type Config struct {
	Dir        string // its state (0700): the node's keys, its sign-in
	Hostname   string // its name on the tailnet (the computer's)
	ControlURL string // Tailscale's coordination server; empty: Tailscale's own
	Logf       func(format string, args ...any)
}

// Node is amarchy's node.
type Node struct {
	cfg Config
	srv *tsnet.Server
	lc  *local.Client

	mu     sync.Mutex
	closed bool
	serve  *server
}

// Start brings the node up (it doesn't wait for a sign-in: Status says when
// it needs one, LoginURL gives its address).
func Start(cfg Config) (*Node, error) {
	if cfg.Dir == "" || cfg.Hostname == "" {
		return nil, errors.New("a node needs its folder and its name")
	}
	if err := os.MkdirAll(cfg.Dir, 0o700); err != nil {
		return nil, err
	}
	_ = os.Chmod(cfg.Dir, 0o700)
	logf := cfg.Logf
	if logf == nil {
		logf = func(string, ...any) {}
	}
	srv := &tsnet.Server{
		Dir:        filepath.Join(cfg.Dir, "tsnet"),
		Hostname:   cfg.Hostname,
		ControlURL: cfg.ControlURL,
		Logf:       func(string, ...any) {}, // Tailscale's own chatter: not ours to keep
		UserLogf:   logf,
	}
	if err := srv.Start(); err != nil {
		return nil, fmt.Errorf("the node didn't start: %w", err)
	}
	lc, err := srv.LocalClient()
	if err != nil {
		srv.Close()
		return nil, err
	}
	n := &Node{cfg: cfg, srv: srv, lc: lc}
	n.serve = newServer(n)
	return n, nil
}

// Close takes the node off the tailnet (its sign-in is kept).
func (n *Node) Close() error {
	n.mu.Lock()
	n.closed = true
	n.mu.Unlock()
	n.serve.closeAll()
	return n.srv.Close()
}

// LocalClient is Tailscale's LocalAPI client for the node.
func (n *Node) LocalClient() *local.Client { return n.lc }

// TSNet is the tsnet server underneath (dialing the tailnet, listening on it).
func (n *Node) TSNet() *tsnet.Server { return n.srv }

// Status is the node's state, as `tailscale status --json` says it.
func (n *Node) Status(ctx context.Context) (*ipnstate.Status, error) {
	return n.lc.Status(ctx)
}

// LoginURL starts a sign-in when the node needs one and gives its address
// (Tailscale's login page, to open in a browser); "" when it's signed in.
func (n *Node) LoginURL(ctx context.Context) (string, error) {
	return LoginURL(ctx, n.lc)
}

// LoginURL for the node behind a LocalAPI client (the CLI's, over the socket).
func LoginURL(ctx context.Context, lc *local.Client) (string, error) {
	st, err := lc.Status(ctx)
	if err != nil {
		return "", err
	}
	if st.BackendState == ipn.Running.String() {
		return "", nil
	}
	if st.AuthURL != "" {
		return st.AuthURL, nil
	}
	if err := lc.StartLoginInteractive(ctx); err != nil {
		return "", err
	}
	for {
		st, err := lc.Status(ctx)
		if err != nil {
			return "", err
		}
		if st.AuthURL != "" {
			return st.AuthURL, nil
		}
		if st.BackendState == ipn.Running.String() {
			return "", nil
		}
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(250 * time.Millisecond):
		}
	}
}

// Words says where a node stands, in a line for a person.
func Words(st *ipnstate.Status) string {
	switch st.BackendState {
	case ipn.Running.String():
		who := ""
		if st.Self != nil {
			if u, ok := st.User[st.Self.UserID]; ok {
				who = u.LoginName
			}
		}
		name := ""
		if st.Self != nil {
			name = strings.TrimSuffix(st.Self.DNSName, ".")
		}
		tailnet := ""
		if st.CurrentTailnet != nil {
			tailnet = st.CurrentTailnet.Name
		}
		return fmt.Sprintf("on your tailnet (%s) as %s, signed in as %s", tailnet, name, who)
	case ipn.NeedsLogin.String():
		if st.AuthURL != "" {
			return "waits for you to sign in to Tailscale: " + st.AuthURL
		}
		return "waits for you to sign in to Tailscale (amarchy-tailnet login)"
	case ipn.NeedsMachineAuth.String():
		return "signed in; waits for your tailnet's admin to approve this computer"
	case ipn.Starting.String(), ipn.NoState.String():
		return "starting"
	case ipn.Stopped.String():
		return "stopped"
	}
	return st.BackendState
}

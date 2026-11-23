// Package mobile is amarchy's own Tailscale node for the phone apps
// (docs/plan-omarchy-and-machines.md, "Tailscale inside the apps" and "The
// phone apps and the push relay"), for a phone without the Tailscale app: a
// node of the phone's own, signed in as its user, and its proxy for the
// app's web view and the app's own requests (node.Node and its proxy, as the
// desktop's; no serving: a phone runs no chats).
//
// Built with gomobile (`gomobile bind`), so its API is what gomobile can
// carry: functions of strings, numbers and errors. One node per app, kept
// here: Start, then State (JSON) until it's running or needs a sign-in
// (LoginURL), ProxyURL for the web view, Stop when the app no longer needs it.
package mobile

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/ja-818/amarchy/tailnet/node"
	"tailscale.com/ipn"
)

var (
	mu  sync.Mutex
	cur *running
)

type running struct {
	node   *node.Node
	proxy  *node.Proxy
	cancel context.CancelFunc
}

// Start brings the phone's node up, its state in dir (the app's own, kept
// between launches: its keys and its sign-in), named hostname on the
// tailnet. It doesn't wait for a sign-in: State says when one is needed.
// Started already: nothing more.
func Start(dir, hostname string) error {
	return StartWith(dir, hostname, "")
}

// StartWith is Start with another coordination server than Tailscale's own
// (controlURL; "" for Tailscale's), for Headscale and for the tests.
func StartWith(dir, hostname, controlURL string) error {
	mu.Lock()
	defer mu.Unlock()
	if cur != nil {
		return nil
	}
	if dir == "" || strings.TrimSpace(hostname) == "" {
		return errors.New("the node needs a folder and a name")
	}
	n, err := node.Start(node.Config{Dir: dir, Hostname: hostname, ControlURL: controlURL})
	if err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(context.Background())
	p, err := n.StartProxy(ctx, "127.0.0.1:0")
	if err != nil {
		cancel()
		n.Close()
		return err
	}
	cur = &running{node: n, proxy: p, cancel: cancel}
	return nil
}

// Stop takes the node off the tailnet and closes its proxy (its sign-in is
// kept for the next Start).
func Stop() {
	mu.Lock()
	r := cur
	cur = nil
	mu.Unlock()
	if r != nil {
		r.cancel()
		r.node.Close()
	}
}

// ProxyURL is the node's proxy, http://amarchy:<secret>@127.0.0.1:<port>
// (for tailnet names and addresses only), or "" when the node isn't up.
func ProxyURL() string {
	mu.Lock()
	defer mu.Unlock()
	if cur == nil {
		return ""
	}
	return cur.proxy.URL
}

// Peer is another node on the tailnet, as State lists them.
type peer struct {
	Name   string `json:"name"`
	DNS    string `json:"dns"`
	Online bool   `json:"online"`
}

type state struct {
	State    string `json:"state"`
	Words    string `json:"words"`
	LoginURL string `json:"login_url"`
	Self     string `json:"self"`
	Peers    []peer `json:"peers"`
}

// State says where the node stands, as JSON: {"state": "Off" | Tailscale's
// own (NoState, Starting, NeedsLogin, NeedsMachineAuth, Running, Stopped),
// "words" (a line for a person), "login_url" (while it waits for a
// sign-in), "self" (its name on the tailnet), "peers": [{"name", "dns",
// "online"}] (the tailnet's other nodes, by name: the machines to look for
// amarchy on)}.
func State() string {
	mu.Lock()
	r := cur
	mu.Unlock()
	out := state{State: "Off", Words: "off", Peers: []peer{}}
	if r != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		st, err := r.node.Status(ctx)
		if err != nil {
			out.State, out.Words = ipn.NoState.String(), "starting"
		} else {
			out.State, out.Words, out.LoginURL = st.BackendState, node.Words(st), st.AuthURL
			if st.Self != nil {
				out.Self = strings.TrimSuffix(st.Self.DNSName, ".")
			}
			for _, p := range st.Peer {
				out.Peers = append(out.Peers, peer{Name: p.HostName, DNS: strings.TrimSuffix(p.DNSName, "."), Online: p.Online})
			}
			sort.Slice(out.Peers, func(i, j int) bool { return out.Peers[i].DNS < out.Peers[j].DNS })
		}
	}
	b, _ := json.Marshal(out)
	return string(b)
}

// LoginURL starts a sign-in when the node needs one and gives Tailscale's
// login page to open (the app opens it in the system's browser sheet); ""
// when it's signed in already.
func LoginURL() (string, error) {
	mu.Lock()
	r := cur
	mu.Unlock()
	if r == nil {
		return "", errors.New("the node isn't started")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	return r.node.LoginURL(ctx)
}

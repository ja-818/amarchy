package node

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"tailscale.com/ipn"
)

// What `tailscale serve` sets (the node's serve config, in its LocalAPI),
// done on the tailnet: tsnet keeps the config but serves only what its
// program listens for, so the node listens for it. HTTPS (with the
// tailnet's certificates) and HTTP ports, their web handlers (a proxy to a
// local address, a text, a folder), and raw TCP forwards; each proxied
// request carries who's asking (Tailscale-User-Login, -Name, -Profile-Pic)
// as tailscaled's does, and never one the caller made up.

type server struct {
	n     *Node
	mu    sync.Mutex
	conf  *ipn.ServeConfig
	ports map[uint16]*port
}

type port struct {
	kind string // "https", "http", "tcp:<target>"
	ln   net.Listener
	srv  *http.Server
}

func newServer(n *Node) *server {
	return &server{n: n, ports: map[uint16]*port{}}
}

// Serve does what the serve config says, and follows it as it changes
// (amarchy's app, a chat's preview), until ctx ends.
func (n *Node) Serve(ctx context.Context) {
	t := time.NewTicker(time.Second)
	defer t.Stop()
	for {
		n.serve.sync(ctx)
		select {
		case <-ctx.Done():
			n.serve.closeAll()
			return
		case <-t.C:
		}
	}
}

// ServeNow applies the serve config at once (a test, or after a change).
func (n *Node) ServeNow(ctx context.Context) { n.serve.sync(ctx) }

// Serving says which ports it listens on now, and how.
func (n *Node) Serving() map[uint16]string {
	n.serve.mu.Lock()
	defer n.serve.mu.Unlock()
	out := map[uint16]string{}
	for p, l := range n.serve.ports {
		out[p] = l.kind
	}
	return out
}

func (s *server) sync(ctx context.Context) {
	sc, err := s.n.lc.GetServeConfig(ctx)
	if err != nil {
		return
	}
	if sc == nil {
		sc = new(ipn.ServeConfig)
	}
	want := map[uint16]string{}
	add := func(c *ipn.ServeConfig) {
		for p, h := range c.TCP {
			switch {
			case h == nil:
			case h.HTTPS:
				want[p] = "https"
			case h.HTTP:
				want[p] = "http"
			case h.TCPForward != "":
				want[p] = "tcp:" + h.TCPForward
			}
		}
	}
	add(sc)
	for _, fg := range sc.Foreground { // `tailscale serve` without --bg, while it runs
		if fg != nil {
			add(fg)
		}
	}
	s.mu.Lock()
	s.conf = sc
	for p, l := range s.ports {
		if want[p] != l.kind {
			l.close()
			delete(s.ports, p)
		}
	}
	for p, kind := range want {
		if _, ok := s.ports[p]; ok {
			continue
		}
		l, err := s.open(p, kind)
		if err != nil {
			s.n.cfg.Logf("serve: port %d (%s): %v", p, kind, err)
			continue
		}
		s.ports[p] = l
		s.n.cfg.Logf("serve: port %d (%s)", p, kind)
	}
	s.mu.Unlock()
}

func (s *server) closeAll() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for p, l := range s.ports {
		l.close()
		delete(s.ports, p)
	}
}

func (l *port) close() {
	if l.srv != nil {
		l.srv.Close()
	}
	l.ln.Close()
}

func (s *server) open(p uint16, kind string) (*port, error) {
	addr := ":" + strconv.Itoa(int(p))
	var ln net.Listener
	var err error
	if kind == "https" {
		ln, err = s.n.srv.ListenTLS("tcp", addr)
	} else {
		ln, err = s.n.srv.Listen("tcp", addr)
	}
	if err != nil {
		return nil, err
	}
	l := &port{kind: kind, ln: ln}
	if target, ok := strings.CutPrefix(kind, "tcp:"); ok {
		go forward(ln, target)
		return l, nil
	}
	l.srv = &http.Server{
		Handler:           http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { s.web(w, r, p) }),
		ReadHeaderTimeout: 30 * time.Second,
		ErrorLog:          nil,
	}
	go l.srv.Serve(ln)
	return l, nil
}

// forward: a raw TCP port, to its target.
func forward(ln net.Listener, target string) {
	for {
		c, err := ln.Accept()
		if err != nil {
			return
		}
		go func() {
			defer c.Close()
			if tc, ok := c.(*tls.Conn); ok {
				_ = tc.Handshake()
			}
			t, err := net.DialTimeout("tcp", target, 10*time.Second)
			if err != nil {
				return
			}
			defer t.Close()
			go io.Copy(t, c)
			io.Copy(c, t)
		}()
	}
}

// web: a request on a served port, to its handler (the longest mount point
// that holds its path).
func (s *server) web(w http.ResponseWriter, r *http.Request, p uint16) {
	s.mu.Lock()
	sc := s.conf
	s.mu.Unlock()
	cfg := webConfig(sc, r.Host, p, s.selfName())
	if cfg == nil {
		http.Error(w, "nothing is served here", http.StatusNotFound)
		return
	}
	mounts := make([]string, 0, len(cfg.Handlers))
	for m := range cfg.Handlers {
		mounts = append(mounts, m)
	}
	sort.Slice(mounts, func(i, j int) bool { return len(mounts[i]) > len(mounts[j]) })
	for _, m := range mounts {
		if !(r.URL.Path == strings.TrimSuffix(m, "/") || strings.HasPrefix(r.URL.Path, strings.TrimSuffix(m, "/")+"/") || m == "/") {
			continue
		}
		h := cfg.Handlers[m]
		switch {
		case h.Proxy != "":
			s.proxyTo(w, r, h.Proxy, m)
		case h.Text != "":
			io.WriteString(w, h.Text)
		case h.Path != "":
			http.StripPrefix(strings.TrimSuffix(m, "/"), http.FileServer(http.Dir(h.Path))).ServeHTTP(w, r)
		default:
			http.Error(w, "nothing is served here", http.StatusNotFound)
		}
		return
	}
	http.Error(w, "nothing is served here", http.StatusNotFound)
}

func (s *server) selfName() string {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	st, err := s.n.lc.StatusWithoutPeers(ctx)
	if err != nil || st.Self == nil {
		return ""
	}
	return strings.TrimSuffix(st.Self.DNSName, ".")
}

// webConfig: the web handlers for the host a request asked for on port p
// (its name on the tailnet, as `tailscale serve` keys them).
func webConfig(sc *ipn.ServeConfig, host string, p uint16, self string) *ipn.WebServerConfig {
	if sc == nil {
		return nil
	}
	h := host
	if hh, _, err := net.SplitHostPort(host); err == nil {
		h = hh
	}
	keys := []string{net.JoinHostPort(h, strconv.Itoa(int(p)))}
	if self != "" {
		keys = append(keys, net.JoinHostPort(self, strconv.Itoa(int(p))))
	}
	look := func(c *ipn.ServeConfig) *ipn.WebServerConfig {
		for _, k := range keys {
			if w, ok := c.Web[ipn.HostPort(k)]; ok && w != nil {
				return w
			}
		}
		return nil
	}
	if w := look(sc); w != nil {
		return w
	}
	for _, fg := range sc.Foreground {
		if fg != nil {
			if w := look(fg); w != nil {
				return w
			}
		}
	}
	return nil
}

// proxyTo: the request, to a local address (as `tailscale serve` takes
// one: "http://127.0.0.1:7397", "localhost:3000", "3000"), with who's asking.
func (s *server) proxyTo(w http.ResponseWriter, r *http.Request, target, mount string) {
	u, err := proxyURL(target)
	if err != nil {
		http.Error(w, "bad proxy target", http.StatusBadGateway)
		return
	}
	who, _ := s.n.lc.WhoIs(r.Context(), r.RemoteAddr)
	rp := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(u)
			if mount != "/" && strings.HasPrefix(pr.In.URL.Path, strings.TrimSuffix(mount, "/")) && !strings.HasSuffix(u.Path, "/") {
				pr.Out.URL.Path = u.Path + strings.TrimPrefix(pr.In.URL.Path, strings.TrimSuffix(mount, "/"))
			}
			pr.Out.Host = pr.In.Host
			pr.SetXForwarded()
			pr.Out.Header.Set("X-Forwarded-Proto", map[bool]string{true: "https", false: "http"}[pr.In.TLS != nil])
			// Who's asking: Tailscale's word, never the caller's.
			for k := range pr.Out.Header {
				if strings.HasPrefix(strings.ToLower(k), "tailscale-") {
					pr.Out.Header.Del(k)
				}
			}
			if who != nil && who.UserProfile != nil && who.Node != nil && !who.Node.IsTagged() {
				pr.Out.Header.Set("Tailscale-User-Login", headerValue(who.UserProfile.LoginName))
				pr.Out.Header.Set("Tailscale-User-Name", headerValue(who.UserProfile.DisplayName))
				pr.Out.Header.Set("Tailscale-User-Profile-Pic", headerValue(who.UserProfile.ProfilePicURL))
			}
		},
		FlushInterval: -1, // a stream (SSE) as it comes
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			http.Error(w, "nothing answers at "+target, http.StatusBadGateway)
		},
	}
	rp.ServeHTTP(w, r)
}

func proxyURL(target string) (*url.URL, error) {
	t := strings.TrimSpace(target)
	if _, err := strconv.Atoi(t); err == nil {
		t = "http://127.0.0.1:" + t
	} else if !strings.Contains(t, "://") {
		t = "http://" + t
	}
	u, err := url.Parse(t)
	if err != nil || u.Host == "" {
		return nil, fmt.Errorf("bad target %q", target)
	}
	return u, nil
}

// headerValue as tailscaled sends it: as it is when it's plain, else
// MIME-encoded (a name with accents).
func headerValue(v string) string {
	plain := utf8.ValidString(v)
	for _, c := range v {
		if c < 0x20 || c > 0x7e {
			plain = false
			break
		}
	}
	if plain {
		return v
	}
	return mime.QEncoding.Encode("utf-8", v)
}

package node

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"time"
)

// The node's proxy: how this computer reaches the tailnet without the
// system's Tailscale (amarchy's app server calling its peers, the desktop
// app's window, a phone app's web view). HTTP CONNECT, and plain HTTP to
// a tailnet address, on 127.0.0.1, behind a credential of its own; for the
// tailnet only (its names, *.ts.net, and its addresses), never anywhere else.

var (
	cgnat     = netip.MustParsePrefix("100.64.0.0/10")
	tailnetV6 = netip.MustParsePrefix("fd7a:115c:a1e0::/48")
)

// OnTailnet says whether a host (a name or an address) is the tailnet's.
func OnTailnet(host string) bool {
	host = strings.TrimSuffix(strings.ToLower(strings.Trim(host, "[]")), ".")
	if ip, err := netip.ParseAddr(host); err == nil {
		return cgnat.Contains(ip) || tailnetV6.Contains(ip)
	}
	return strings.HasSuffix(host, ".ts.net")
}

// Proxy is the node's proxy, once started.
type Proxy struct {
	URL  string // http://amarchy:<secret>@127.0.0.1:<port>
	ln   net.Listener
	srv  *http.Server
	user string
	pass string
}

// StartProxy listens on 127.0.0.1 (port 0: any free one) until ctx ends.
func (n *Node) StartProxy(ctx context.Context, addr string) (*Proxy, error) {
	var secret [16]byte
	if _, err := rand.Read(secret[:]); err != nil {
		return nil, err
	}
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, err
	}
	p := &Proxy{ln: ln, user: "amarchy", pass: hex.EncodeToString(secret[:])}
	p.URL = fmt.Sprintf("http://%s:%s@%s", p.user, p.pass, ln.Addr().String())
	p.srv = &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { n.proxy(p, w, r) }),
		ReadHeaderTimeout: 30 * time.Second}
	go p.srv.Serve(ln)
	go func() {
		<-ctx.Done()
		p.srv.Close()
	}()
	return p, nil
}

func (p *Proxy) authorized(r *http.Request) bool {
	got := r.Header.Get("Proxy-Authorization")
	want := "Basic " + base64.StdEncoding.EncodeToString([]byte(p.user+":"+p.pass))
	return subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
}

func (n *Node) proxy(p *Proxy, w http.ResponseWriter, r *http.Request) {
	if !p.authorized(r) {
		w.Header().Set("Proxy-Authenticate", `Basic realm="amarchy"`)
		http.Error(w, "this proxy is amarchy's", http.StatusProxyAuthRequired)
		return
	}
	if r.Method == http.MethodConnect {
		n.connect(w, r)
		return
	}
	// Plain HTTP to a tailnet address (http://box:8792/), absolute in the request.
	if r.URL.Host == "" || !OnTailnet(r.URL.Hostname()) {
		http.Error(w, "the tailnet only", http.StatusForbidden)
		return
	}
	out := r.Clone(r.Context())
	out.RequestURI = ""
	out.Header.Del("Proxy-Authorization")
	out.Header.Del("Proxy-Connection")
	tr := &http.Transport{DialContext: n.srv.Dial, ResponseHeaderTimeout: 60 * time.Second}
	defer tr.CloseIdleConnections()
	res, err := tr.RoundTrip(out)
	if err != nil {
		http.Error(w, "the tailnet didn't answer: "+err.Error(), http.StatusBadGateway)
		return
	}
	defer res.Body.Close()
	for k, vs := range res.Header {
		for _, v := range vs {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(res.StatusCode)
	flush, _ := w.(http.Flusher)
	buf := make([]byte, 32<<10)
	for {
		m, err := res.Body.Read(buf)
		if m > 0 {
			w.Write(buf[:m])
			if flush != nil {
				flush.Flush()
			}
		}
		if err != nil {
			return
		}
	}
}

// connect: a tunnel to a tailnet host:port (HTTPS, a WebSocket).
func (n *Node) connect(w http.ResponseWriter, r *http.Request) {
	host, _, err := net.SplitHostPort(r.Host)
	if err != nil || !OnTailnet(host) {
		http.Error(w, "the tailnet only", http.StatusForbidden)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	t, err := n.srv.Dial(ctx, "tcp", r.Host)
	if err != nil {
		http.Error(w, "the tailnet didn't answer: "+err.Error(), http.StatusBadGateway)
		return
	}
	hj, ok := w.(http.Hijacker)
	if !ok {
		t.Close()
		http.Error(w, "no tunnel here", http.StatusInternalServerError)
		return
	}
	c, buf, err := hj.Hijack()
	if err != nil {
		t.Close()
		return
	}
	io.WriteString(c, "HTTP/1.1 200 Connection Established\r\n\r\n")
	go func() {
		// What the client sent with its CONNECT, already read, first.
		if buf != nil && buf.Reader.Buffered() > 0 {
			io.CopyN(t, buf, int64(buf.Reader.Buffered()))
		}
		io.Copy(t, c)
		closeWrite(t)
	}()
	io.Copy(c, t)
	c.Close()
	t.Close()
}

func closeWrite(c net.Conn) {
	if cw, ok := c.(interface{ CloseWrite() error }); ok {
		cw.CloseWrite()
		return
	}
	c.Close()
}

var _ = bufio.NewReader

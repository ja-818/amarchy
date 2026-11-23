package node

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// The node's proxy: how this computer reaches the tailnet without the
// system's Tailscale (amarchy's app server calling its peers, the desktop
// app's window, a phone app's web view). HTTP CONNECT, and plain HTTP to a
// tailnet address, on 127.0.0.1, behind a credential of its own; for the
// tailnet only (its names, *.ts.net, and its addresses), never anywhere else.
//
// It reads requests itself rather than through net/http's server: WebKit's
// network library, asked for the credential (407), sends its next request
// on the same connection naming the proxy itself as the target, the real
// one only in its Host header, which net/http drops from a CONNECT.

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
	self string
	auth string // the Proxy-Authorization it wants
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
	pass := hex.EncodeToString(secret[:])
	p := &Proxy{ln: ln, self: ln.Addr().String(),
		auth: "Basic " + base64.StdEncoding.EncodeToString([]byte("amarchy:"+pass))}
	p.URL = fmt.Sprintf("http://amarchy:%s@%s", pass, p.self)
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go n.proxyConn(ctx, p, c)
		}
	}()
	go func() {
		<-ctx.Done()
		ln.Close()
	}()
	return p, nil
}

// head is a request's first line and headers, as sent.
type head struct {
	method, target, proto string
	header                http.Header
	host                  string // its Host header
}

func readHead(br *bufio.Reader) (*head, error) {
	line, err := readLine(br)
	if err != nil {
		return nil, err
	}
	parts := strings.SplitN(line, " ", 3)
	if len(parts) != 3 {
		return nil, fmt.Errorf("not a request: %q", line)
	}
	h := &head{method: parts[0], target: parts[1], proto: parts[2], header: http.Header{}}
	for n := 0; ; n++ {
		l, err := readLine(br)
		if err != nil {
			return nil, err
		}
		if l == "" {
			break
		}
		if n > 200 {
			return nil, errors.New("too many headers")
		}
		k, v, ok := strings.Cut(l, ":")
		if !ok {
			continue
		}
		k, v = http.CanonicalHeaderKey(strings.TrimSpace(k)), strings.TrimSpace(v)
		if k == "Host" {
			h.host = v
			continue
		}
		h.header.Add(k, v)
	}
	return h, nil
}

func readLine(br *bufio.Reader) (string, error) {
	var b []byte
	for {
		chunk, more, err := br.ReadLine()
		if err != nil {
			return "", err
		}
		b = append(b, chunk...)
		if len(b) > 16<<10 {
			return "", errors.New("a line too long")
		}
		if !more {
			return string(b), nil
		}
	}
}

func reply(c net.Conn, code int, text string, extra ...string) {
	var b bytes.Buffer
	fmt.Fprintf(&b, "HTTP/1.1 %d %s\r\n", code, http.StatusText(code))
	for _, e := range extra {
		b.WriteString(e + "\r\n")
	}
	fmt.Fprintf(&b, "Content-Type: text/plain\r\nContent-Length: %d\r\n\r\n%s", len(text), text)
	c.Write(b.Bytes())
}

// dest: where a request goes, host:port; the Host header when its target
// names nothing or the proxy itself (see above).
func (p *Proxy) dest(h *head, defaultPort string) string {
	target := h.target
	if h.method != http.MethodConnect {
		u, err := url.Parse(h.target)
		target = ""
		if err == nil && u.Host != "" {
			target = u.Host
			if u.Port() == "" {
				target = net.JoinHostPort(u.Hostname(), defaultPort)
			}
		}
	}
	if target == "" || target == p.self {
		hh := h.host
		if hh == "" {
			return ""
		}
		if _, _, err := net.SplitHostPort(hh); err != nil {
			hh = net.JoinHostPort(strings.Trim(hh, "[]"), defaultPort)
		}
		target = hh
	}
	return target
}

func (n *Node) proxyConn(ctx context.Context, p *Proxy, c net.Conn) {
	defer c.Close()
	br := bufio.NewReader(c)
	tr := &http.Transport{DialContext: n.srv.Dial, ResponseHeaderTimeout: 60 * time.Second, DisableCompression: true}
	defer tr.CloseIdleConnections()
	for {
		c.SetReadDeadline(time.Now().Add(5 * time.Minute))
		h, err := readHead(br)
		if err != nil {
			return
		}
		c.SetReadDeadline(time.Time{})
		got := h.header.Get("Proxy-Authorization")
		h.header.Del("Proxy-Authorization")
		h.header.Del("Proxy-Connection")
		if subtle.ConstantTimeCompare([]byte(got), []byte(p.auth)) != 1 {
			drain(br, h)
			reply(c, http.StatusProxyAuthRequired, "this proxy is amarchy's", `Proxy-Authenticate: Basic realm="amarchy"`)
			continue
		}
		if h.method == http.MethodConnect {
			dest := p.dest(h, "443")
			host, _, _ := net.SplitHostPort(dest)
			if dest == "" || !OnTailnet(host) {
				reply(c, http.StatusForbidden, "the tailnet only", "Connection: close")
				return
			}
			dctx, cancel := context.WithTimeout(ctx, 20*time.Second)
			t, err := n.srv.Dial(dctx, "tcp", dest)
			cancel()
			if err != nil {
				reply(c, http.StatusBadGateway, "the tailnet didn't answer: "+err.Error(), "Connection: close")
				return
			}
			io.WriteString(c, "HTTP/1.1 200 Connection Established\r\n\r\n")
			if k := br.Buffered(); k > 0 { // what came with the CONNECT, already read
				b, _ := br.Peek(k)
				t.Write(b)
				br.Discard(k)
			}
			pipe(c, t)
			return
		}
		// Plain HTTP to a tailnet address, one request at a time.
		dest := p.dest(h, "80")
		host, _, _ := net.SplitHostPort(dest)
		if dest == "" || !OnTailnet(host) {
			drain(br, h)
			reply(c, http.StatusForbidden, "the tailnet only", "Connection: close")
			return
		}
		if !n.forward(c, br, h, dest, tr) {
			return
		}
	}
}

// forward: one plain HTTP request to dest and its answer back (a stream as
// it comes; an upgrade, a WebSocket, both ways). Whether the connection
// goes on.
func (n *Node) forward(c net.Conn, br *bufio.Reader, h *head, dest string, tr *http.Transport) bool {
	u, _ := url.Parse(h.target)
	path := "/"
	if u != nil {
		path = u.RequestURI()
	}
	req, err := http.NewRequest(h.method, "http://"+dest+path, body(br, h))
	if err != nil {
		reply(c, http.StatusBadRequest, err.Error(), "Connection: close")
		return false
	}
	req.Header = h.header
	req.Host = h.host
	if req.Host == "" || req.Host == c.LocalAddr().String() {
		req.Host = dest
	}
	if cl := h.header.Get("Content-Length"); cl != "" {
		req.ContentLength, _ = strconv.ParseInt(cl, 10, 64)
	}
	upgrade := strings.EqualFold(h.header.Get("Connection"), "upgrade") || h.header.Get("Upgrade") != ""
	if upgrade {
		return upgradeTo(n, c, br, req, dest)
	}
	res, err := tr.RoundTrip(req)
	if err != nil {
		reply(c, http.StatusBadGateway, "the tailnet didn't answer: "+err.Error(), "Connection: close")
		return false
	}
	defer res.Body.Close()
	keep := !res.Close && !strings.EqualFold(h.header.Get("Connection"), "close")
	res.Close = !keep
	if err := res.Write(flushWriter{c}); err != nil {
		return false
	}
	return keep
}

// upgradeTo: a WebSocket over plain HTTP, the connection handed to it.
func upgradeTo(n *Node, c net.Conn, br *bufio.Reader, req *http.Request, dest string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	t, err := n.srv.Dial(ctx, "tcp", dest)
	cancel()
	if err != nil {
		reply(c, http.StatusBadGateway, "the tailnet didn't answer: "+err.Error(), "Connection: close")
		return false
	}
	out, _ := httputil.DumpRequest(req, false)
	t.Write(out)
	if k := br.Buffered(); k > 0 {
		b, _ := br.Peek(k)
		t.Write(b)
		br.Discard(k)
	}
	pipe(c, t)
	return false
}

func body(br *bufio.Reader, h *head) io.Reader {
	if strings.Contains(strings.ToLower(h.header.Get("Transfer-Encoding")), "chunked") {
		h.header.Del("Transfer-Encoding")
		return httputil.NewChunkedReader(br)
	}
	if cl, err := strconv.ParseInt(h.header.Get("Content-Length"), 10, 64); err == nil && cl > 0 {
		return io.LimitReader(br, cl)
	}
	return http.NoBody
}

// drain: a refused request's body, so the next one on the connection reads clean.
func drain(br *bufio.Reader, h *head) {
	if h.method == http.MethodConnect {
		return
	}
	io.Copy(io.Discard, body(br, h))
}

type flushWriter struct{ c net.Conn }

func (w flushWriter) Write(b []byte) (int, error) { return w.c.Write(b) }

func pipe(a, b net.Conn) {
	done := make(chan struct{})
	go func() {
		io.Copy(b, a)
		closeWrite(b)
		close(done)
	}()
	io.Copy(a, b)
	closeWrite(a)
	<-done
	a.Close()
	b.Close()
}

func closeWrite(c net.Conn) {
	if cw, ok := c.(interface{ CloseWrite() error }); ok {
		cw.CloseWrite()
		return
	}
	c.Close()
}

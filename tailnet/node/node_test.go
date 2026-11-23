package node

// amarchy's own node on a tailnet of the test's own (Tailscale's test
// control server and DERP, in this process): it comes up, Tailscale's
// LocalAPI and CLI work on its socket, what `tailscale serve` sets is served
// to another node with who's asking (and never what the caller claims),
// streams as they come, and its proxy reaches the tailnet, only the
// tailnet, with its credential only.

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"tailscale.com/client/local"
	"tailscale.com/cmd/tailscale/cli"
	"tailscale.com/ipn"
	"tailscale.com/ipn/store/mem"
	"tailscale.com/net/netns"
	"tailscale.com/tailcfg"
	"tailscale.com/tsnet"
	"tailscale.com/tstest/integration"
	"tailscale.com/tstest/integration/testcontrol"
	"tailscale.com/types/logger"
)

func startControl(t *testing.T) string {
	netns.SetEnabled(false)
	t.Cleanup(func() { netns.SetEnabled(true) })
	derpMap := integration.RunDERPAndSTUN(t, logger.Discard, "127.0.0.1")
	control := &testcontrol.Server{
		DERPMap:        derpMap,
		DNSConfig:      &tailcfg.DNSConfig{Proxied: true},
		MagicDNSDomain: "tail-scale.ts.net",
		Logf:           logger.Discard,
	}
	control.HTTPTestServer = httptest.NewUnstartedServer(control)
	control.HTTPTestServer.Start()
	t.Cleanup(control.HTTPTestServer.Close)
	return control.HTTPTestServer.URL
}

func running(t *testing.T, ctx context.Context, lc *local.Client) {
	t.Helper()
	for {
		st, err := lc.Status(ctx)
		if err == nil && st.BackendState == ipn.Running.String() && len(st.TailscaleIPs) > 0 {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatalf("never on the tailnet: %v %v", err, st)
		case <-time.After(100 * time.Millisecond):
		}
	}
}

func TestNode(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	controlURL := startControl(t)
	dir := t.TempDir()

	// amarchy's node ("desk") and another of the user's ("phone").
	n, err := Start(Config{Dir: filepath.Join(dir, "desk"), Hostname: "desk", ControlURL: controlURL, Logf: t.Logf})
	if err != nil {
		t.Fatal(err)
	}
	defer n.Close()
	running(t, ctx, n.LocalClient())
	if st, _ := os.Stat(filepath.Join(dir, "desk")); st.Mode().Perm() != 0o700 {
		t.Errorf("its folder is %v, not 0700", st.Mode().Perm())
	}
	phone := &tsnet.Server{Dir: filepath.Join(dir, "phone"), Hostname: "phone", ControlURL: controlURL, Store: new(mem.Store),
		Ephemeral: true, Logf: logger.Discard}
	defer phone.Close()
	if _, err := phone.Up(ctx); err != nil {
		t.Fatal(err)
	}

	// Tailscale's LocalAPI on its socket, this user's only; its CLI on it.
	socket := filepath.Join(dir, "desk", "tailscaled.sock")
	go n.ServeLocalAPI(ctx, socket)
	for i := 0; i < 50; i++ {
		if _, err := os.Stat(socket); err == nil {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if st, _ := os.Stat(socket); st == nil || st.Mode().Perm() != 0o600 {
		t.Fatalf("its socket isn't 0600: %v", st)
	}
	viaSocket := &local.Client{Socket: socket, UseSocketOnly: true}
	st, err := viaSocket.Status(ctx)
	if err != nil || st.BackendState != ipn.Running.String() || st.Self == nil || !strings.HasPrefix(st.Self.DNSName, "desk.") {
		t.Fatalf("its LocalAPI on the socket: %v %+v", err, st)
	}
	if w := Words(st); !strings.Contains(w, "on your tailnet") {
		t.Errorf("its words: %q", w)
	}

	// What amarchy serves (its app server here): who's asking, the host
	// asked for, a stream as it comes.
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/stream" {
			w.Header().Set("Content-Type", "text/event-stream")
			io.WriteString(w, "data: first\n\n")
			w.(http.Flusher).Flush()
			time.Sleep(3 * time.Second)
			io.WriteString(w, "data: second\n\n")
			return
		}
		fmt.Fprintf(w, "login=%s host=%s path=%s", r.Header.Get("Tailscale-User-Login"), r.Host, r.URL.Path)
	}))
	defer backend.Close()
	// Set as amarchy sets it: Tailscale's CLI, `serve --bg`, on the node's socket.
	if err := cli.Run([]string{"--socket=" + socket, "serve", "--bg", "--http=8080", backend.URL}); err != nil {
		t.Fatalf("tailscale serve on its socket: %v", err)
	}
	n.ServeNow(ctx)
	if got := n.Serving()[8080]; got != "http" {
		t.Fatalf("not serving 8080 over http: %v", n.Serving())
	}
	phoneLC, _ := phone.LocalClient()
	phoneSt, _ := phoneLC.Status(ctx)
	login := phoneSt.User[phoneSt.Self.UserID].LoginName
	hc := phone.HTTPClient()
	req, _ := http.NewRequestWithContext(ctx, "GET", "http://desk.tail-scale.ts.net:8080/api/state", nil)
	req.Header.Set("Tailscale-User-Login", "someone-else@example.com") // made up by the caller
	res, err := hc.Do(req)
	if err != nil {
		t.Fatalf("the phone to what it serves: %v", err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	want := fmt.Sprintf("login=%s host=desk.tail-scale.ts.net:8080 path=/api/state", login)
	if string(body) != want {
		t.Errorf("served:\n got %q\nwant %q", body, want)
	}
	// A stream: its first event before it ends.
	req, _ = http.NewRequestWithContext(ctx, "GET", "http://desk.tail-scale.ts.net:8080/stream", nil)
	res, err = hc.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t0 := time.Now()
	line, _ := bufio.NewReader(res.Body).ReadString('\n')
	res.Body.Close()
	if line != "data: first\n" || time.Since(t0) > 2*time.Second {
		t.Errorf("a stream isn't passed on as it comes: %q after %v", line, time.Since(t0))
	}
	// Turned off (`serve --http=8080 off`): no longer served.
	if err := cli.Run([]string{"--socket=" + socket, "serve", "--http=8080", "off"}); err != nil {
		t.Fatalf("serve off: %v", err)
	}
	n.ServeNow(ctx)
	if _, ok := n.Serving()[8080]; ok {
		t.Errorf("still serving 8080 once off: %v", n.Serving())
	}

	// Its proxy: to the tailnet (the phone serves something), as HTTP and
	// as a CONNECT tunnel; nowhere else; not without its credential.
	ln, err := phone.Listen("tcp", ":9090")
	if err != nil {
		t.Fatal(err)
	}
	go http.Serve(ln, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, "hello from the phone") }))
	p, err := n.StartProxy(ctx, "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	pu, _ := url.Parse(p.URL)
	viaProxy := &http.Client{Transport: &http.Transport{Proxy: http.ProxyURL(pu)}, Timeout: 30 * time.Second}
	res, err = viaProxy.Get("http://phone.tail-scale.ts.net:9090/")
	if err != nil {
		t.Fatalf("through its proxy: %v", err)
	}
	body, _ = io.ReadAll(res.Body)
	res.Body.Close()
	if string(body) != "hello from the phone" {
		t.Errorf("through its proxy: %q", body)
	}
	c, err := net.Dial("tcp", pu.Host)
	if err != nil {
		t.Fatal(err)
	}
	auth := "Basic " + basic(pu.User)
	fmt.Fprintf(c, "CONNECT phone.tail-scale.ts.net:9090 HTTP/1.1\r\nHost: phone.tail-scale.ts.net:9090\r\nProxy-Authorization: %s\r\n\r\n", auth)
	br := bufio.NewReader(c)
	status, _ := br.ReadString('\n')
	if !strings.Contains(status, "200") {
		t.Fatalf("CONNECT: %q", status)
	}
	for {
		l, _ := br.ReadString('\n')
		if l == "\r\n" || l == "" {
			break
		}
	}
	fmt.Fprintf(c, "GET / HTTP/1.1\r\nHost: phone\r\nConnection: close\r\n\r\n")
	rest, _ := io.ReadAll(br)
	c.Close()
	if !strings.Contains(string(rest), "hello from the phone") {
		t.Errorf("through its CONNECT tunnel: %q", rest)
	}
	// As WebKit does it: asked for the credential (407), its next request
	// on the same connection names the proxy itself, the real host only in
	// its Host header; then origin-form requests with a Host header.
	c, _ = net.Dial("tcp", pu.Host)
	br = bufio.NewReader(c)
	fmt.Fprintf(c, "CONNECT phone.tail-scale.ts.net:9090 HTTP/1.1\r\nHost: phone.tail-scale.ts.net:9090\r\n\r\n")
	if s, _ := br.ReadString('\n'); !strings.Contains(s, "407") {
		t.Fatalf("no credential: %q", s)
	}
	for {
		l, _ := br.ReadString('\n')
		if l == "\r\n" || l == "" {
			break
		}
	}
	io.ReadFull(br, make([]byte, len("this proxy is amarchy's")))
	fmt.Fprintf(c, "CONNECT %s HTTP/1.1\r\nHost: phone.tail-scale.ts.net:9090\r\nProxy-Authorization: %s\r\n\r\n", pu.Host, auth)
	if s, _ := br.ReadString('\n'); !strings.Contains(s, "200") {
		t.Fatalf("WebKit's retry (CONNECT to the proxy itself, the host in Host): %q", s)
	}
	for {
		l, _ := br.ReadString('\n')
		if l == "\r\n" || l == "" {
			break
		}
	}
	fmt.Fprintf(c, "GET / HTTP/1.1\r\nHost: phone\r\nConnection: close\r\n\r\n")
	rest, _ = io.ReadAll(br)
	c.Close()
	if !strings.Contains(string(rest), "hello from the phone") {
		t.Errorf("through WebKit's retried tunnel: %q", rest)
	}
	c, _ = net.Dial("tcp", pu.Host)
	fmt.Fprintf(c, "GET / HTTP/1.1\r\nHost: phone.tail-scale.ts.net:9090\r\nProxy-Authorization: %s\r\nConnection: close\r\n\r\n", auth)
	rest, _ = io.ReadAll(c)
	c.Close()
	if !strings.Contains(string(rest), "hello from the phone") {
		t.Errorf("an origin-form request, its host in Host: %q", rest)
	}
	for _, tc := range []struct {
		host, auth string
		code       string
	}{
		{"example.com:443", auth, "403"},
		{"127.0.0.1:22", auth, "403"},
		{"phone.tail-scale.ts.net:9090", "Basic d3Jvbmc6d3Jvbmc=", "407"},
	} {
		c, _ := net.Dial("tcp", pu.Host)
		fmt.Fprintf(c, "CONNECT %s HTTP/1.1\r\nHost: %s\r\nProxy-Authorization: %s\r\n\r\n", tc.host, tc.host, tc.auth)
		s, _ := bufio.NewReader(c).ReadString('\n')
		c.Close()
		if !strings.Contains(s, tc.code) {
			t.Errorf("CONNECT %s: %q, want %s", tc.host, s, tc.code)
		}
	}
}

func basic(u *url.Userinfo) string {
	pass, _ := u.Password()
	return b64(u.Username() + ":" + pass)
}

func TestOnTailnet(t *testing.T) {
	for host, want := range map[string]bool{
		"amarchy.tail1234.ts.net": true, "AMARCHY.TAIL1234.TS.NET.": true, "100.71.198.126": true,
		"[fd7a:115c:a1e0::1]": true, "example.com": false, "127.0.0.1": false, "100.128.0.1": false,
		"ts.net.example.com": false, "192.168.1.2": false,
	} {
		if got := OnTailnet(host); got != want {
			t.Errorf("OnTailnet(%q) = %v", host, got)
		}
	}
}

func b64(s string) string { return encodeStd(s) }

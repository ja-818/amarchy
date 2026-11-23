package mobile

// The phone's node on a tailnet of the test's own (Tailscale's test control
// server and DERP, in this process): it comes up, State lists the user's
// other machines, its proxy reaches amarchy on one of them by its tailnet
// name, and Stop takes it off.

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"testing"
	"time"

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

func TestPhoneNode(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	controlURL := startControl(t)
	dir := t.TempDir()

	if got := State(); got != `{"state":"Off","words":"off","login_url":"","self":"","peers":[]}` {
		t.Errorf("before Start: %s", got)
	}
	if ProxyURL() != "" {
		t.Error("a proxy before Start")
	}
	if _, err := LoginURL(); err == nil {
		t.Error("a sign-in before Start")
	}

	// The user's server, running amarchy (its hello on port 80).
	srv := &tsnet.Server{Dir: filepath.Join(dir, "amarchy"), Hostname: "amarchy", ControlURL: controlURL, Store: new(mem.Store),
		Ephemeral: true, Logf: logger.Discard}
	defer srv.Close()
	if _, err := srv.Up(ctx); err != nil {
		t.Fatal(err)
	}
	ln, err := srv.Listen("tcp", ":80")
	if err != nil {
		t.Fatal(err)
	}
	go http.Serve(ln, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, `{"name":"amarchy","protocol":1,"path":%q}`, r.URL.Path)
	}))

	if err := StartWith(filepath.Join(dir, "phone"), "iphone", controlURL); err != nil {
		t.Fatal(err)
	}
	defer Stop()
	if err := StartWith(filepath.Join(dir, "phone"), "iphone", controlURL); err != nil {
		t.Fatalf("started twice: %v", err)
	}

	var st state
	for {
		if err := json.Unmarshal([]byte(State()), &st); err != nil {
			t.Fatal(err)
		}
		// (The test's control server says nothing of who's online.)
		if st.State == "Running" && len(st.Peers) > 0 {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatalf("never running with its peer: %+v", st)
		case <-time.After(200 * time.Millisecond):
		}
	}
	if st.Self != "iphone.tail-scale.ts.net" || st.Peers[0].DNS != "amarchy.tail-scale.ts.net" || st.Peers[0].Name != "amarchy" {
		t.Errorf("its state: %+v", st)
	}
	if u, err := LoginURL(); err != nil || u != "" {
		t.Errorf("signed in, still a login page: %q %v", u, err)
	}

	// The web view's way to it: the proxy, with its credential.
	proxy := ProxyURL()
	pu, err := url.Parse(proxy)
	if err != nil || pu.User == nil || pu.Hostname() != "127.0.0.1" {
		t.Fatalf("its proxy: %q", proxy)
	}
	hc := &http.Client{Transport: &http.Transport{Proxy: http.ProxyURL(pu)}, Timeout: 30 * time.Second}
	res, err := hc.Get("http://amarchy.tail-scale.ts.net/api/peer/hello")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != 200 || string(body) != `{"name":"amarchy","protocol":1,"path":"/api/peer/hello"}` {
		t.Errorf("amarchy through the proxy: %d %s", res.StatusCode, body)
	}
	// Never anywhere but the tailnet.
	outside := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, "outside") }))
	defer outside.Close()
	if res, err := hc.Get(outside.URL); err == nil {
		res.Body.Close()
		if res.StatusCode == 200 {
			t.Error("the proxy went outside the tailnet")
		}
	}
	// Without its credential: refused.
	bare := *pu
	bare.User = nil
	if res, err := (&http.Client{Transport: &http.Transport{Proxy: http.ProxyURL(&bare)}}).Get("http://amarchy.tail-scale.ts.net/"); err == nil {
		res.Body.Close()
		if res.StatusCode != http.StatusProxyAuthRequired {
			t.Errorf("without its credential: %d", res.StatusCode)
		}
	}

	// Signed out: it waits for a sign-in again, a login page to open.
	if err := Logout(); err != nil {
		t.Fatal(err)
	}
	for {
		if err := json.Unmarshal([]byte(State()), &st); err != nil {
			t.Fatal(err)
		}
		if st.State == "NeedsLogin" {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatalf("still signed in after Logout: %+v", st)
		case <-time.After(200 * time.Millisecond):
		}
	}

	Stop()
	if err := Logout(); err == nil {
		t.Error("a Logout with the node off")
	}
	if ProxyURL() != "" || State() != `{"state":"Off","words":"off","login_url":"","self":"","peers":[]}` {
		t.Error("still up after Stop")
	}
	if c, err := net.DialTimeout("tcp", pu.Host, time.Second); err == nil {
		c.Close()
		t.Error("its proxy still listens after Stop")
	}
}

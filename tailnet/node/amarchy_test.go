package node

// amarchy (bin/amarchy) on a computer whose Tailscale is amarchy's own node,
// on a tailnet of the test's own: the node runs as its service runs it, in
// a home of the test's, another machine of the user's ("srv") answers as an
// amarchy; then test/tailnet-own.py drives bin/amarchy there (its status,
// its address, serving, a call to its peer through the node's proxy), and
// the other machine reaches what it served, with who's asking.

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"tailscale.com/ipn/store/mem"
	"tailscale.com/tsnet"
	"tailscale.com/types/logger"
)

func TestAmarchyOnItsOwnNode(t *testing.T) {
	if _, err := exec.LookPath("python3"); err != nil {
		t.Skip("needs python3")
	}
	_, here, _, _ := runtime.Caller(0)
	repo := filepath.Join(filepath.Dir(here), "..", "..")
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	controlURL := startControl(t)
	// A short home: a unix socket's path has room for 108 bytes (104 on
	// macOS, whose temporary folder is a long path of its own).
	base := os.TempDir()
	if len(base) > 32 {
		base = "/tmp"
	}
	home, err := os.MkdirTemp(base, "an")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(home) })
	state := filepath.Join(home, ".local", "state", "amarchy", "tailnet")

	// amarchy-tailnet where install.sh puts it, for `tailscale ...` (its cli).
	bin := filepath.Join(home, ".local", "bin", "amarchy-tailnet")
	build := exec.Command("go", "build", "-o", bin, "./cmd/amarchy-tailnet")
	build.Dir = filepath.Join(repo, "tailnet")
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("building amarchy-tailnet: %v\n%s", err, out)
	}

	// The node, as its service runs it.
	up := make(chan *Node, 1)
	go Run(ctx, RunConfig{State: state, Hostname: "desk", ControlURL: controlURL, Logf: t.Logf,
		Up: func(n *Node) { up <- n }})
	var n *Node
	select {
	case n = <-up:
	case <-ctx.Done():
		t.Fatal("the node never came up")
	}
	running(t, ctx, n.LocalClient())

	// Another machine of the user's, answering as an amarchy.
	srv := &tsnet.Server{Dir: filepath.Join(home, "srv"), Hostname: "srv", ControlURL: controlURL, Store: new(mem.Store),
		Ephemeral: true, Logf: logger.Discard}
	defer srv.Close()
	if _, err := srv.Up(ctx); err != nil {
		t.Fatal(err)
	}
	var ln net.Listener
	ln, err = srv.Listen("tcp", ":8080")
	if err != nil {
		t.Fatal(err)
	}
	go http.Serve(ln, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/peer/hello" {
			json.NewEncoder(w).Encode(map[string]any{"name": "srv", "label": "Server", "protocol": 1,
				"peer": r.Header.Get("X-Amarchy-Peer")})
			return
		}
		http.NotFound(w, r)
	}))

	// What amarchy serves here (its app server, say).
	app := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, "app: login=%s host=%s", r.Header.Get("Tailscale-User-Login"), r.Host)
	}))
	defer app.Close()

	cmd := exec.CommandContext(ctx, "python3", filepath.Join(repo, "test", "tailnet-own.py"))
	cmd.Env = append(os.Environ(), "HOME="+home, "XDG_STATE_HOME="+filepath.Join(home, ".local", "state"),
		"XDG_CONFIG_HOME="+filepath.Join(home, ".config"), "AMARCHY_WORK="+filepath.Join(home, "Work"),
		"AMARCHY_HOST_TAILSCALE=own", "TAILNET_TEST_APP="+app.URL, "TAILNET_TEST_PEER=http://srv.tail-scale.ts.net:8080")
	out, err := cmd.CombinedOutput()
	t.Logf("test/tailnet-own.py:\n%s", out)
	if err != nil || !strings.Contains(string(out), "all passed") {
		t.Fatalf("bin/amarchy on its own node: %v", err)
	}

	// What it served (`tailscale serve --bg --http=8081 <app>`, run by
	// bin/amarchy), reached by the other machine, with who's asking.
	n.ServeNow(ctx)
	res, err := srv.HTTPClient().Get("http://desk.tail-scale.ts.net:8081/x")
	if err != nil {
		t.Fatalf("the other machine to what amarchy served: %v", err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	srvLC, _ := srv.LocalClient()
	st, _ := srvLC.Status(ctx)
	if want := fmt.Sprintf("app: login=%s host=desk.tail-scale.ts.net:8081", st.User[st.Self.UserID].LoginName); string(body) != want {
		t.Errorf("served by amarchy's call:\n got %q\nwant %q", body, want)
	}
}

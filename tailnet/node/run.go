package node

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

// RunConfig is what `amarchy-tailnet run` runs with.
type RunConfig struct {
	State      string // its folder: the node's state, tailscaled.sock, proxy.json
	Hostname   string
	ControlURL string
	Logf       func(format string, args ...any)
	// Stop, checked every 30 s: true ends it (the system's Tailscale came).
	Stop func() bool
	// Up, once it's serving its socket and proxy (tests).
	Up func(*Node)
}

// Run is the node as its service runs it: up, Tailscale's LocalAPI on its
// socket, its proxy written down (proxy.json, 0600), what `tailscale serve`
// sets served, its state said when it changes, until ctx ends or Stop says.
func Run(ctx context.Context, cfg RunConfig) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	n, err := Start(Config{Dir: cfg.State, Hostname: cfg.Hostname, ControlURL: cfg.ControlURL, Logf: cfg.Logf})
	if err != nil {
		return err
	}
	defer n.Close()
	socket := filepath.Join(cfg.State, "tailscaled.sock")
	go func() {
		if err := n.ServeLocalAPI(ctx, socket); err != nil {
			cfg.Logf("its LocalAPI socket: %v", err)
			cancel()
		}
	}()
	p, err := n.StartProxy(ctx, "127.0.0.1:0")
	if err != nil {
		return err
	}
	if err := writeProxy(cfg.State, p.URL); err != nil {
		return err
	}
	defer os.Remove(filepath.Join(cfg.State, "proxy.json"))
	go n.Serve(ctx)
	for i := 0; i < 100; i++ { // its socket, there before anyone's told it's up
		if _, err := os.Stat(socket); err == nil {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if cfg.Up != nil {
		cfg.Up(n)
	}
	last := ""
	tick := time.NewTicker(2 * time.Second)
	defer tick.Stop()
	checked := time.Now()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-tick.C:
		}
		if st, err := n.Status(ctx); err == nil {
			if w := Words(st); w != last {
				cfg.Logf("it's %s", w)
				last = w
			}
		}
		if cfg.Stop != nil && time.Since(checked) > 30*time.Second {
			checked = time.Now()
			if cfg.Stop() {
				cfg.Logf("the system's Tailscale is here now: amarchy uses it; its own node stops (its sign-in is kept)")
				return nil
			}
		}
	}
}

func writeProxy(state, url string) error {
	f := filepath.Join(state, "proxy.json")
	tmp := f + ".new"
	b, _ := json.Marshal(map[string]string{"url": url})
	if err := os.WriteFile(tmp, append(b, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, f)
}

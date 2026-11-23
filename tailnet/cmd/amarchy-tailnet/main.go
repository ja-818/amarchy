// amarchy-tailnet: amarchy's own Tailscale node, for a computer without the
// system's Tailscale (docs/plan-omarchy-and-machines.md, "Tailscale inside
// the apps").
//
//	amarchy-tailnet run       the node (the user service amarchy-tailnet.service runs it)
//	amarchy-tailnet login     Tailscale's sign-in address for it (opened on a desktop)
//	amarchy-tailnet status    where it stands, in words (--json: as data)
//	amarchy-tailnet cli ...   Tailscale's own CLI, on this node (as `tailscale ...`)
//
// Its state, socket and proxy: ~/.local/state/amarchy/tailnet/ (or --state).
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/ja-818/amarchy/tailnet/node"
	"tailscale.com/client/local"
	"tailscale.com/cmd/tailscale/cli"
	"tailscale.com/ipn"
)

const usage = `amarchy-tailnet: amarchy's own Tailscale node, for a computer without the system's Tailscale

  amarchy-tailnet run        the node (amarchy-tailnet.service runs it); it stays off while
                             the system's Tailscale answers
  amarchy-tailnet login      sign in: Tailscale's sign-in address (opened on a desktop;
                             --no-open: only printed)
  amarchy-tailnet status     where it stands, in words (--json: as data)
  amarchy-tailnet cli ...    Tailscale's own CLI on this node (amarchy-tailnet cli status)

  --state DIR                its folder (~/.local/state/amarchy/tailnet)
`

var version = "dev"

func stateDir() string {
	if d := os.Getenv("AMARCHY_TAILNET_STATE"); d != "" {
		return d
	}
	base := os.Getenv("XDG_STATE_HOME")
	if !filepath.IsAbs(base) {
		home, _ := os.UserHomeDir()
		base = filepath.Join(home, ".local", "state")
	}
	return filepath.Join(base, "amarchy", "tailnet")
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	cmd, args := os.Args[1], os.Args[2:]
	// --state before or after the command
	state := stateDir()
	var rest []string
	for i := 0; i < len(args); i++ {
		if args[i] == "--state" && i+1 < len(args) {
			state = args[i+1]
			i++
		} else if v, ok := strings.CutPrefix(args[i], "--state="); ok {
			state = v
		} else {
			rest = append(rest, args[i])
		}
	}
	socket := filepath.Join(state, "tailscaled.sock")
	var err error
	switch cmd {
	case "run":
		err = run(state, socket, rest)
	case "login":
		err = login(socket, rest)
	case "status":
		err = status(socket, state, rest)
	case "cli":
		err = cli.Run(append([]string{"--socket=" + socket}, rest...))
	case "--version", "version":
		fmt.Println("amarchy-tailnet", version)
	case "-h", "--help", "help":
		fmt.Print(usage)
	default:
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "amarchy-tailnet:", err)
		os.Exit(1)
	}
}

// systemAnswers says whether the system's Tailscale is here (its daemon
// answers, signed in or not): then amarchy uses it, and this node stays off.
func systemAnswers() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	st, err := (&local.Client{}).StatusWithoutPeers(ctx)
	return err == nil && st.BackendState != ""
}

func run(state, socket string, args []string) error {
	fs := flag.NewFlagSet("run", flag.ContinueOnError)
	host, _ := os.Hostname()
	host, _, _ = strings.Cut(host, ".")
	hostname := fs.String("hostname", host, "its name on the tailnet")
	control := fs.String("control-url", "", "Tailscale's coordination server (tests)")
	beside := fs.Bool("beside-system", false, "run even when the system's Tailscale answers (tests)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	logger := log.New(os.Stderr, "", 0)
	if !*beside && systemAnswers() {
		logger.Print("the system's Tailscale is here: amarchy uses it, and its own node stays off")
		return nil
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()
	logger.Printf("amarchy-tailnet %s: up as %q (state %s)", version, *hostname, state)
	stopWhen := systemAnswers
	if *beside {
		stopWhen = nil
	}
	err := node.Run(ctx, node.RunConfig{State: state, Hostname: *hostname, ControlURL: *control, Logf: logger.Printf, Stop: stopWhen})
	logger.Print("stopped")
	return err
}

func client(socket string) (*local.Client, error) {
	if _, err := os.Stat(socket); err != nil {
		return nil, errors.New("amarchy's own node isn't running (systemctl --user start amarchy-tailnet)")
	}
	return &local.Client{Socket: socket, UseSocketOnly: true}, nil
}

func login(socket string, args []string) error {
	open := true
	for _, a := range args {
		if a == "--no-open" {
			open = false
		}
	}
	lc, err := client(socket)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	u, err := node.LoginURL(ctx, lc)
	if err != nil {
		return err
	}
	if u == "" {
		st, _ := lc.Status(ctx)
		fmt.Println("Signed in already:", node.Words(st))
		return nil
	}
	fmt.Println(u)
	if open {
		openURL(u)
	}
	return nil
}

func openURL(u string) {
	var c *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		c = exec.Command("open", u)
	case "windows":
		c = exec.Command("rundll32", "url.dll,FileProtocolHandler", u)
	default:
		if os.Getenv("WAYLAND_DISPLAY") == "" && os.Getenv("DISPLAY") == "" {
			return
		}
		c = exec.Command("xdg-open", u)
	}
	_ = c.Start()
}

func status(socket, state string, args []string) error {
	asJSON := len(args) > 0 && args[0] == "--json"
	out := map[string]any{"running": false, "state": "off", "words": "not running (systemctl --user start amarchy-tailnet)"}
	if systemAnswers() {
		out["system"] = true
	}
	lc, err := client(socket)
	if err == nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if st, err := lc.Status(ctx); err == nil {
			out["running"] = true
			out["state"] = st.BackendState
			out["words"] = node.Words(st)
			if st.AuthURL != "" {
				out["auth_url"] = st.AuthURL
			}
			if st.BackendState == ipn.Running.String() && st.Self != nil {
				out["name"] = strings.TrimSuffix(st.Self.DNSName, ".")
				if u, ok := st.User[st.Self.UserID]; ok {
					out["login"] = u.LoginName
				}
			}
		}
	}
	if b, err := os.ReadFile(filepath.Join(state, "proxy.json")); err == nil && out["running"] == true {
		var p map[string]string
		if json.Unmarshal(b, &p) == nil {
			out["proxy"] = p["url"] != ""
		}
	}
	if asJSON {
		b, _ := json.MarshalIndent(out, "", "  ")
		fmt.Println(string(b))
		return nil
	}
	fmt.Println("amarchy's own Tailscale node:", out["words"])
	return nil
}

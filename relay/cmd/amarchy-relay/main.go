// amarchy-relay is amarchy's push relay: a Web Push service (RFC 8030) in
// front of APNs and FCM, so amarchy's phone apps get notifications their
// machines encrypted for them (RFC 8291), which the relay can't read.
//
//	amarchy-relay          serve (configured by its environment)
//	amarchy-relay secret   print a new RELAY_SECRET
//	amarchy-relay check    say what's configured, never a secret
package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/ja-818/amarchy/relay/internal/relay"
)

const usage = `amarchy-relay: amarchy's push relay, a Web Push service in front of APNs and FCM.

  amarchy-relay          serve, configured by its environment (RELAY_URL, RELAY_SECRET, ...)
  amarchy-relay secret   print a new random RELAY_SECRET
  amarchy-relay check    say what's configured (never a secret), and what's wrong

` + relay.Repo + `/tree/main/relay
`

// How long a stop waits for pushes under way.
const shutdownWait = 30 * time.Second

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
	defer stop()
	os.Exit(run(ctx, os.Args[1:], os.Getenv, os.Stdout, os.Stderr))
}

func run(ctx context.Context, args []string, getenv func(string) string, stdout, stderr io.Writer) int {
	cmd := ""
	if len(args) > 0 {
		cmd = args[0]
	}
	if len(args) > 1 {
		fmt.Fprint(stderr, usage)
		return 2
	}
	switch cmd {
	case "", "serve":
		return serve(ctx, getenv, stderr)
	case "secret":
		return secret(stdout, stderr)
	case "check":
		return check(getenv, stdout)
	case "help", "-h", "-help", "--help":
		fmt.Fprint(stdout, usage)
		return 0
	default:
		fmt.Fprint(stderr, usage)
		return 2
	}
}

func secret(stdout, stderr io.Writer) int {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		fmt.Fprintf(stderr, "amarchy-relay: can't make a secret: %v\n", err)
		return 1
	}
	fmt.Fprintln(stdout, base64.RawURLEncoding.EncodeToString(b))
	return 0
}

func check(getenv func(string) string, stdout io.Writer) int {
	cfg, err := relay.FromEnv(getenv)
	fmt.Fprintln(stdout, "amarchy-relay check")
	for _, line := range cfg.Summary() {
		fmt.Fprintln(stdout, "  "+line)
	}
	var cerr *relay.ConfigError
	if errors.As(err, &cerr) {
		fmt.Fprintln(stdout, "It can't start:")
		for _, p := range cerr.Problems {
			fmt.Fprintln(stdout, "  - "+p)
		}
		return 2
	}
	if cfg.APNs == nil && cfg.FCM == nil {
		fmt.Fprintln(stdout, "It can start, but sends nowhere yet: set APNS_KEY (Apple) or FCM_PROJECT (Google).")
	} else {
		fmt.Fprintln(stdout, "It can start.")
	}
	return 0
}

func serve(ctx context.Context, getenv func(string) string, stderr io.Writer) int {
	cfg, err := relay.FromEnv(getenv)
	var cerr *relay.ConfigError
	if errors.As(err, &cerr) {
		fmt.Fprintln(stderr, "amarchy-relay can't start:")
		for _, p := range cerr.Problems {
			fmt.Fprintln(stderr, "  - "+p)
		}
		fmt.Fprintln(stderr, "(`amarchy-relay check` says what's set.)")
		return 2
	}
	cfg.Logger = log.New(stderr, "", log.LstdFlags|log.LUTC)
	r, err := relay.New(*cfg)
	if err != nil {
		fmt.Fprintf(stderr, "amarchy-relay can't start: %v\n", err)
		return 2
	}
	srv := r.Server()
	ln, err := net.Listen("tcp", cfg.Listen)
	if err != nil {
		fmt.Fprintf(stderr, "amarchy-relay can't listen on %s: %v\n", cfg.Listen, err)
		return 1
	}
	apns, fcm := r.Health()
	cfg.Logger.Printf("amarchy-relay listening on %s for %s (apns %s, fcm %s)", ln.Addr(), cfg.URL, onOff(apns), onOff(fcm))

	done := make(chan error, 1)
	go func() { done <- srv.Serve(ln) }()
	select {
	case err := <-done:
		cfg.Logger.Printf("amarchy-relay stopped: %v", err)
		return 1
	case <-ctx.Done():
	}
	// Stop taking requests, and let the ones under way finish.
	cfg.Logger.Print("amarchy-relay stopping")
	sctx, cancel := context.WithTimeout(context.Background(), shutdownWait)
	defer cancel()
	if err := srv.Shutdown(sctx); err != nil {
		cfg.Logger.Printf("amarchy-relay: pushes still under way were cut: %v", err)
		_ = srv.Close()
		return 1
	}
	if err := <-done; err != nil && !errors.Is(err, http.ErrServerClosed) {
		cfg.Logger.Printf("amarchy-relay stopped: %v", err)
		return 1
	}
	return 0
}

func onOff(b bool) string {
	if b {
		return "on"
	}
	return "off"
}

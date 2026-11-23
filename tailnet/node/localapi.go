package node

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// ServeLocalAPI serves Tailscale's own LocalAPI for the node on a unix
// socket (0600, in a 0700 folder: this user only), as tailscaled serves the
// system's: Tailscale's CLI (`amarchy-tailnet cli`, or `tailscale --socket`)
// and amarchy talk to it the same way. Until ctx ends.
func (n *Node) ServeLocalAPI(ctx context.Context, socket string) error {
	if err := os.MkdirAll(filepath.Dir(socket), 0o700); err != nil {
		return err
	}
	_ = os.Remove(socket) // one left by a node that ended
	old := umask(0o077)
	ln, err := net.Listen("unix", socket)
	umask(old)
	if err != nil {
		return err
	}
	_ = os.Chmod(socket, 0o600)
	srv := &http.Server{Handler: http.HandlerFunc(n.passLocalAPI), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		srv.Close()
		os.Remove(socket)
	}()
	if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// passLocalAPI hands a request to the node's own LocalAPI and its answer
// back, as it comes (a watch of the node's bus streams).
func (n *Node) passLocalAPI(w http.ResponseWriter, r *http.Request) {
	out := r.Clone(r.Context())
	out.RequestURI = ""
	out.URL.Scheme = "http"
	out.URL.Host = "local-tailscaled.sock"
	out.Host = "local-tailscaled.sock"
	res, err := n.lc.DoLocalRequest(out)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
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
			if _, werr := w.Write(buf[:m]); werr != nil {
				return
			}
			if flush != nil {
				flush.Flush()
			}
		}
		if err != nil {
			if err != io.EOF {
				return
			}
			return
		}
	}
}

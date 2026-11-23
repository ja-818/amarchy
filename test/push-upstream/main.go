// A fake APNs and FCM for test/push-phone.py: what the relay sends them,
// one JSON line each on stdout ({"path", "headers", "body" (base64)}).
// HTTP/2 without TLS (APNs speaks HTTP/2 only, and the relay asks an http://
// APNS_URL for it with prior knowledge) and HTTP/1 both. FCM's OAuth token
// endpoint (/token) gives a token. Its address is the first line it prints.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
)

func main() {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Printf("http://%s\n", ln.Addr())
	var mu sync.Mutex
	enc := json.NewEncoder(os.Stdout)
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/token" {
			io.WriteString(w, `{"access_token":"ya29.test","expires_in":3600,"token_type":"Bearer"}`)
			return
		}
		h := map[string]string{"proto": r.Proto}
		for k, v := range r.Header {
			h[strings.ToLower(k)] = strings.Join(v, ", ")
		}
		mu.Lock()
		enc.Encode(map[string]any{"path": r.URL.Path, "headers": h, "body": body})
		mu.Unlock()
		if strings.Contains(r.URL.Path, "/messages:send") {
			io.WriteString(w, `{"name":"projects/p/messages/1"}`)
		}
	})}
	srv.Protocols = new(http.Protocols)
	srv.Protocols.SetHTTP1(true)
	srv.Protocols.SetUnencryptedHTTP2(true)
	srv.Serve(ln)
}

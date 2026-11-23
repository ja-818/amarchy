package relay

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/netip"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"
)

const (
	maxRegister = 4096
	maxAPNsHex  = 200
	minAPNsHex  = 64
	maxFCMToken = 4096
	maxApp      = 255

	// Repo is where the relay's source is: anyone can read what it does.
	Repo = "https://github.com/ja-818/amarchy"
)

// Relay is the push relay: its handler and what it sends with.
type Relay struct {
	cfg    Config
	sealer *sealer
	apns   *apnsSender // nil: off
	fcm    *fcmSender  // nil: off
	log    *log.Logger
	now    func() time.Time

	devices, registers, pushes *limiter
	origins                    []string // what machines may sign for: its address, then its older ones
}

// New makes a relay from a checked configuration (FromEnv).
func New(cfg Config) (*Relay, error) {
	if cfg.URL == "" {
		return nil, errors.New("relay: no URL")
	}
	if len(cfg.Secret) < MinSecretLen {
		return nil, errors.New("relay: the secret is too short")
	}
	if cfg.UpstreamTimeout <= 0 {
		cfg.UpstreamTimeout = DefaultUpstream
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.Logger == nil {
		cfg.Logger = log.New(os.Stderr, "", log.LstdFlags|log.LUTC)
	}
	// A limit left at zero is the default one (a zero rate never refills).
	for _, f := range []struct{ v, def *int }{
		{&cfg.Limits.DeviceBurst, &DefaultLimits.DeviceBurst}, {&cfg.Limits.DevicePerMin, &DefaultLimits.DevicePerMin},
		{&cfg.Limits.RegisterBurst, &DefaultLimits.RegisterBurst}, {&cfg.Limits.RegisterPerHour, &DefaultLimits.RegisterPerHour},
		{&cfg.Limits.PushBurst, &DefaultLimits.PushBurst}, {&cfg.Limits.PushPerMin, &DefaultLimits.PushPerMin},
	} {
		if *f.v <= 0 {
			*f.v = *f.def
		}
	}
	s, err := newSealer(cfg.Secret, cfg.OldSecrets)
	if err != nil {
		return nil, err
	}
	l := cfg.Limits
	r := &Relay{
		cfg: cfg, sealer: s, log: cfg.Logger, now: cfg.Now,
		origins:   append([]string{cfg.URL}, cfg.OldURLs...),
		devices:   newLimiter(l.DeviceBurst, l.DevicePerMin, time.Minute, maxBuckets),
		registers: newLimiter(l.RegisterBurst, l.RegisterPerHour, time.Hour, maxBuckets),
		pushes:    newLimiter(l.PushBurst, l.PushPerMin, time.Minute, maxBuckets),
	}
	if cfg.APNs.ready() {
		r.apns = newAPNs(cfg.APNs, cfg.UpstreamTimeout, cfg.Now)
	}
	if cfg.FCM != nil && cfg.FCM.Project != "" {
		client := cfg.HTTPClient
		if client == nil {
			client = &http.Client{Timeout: cfg.UpstreamTimeout, Transport: &http.Transport{
				Proxy:                 http.ProxyFromEnvironment,
				TLSHandshakeTimeout:   cfg.UpstreamTimeout,
				ResponseHeaderTimeout: cfg.UpstreamTimeout,
				IdleConnTimeout:       2 * time.Minute,
				ForceAttemptHTTP2:     true,
			}}
		}
		r.fcm = &fcmSender{cfg: cfg.FCM, client: client, now: cfg.Now}
	}
	return r, nil
}

// Handler serves the relay's API.
func (r *Relay) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", r.root)
	mux.HandleFunc("GET /v1/health", r.health)
	mux.HandleFunc("POST /v1/register", r.register)
	mux.HandleFunc("POST /v1/push/{handle}", r.push)
	return r.logged(mux)
}

// Server is an http.Server for the handler, with every timeout set: a slow
// or stuck client can't hold a connection, nor send a large header.
func (r *Relay) Server() *http.Server {
	return &http.Server{
		Addr:              r.cfg.Listen,
		Handler:           r.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		// Room for an upstream call, its one retry and a token fetch.
		WriteTimeout:   r.pushBudget() + 10*time.Second,
		IdleTimeout:    90 * time.Second,
		MaxHeaderBytes: 16 << 10,
		ErrorLog:       r.log,
	}
}

func (r *Relay) pushBudget() time.Duration { return 3 * r.cfg.UpstreamTimeout }

// Health says which push services this relay sends to.
func (r *Relay) Health() (apns, fcm bool) { return r.apns != nil, r.fcm != nil }

// entry is a request's log line, filled in by its handler.
type entry struct {
	kind     string
	device   string
	upstream int
	why      string
}

type entryKey struct{}

func entryOf(req *http.Request) *entry {
	if e, ok := req.Context().Value(entryKey{}).(*entry); ok {
		return e
	}
	return &entry{}
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	if w.status == 0 {
		w.status = code
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	return w.ResponseWriter.Write(b)
}

func (w *statusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

// logged writes one line a request: what it was and how it went. Never a
// token, a handle, a payload or a JWT: a device is its handle's hash.
func (r *Relay) logged(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		start := time.Now()
		e := &entry{kind: "other"}
		sw := &statusWriter{ResponseWriter: w}
		next.ServeHTTP(sw, req.WithContext(context.WithValue(req.Context(), entryKey{}, e)))
		status := sw.status
		if status == 0 {
			status = http.StatusOK
		}
		device, upstream := "-", "-"
		if e.device != "" {
			device = e.device
		}
		if e.upstream != 0 {
			upstream = strconv.Itoa(e.upstream)
		}
		line := fmt.Sprintf("%s %s %d device=%s upstream=%s %dms", req.Method, e.kind, status, device, upstream,
			time.Since(start).Milliseconds())
		if e.why != "" {
			line += " why=" + strconv.Quote(e.why)
		}
		r.log.Print(line)
	})
}

// fail answers a refusal in words, and keeps them for the log.
func fail(w http.ResponseWriter, req *http.Request, status int, msg string) {
	entryOf(req).why = msg
	w.Header().Set("Cache-Control", "no-store")
	http.Error(w, msg, status)
}

func tooMany(w http.ResponseWriter, req *http.Request, wait time.Duration, msg string) {
	w.Header().Set("Retry-After", strconv.Itoa(retryAfter(wait)))
	fail(w, req, http.StatusTooManyRequests, msg)
}

func (r *Relay) root(w http.ResponseWriter, req *http.Request) {
	entryOf(req).kind = "root"
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	fmt.Fprintf(w, "amarchy-relay: a Web Push service in front of APNs and FCM for amarchy's phone apps; "+
		"it carries notifications it can't read. %s\n", Repo)
}

func (r *Relay) health(w http.ResponseWriter, req *http.Request) {
	entryOf(req).kind = "health"
	apns, fcm := r.Health()
	writeJSON(w, http.StatusOK, struct {
		OK   bool `json:"ok"`
		APNs bool `json:"apns"`
		FCM  bool `json:"fcm"`
	}{true, apns, fcm})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// clientAddr is who's asking, for the per-address limits: behind a proxy
// that names it in a header of its own (Fly's Fly-Client-IP), that header;
// behind one that appends it (Cloud Run, Caddy, nginx), the last
// X-Forwarded-For entry. An IPv6 address counts as its /64, which one
// client usually has whole.
func (r *Relay) clientAddr(req *http.Request) string {
	if h := r.cfg.ClientIPHeader; h != "" {
		if ip, err := netip.ParseAddr(strings.TrimSpace(req.Header.Get(h))); err == nil {
			return addrKey(ip)
		}
	} else if r.cfg.TrustProxy {
		if all := req.Header.Values("X-Forwarded-For"); len(all) > 0 {
			last := all[len(all)-1]
			if i := strings.LastIndexByte(last, ','); i >= 0 {
				last = last[i+1:]
			}
			if ip, err := netip.ParseAddr(strings.TrimSpace(last)); err == nil {
				return addrKey(ip)
			}
		}
	}
	host, _, err := net.SplitHostPort(req.RemoteAddr)
	if err != nil {
		host = req.RemoteAddr
	}
	if ip, err := netip.ParseAddr(host); err == nil {
		return addrKey(ip)
	}
	return host
}

func addrKey(ip netip.Addr) string {
	ip = ip.Unmap().WithZone("")
	if ip.Is6() {
		p, _ := ip.Prefix(64)
		return p.String()
	}
	return ip.String()
}

type registration struct {
	Platform  string `json:"platform"`
	Token     string `json:"token"`
	App       string `json:"app"`
	ServerKey string `json:"server_key"`
}

func (r *Relay) register(w http.ResponseWriter, req *http.Request) {
	entryOf(req).kind = "register"
	if ok, wait := r.registers.allow(r.clientAddr(req), r.now()); !ok {
		tooMany(w, req, wait, "too many registrations from your address: try again later")
		return
	}
	var reg registration
	err := json.NewDecoder(http.MaxBytesReader(w, req.Body, maxRegister)).Decode(&reg)
	var tooBig *http.MaxBytesError
	switch {
	case errors.As(err, &tooBig):
		fail(w, req, http.StatusRequestEntityTooLarge, "a registration is 4 KB at most")
		return
	case err != nil:
		fail(w, req, http.StatusBadRequest, `the body must be JSON: {"platform", "token", "app", "server_key"}`)
		return
	}
	d, rerr := r.checkRegistration(reg)
	if rerr != nil {
		fail(w, req, rerr.status, rerr.msg)
		return
	}
	d.Issued = r.now()
	h, err := r.sealer.seal(d)
	if err != nil {
		fail(w, req, http.StatusInternalServerError, "the relay couldn't make an endpoint")
		return
	}
	entryOf(req).device = deviceID(h)
	writeJSON(w, http.StatusOK, map[string]string{"endpoint": r.cfg.URL + "/v1/push/" + h})
}

func (r *Relay) checkRegistration(reg registration) (Device, *reqError) {
	d := Device{Platform: reg.Platform, App: strings.TrimSpace(reg.App)}
	switch reg.Platform {
	case "apns", "apns-sandbox":
		if r.apns == nil {
			return d, refuse(http.StatusServiceUnavailable, "this relay doesn't send to APNs (it has no APNs key)")
		}
		tok := strings.ToLower(strings.TrimSpace(reg.Token))
		if n := len(tok); n < minAPNsHex || n > maxAPNsHex || n%2 != 0 || !isHex(tok) {
			return d, refuse(http.StatusBadRequest, "an APNs token is the device token in hex (64 to 200 characters)")
		}
		d.Token = tok
		if !slices.Contains(r.cfg.APNs.Topics, d.App) {
			return d, refuse(http.StatusBadRequest, "this relay doesn't send for that app (APNS_TOPICS)")
		}
	case "fcm":
		if r.fcm == nil {
			return d, refuse(http.StatusServiceUnavailable, "this relay doesn't send to FCM (it has no Firebase project)")
		}
		tok := strings.TrimSpace(reg.Token)
		if n := len(tok); n < 1 || n > maxFCMToken || !isPrintable(tok) {
			return d, refuse(http.StatusBadRequest, "an FCM token is 1 to 4096 printable characters")
		}
		d.Token = tok
		if apps := r.cfg.FCM.Apps; len(apps) > 0 && !slices.Contains(apps, d.App) {
			return d, refuse(http.StatusBadRequest, "this relay doesn't send for that app (FCM_APPS)")
		}
	default:
		return d, refuse(http.StatusBadRequest, `platform must be "apns", "apns-sandbox" or "fcm"`)
	}
	if d.App == "" || len(d.App) > maxApp || !isPrintable(d.App) {
		return d, refuse(http.StatusBadRequest, "app must be the app's id (its bundle id or package name)")
	}
	key, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(strings.TrimSpace(reg.ServerKey), "="))
	if err == nil {
		// A point on P-256, not just 65 bytes: crypto/ecdh checks it.
		_, err = ecdh.P256().NewPublicKey(key)
	}
	if err != nil || len(key) != serverKeyLen {
		return d, refuse(http.StatusBadRequest, "server_key must be the machine's VAPID key: a P-256 public key, 65 bytes, base64url")
	}
	d.ServerKey = key
	return d, nil
}

func isHex(s string) bool {
	_, err := hex.DecodeString(s)
	return err == nil
}

func isPrintable(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] < 0x21 || s[i] > 0x7e {
			return false
		}
	}
	return true
}

func (r *Relay) push(w http.ResponseWriter, req *http.Request) {
	e := entryOf(req)
	e.kind = "push"
	handle := req.PathValue("handle")
	e.device = deviceID(handle)
	now := r.now()
	// The address's limit first, before any work, so a flood costs little.
	if ok, wait := r.pushes.allow(r.clientAddr(req), now); !ok {
		tooMany(w, req, wait, "too many pushes from your address: try again later")
		return
	}
	d, err := r.sealer.open(handle)
	if err != nil {
		fail(w, req, http.StatusNotFound, "no such endpoint: this relay didn't make it")
		return
	}
	if rerr := checkVAPID(req.Header.Get("Authorization"), d.ServerKey, r.origins, now); rerr != nil {
		fail(w, req, rerr.status, rerr.msg)
		return
	}
	if ce := strings.TrimSpace(req.Header.Get("Content-Encoding")); !strings.EqualFold(ce, "aes128gcm") {
		fail(w, req, http.StatusUnsupportedMediaType,
			"Content-Encoding must be aes128gcm (RFC 8291): this relay only carries what it can't read")
		return
	}
	opts, rerr := parsePushHeaders(req.Header)
	if rerr != nil {
		fail(w, req, rerr.status, rerr.msg)
		return
	}
	if req.ContentLength > maxRecord {
		fail(w, req, http.StatusRequestEntityTooLarge, "a push is 2900 bytes at most")
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, req.Body, maxRecord))
	var tooBig *http.MaxBytesError
	switch {
	case errors.As(err, &tooBig):
		fail(w, req, http.StatusRequestEntityTooLarge, "a push is 2900 bytes at most")
		return
	case err != nil:
		fail(w, req, http.StatusBadRequest, "the body didn't arrive whole")
		return
	}
	if rerr := checkRecord(body); rerr != nil {
		fail(w, req, rerr.status, rerr.msg)
		return
	}
	// The device's limit last: only pushes its own machine signed count.
	if ok, wait := r.devices.allow(deviceKey(handle), now); !ok {
		tooMany(w, req, wait, "too many pushes to this device: try again later")
		return
	}

	var s sender
	switch {
	case d.Platform == "fcm" && r.fcm != nil:
		s = r.fcm
	case d.Platform != "fcm" && r.apns != nil:
		s = r.apns
	default:
		fail(w, req, http.StatusServiceUnavailable, "this relay doesn't send to "+d.Platform+" any more")
		return
	}
	ctx, cancel := context.WithTimeout(req.Context(), r.pushBudget())
	defer cancel()
	res := s.send(ctx, d, message{record: body, pushOptions: opts})
	e.upstream = res.upstream
	switch res.status {
	case http.StatusCreated:
		w.Header().Set("Location", "/v1/message/"+messageID())
		w.Header().Set("TTL", strconv.Itoa(opts.ttl))
		w.WriteHeader(http.StatusCreated)
	case http.StatusTooManyRequests:
		tooMany(w, req, res.retryAfter, res.msg)
	default:
		fail(w, req, res.status, res.msg)
	}
}

// messageID names a push in its Location (RFC 8030 5): random, as the
// relay keeps no messages to look up.
func messageID() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

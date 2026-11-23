package relay

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"sync"
	"time"
)

// Apple wants a provider token renewed between 20 and 60 minutes old.
const apnsTokenAge = 40 * time.Minute

// message is one push to forward: the record, untouched, and its options.
type message struct {
	record []byte
	pushOptions
}

// result is what the machine is told (status, words, Retry-After) and
// what the log says the upstream answered.
type result struct {
	status     int
	upstream   int
	msg        string
	retryAfter time.Duration
}

type sender interface {
	send(ctx context.Context, d Device, m message) result
}

type apnsSender struct {
	cfg    *APNsConfig
	client *http.Client
	now    func() time.Time

	mu     sync.Mutex
	token  string
	issued time.Time
}

func newAPNs(cfg *APNsConfig, timeout time.Duration, now func() time.Time) *apnsSender {
	t := &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		TLSClientConfig:       cfg.TLS,
		TLSHandshakeTimeout:   timeout,
		ResponseHeaderTimeout: timeout,
		// Short enough that a connection a NAT dropped while the instance
		// slept isn't the one a push is written to (checked on wall time).
		IdleConnTimeout:     2 * time.Minute,
		MaxIdleConnsPerHost: 4,
		HTTP2: &http.HTTP2Config{
			SendPingTimeout: 30 * time.Second,
			PingTimeout:     10 * time.Second,
		},
	}
	// APNs speaks HTTP/2 only.
	t.Protocols = new(http.Protocols)
	t.Protocols.SetHTTP2(true)
	t.Protocols.SetUnencryptedHTTP2(true) // an http:// APNS_URL (a local fake)
	return &apnsSender{cfg: cfg, client: &http.Client{Transport: t, Timeout: timeout}, now: now}
}

// providerToken is the cached JWT Apple authenticates the relay with; failed
// (the one APNs called expired) renews it unless another push already did.
func (a *apnsSender) providerToken(failed string) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := a.now()
	if a.token != "" && a.token != failed && now.Sub(a.issued) < apnsTokenAge {
		return a.token, nil
	}
	header, _ := json.Marshal(map[string]string{"alg": "ES256", "kid": a.cfg.KeyID})
	claims, _ := json.Marshal(map[string]any{"iss": a.cfg.TeamID, "iat": now.Unix()})
	tok, err := signES256(a.cfg.Key, header, claims)
	if err != nil {
		return "", err
	}
	a.token, a.issued = tok, now
	return tok, nil
}

// signES256 makes a JWT signed with a P-256 key: r and s, 32 bytes each.
func signES256(key *ecdsa.PrivateKey, header, claims []byte) (string, error) {
	unsigned := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(claims)
	digest := sha256.Sum256([]byte(unsigned))
	r, s, err := ecdsa.Sign(rand.Reader, key, digest[:])
	if err != nil {
		return "", err
	}
	sig := make([]byte, 64)
	r.FillBytes(sig[:32])
	s.FillBytes(sig[32:])
	return unsigned + "." + base64.RawURLEncoding.EncodeToString(sig), nil
}

// apnsBody is the notification the phone's Notification Service Extension
// replaces with what it decrypts from p; without one it's all that shows.
func apnsBody(record []byte) []byte {
	return []byte(`{"aps":{"alert":{"title":"Amarchy","body":"Something needs you"},"mutable-content":1,"sound":"default"},"p":"` +
		base64.RawURLEncoding.EncodeToString(record) + `"}`)
}

func (a *apnsSender) send(ctx context.Context, d Device, m message) result {
	base := a.cfg.URL
	if d.Platform == "apns-sandbox" {
		base = a.cfg.SandboxURL
	}
	body := apnsBody(m.record)
	priority := "10"
	if m.urgency == "very-low" || m.urgency == "low" {
		priority = "5"
	}
	expiration := "0" // now or never
	if m.ttl > 0 {
		expiration = strconv.FormatInt(a.now().Unix()+int64(m.ttl), 10)
	}

	failed := ""
	for attempt := 0; ; attempt++ {
		tok, err := a.providerToken(failed)
		if err != nil {
			return result{status: http.StatusBadGateway, msg: "the relay couldn't sign its APNs token"}
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/3/device/"+d.Token, bytes.NewReader(body))
		if err != nil {
			return result{status: http.StatusBadGateway, msg: "the relay's APNs address is wrong"}
		}
		req.Header.Set("Authorization", "bearer "+tok)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("apns-topic", d.App)
		req.Header.Set("apns-push-type", "alert")
		req.Header.Set("apns-priority", priority)
		req.Header.Set("apns-expiration", expiration)
		if m.topic != "" {
			req.Header.Set("apns-collapse-id", m.topic)
		}
		resp, err := a.client.Do(req)
		if err != nil {
			// Never err itself: its URL has the device token in it.
			return result{status: http.StatusBadGateway, msg: "APNs " + netFailure(ctx, err)}
		}
		reason := apnsReason(resp)
		code := resp.StatusCode
		switch {
		case code == http.StatusOK:
			return result{status: http.StatusCreated, upstream: code}
		case code == http.StatusGone,
			code == http.StatusBadRequest && (reason == "BadDeviceToken" || reason == "DeviceTokenNotForTopic"):
			return result{status: http.StatusGone, upstream: code, msg: "APNs says this device is gone (" + reason + ")"}
		case code == http.StatusForbidden && reason == "ExpiredProviderToken" && attempt == 0:
			failed = tok
			continue
		case code == http.StatusTooManyRequests:
			return result{status: http.StatusTooManyRequests, upstream: code, msg: "APNs says too many pushes to this device",
				retryAfter: upstreamRetryAfter(resp, time.Minute)}
		case code >= 400 && code < 500:
			return result{status: http.StatusBadGateway, upstream: code, msg: fmt.Sprintf("APNs refused it: %d %s", code, reason)}
		default:
			return result{status: http.StatusBadGateway, upstream: code, msg: fmt.Sprintf("APNs failed: %d %s", code, reason)}
		}
	}
}

// apnsReason reads APNs' {"reason"} and closes the body. Only a plain word
// is kept: it goes in the log and back to the machine.
func apnsReason(resp *http.Response) string {
	defer resp.Body.Close()
	var e struct {
		Reason string `json:"reason"`
	}
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	_ = json.Unmarshal(b, &e)
	return word(e.Reason)
}

// word keeps s if it's one plain identifier (APNs' reasons, FCM's codes),
// so nothing an upstream echoes back can carry a token into a log.
func word(s string) string {
	if len(s) == 0 || len(s) > 64 {
		return ""
	}
	for _, c := range s {
		if !(c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '_') {
			return ""
		}
	}
	return s
}

// upstreamRetryAfter is the upstream's Retry-After in seconds, or def.
func upstreamRetryAfter(resp *http.Response, def time.Duration) time.Duration {
	if n, err := strconv.Atoi(resp.Header.Get("Retry-After")); err == nil && n > 0 && n <= 24*3600 {
		return time.Duration(n) * time.Second
	}
	return def
}

// netFailure says how a call failed without the error's text (which names
// the URL, and APNs' URL has the token).
func netFailure(ctx context.Context, err error) string {
	if ctx.Err() != nil || isTimeout(err) {
		return "didn't answer in time"
	}
	return "couldn't be reached"
}

func isTimeout(err error) bool {
	var t interface{ Timeout() bool }
	return errors.As(err, &t) && t.Timeout()
}

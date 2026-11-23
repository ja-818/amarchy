package relay

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"
)

const notification = `{"title": "Fix the login", "body": "Asks: Allow Bash: npm test?\nHouston Os", ` +
	`"tag": "houston-os-fix-login", "url": "/#/s/houston-os-fix-login", "ask": "houston-os-fix-login", "waiting": 2, ` +
	`"server": "https://amarchy.example.ts.net", "session": "houston-os-fix-login", "sound": "chime", ` +
	`"actions": [{"label": "Allow", "path": "/api/session/houston-os-fix-login/answer", "body": {"request_id": "r1", "choice": "allow"}}]}`

// assertQuiet fails when the log has any of what it must never hold.
func assertQuiet(t *testing.T, logs string, secrets map[string]string) {
	t.Helper()
	for what, s := range secrets {
		if s != "" && strings.Contains(logs, s) {
			t.Errorf("the log has the %s in it:\n%s", what, logs)
		}
	}
}

func TestEndToEndAPNs(t *testing.T) {
	e := newEnv(t, nil)
	p := newPhone(t)
	token := apnsToken()
	endpoint := e.register("apns", token)
	record := p.encrypt(t, notification)
	topic := "aG91c3Rvbi1vcy1maXgtbG9n" // 24 chars, base64url
	jwt := e.machine.jwt(e.url, time.Now().Add(12*time.Hour))
	auth := e.machine.authWith(jwt)
	a := e.push(endpoint, record, map[string]string{"Topic": topic, "Authorization": auth})
	if a.status != http.StatusCreated {
		t.Fatalf("push: %d %s", a.status, a.body)
	}
	if !strings.HasPrefix(a.header.Get("Location"), "/v1/message/") || a.header.Get("TTL") != "86400" {
		t.Fatalf("201 without its Location or TTL: %v", a.header)
	}

	calls := e.apns.got()
	if len(calls) != 1 || len(e.sandbox.got()) != 0 {
		t.Fatalf("APNs got %d pushes, the sandbox %d", len(calls), len(e.sandbox.got()))
	}
	c := calls[0]
	if c.proto != 2 {
		t.Errorf("APNs was spoken to in HTTP/%d", c.proto)
	}
	if c.path != "/3/device/"+token {
		t.Errorf("path %q", c.path)
	}
	want := map[string]string{
		"apns-topic": testApp, "apns-push-type": "alert", "apns-priority": "10", "apns-collapse-id": topic,
		"content-type": "application/json",
	}
	for k, v := range want {
		if got := c.header.Get(k); got != v {
			t.Errorf("%s: %q, want %q", k, got, v)
		}
	}
	exp, _ := strconv.ParseInt(c.header.Get("apns-expiration"), 10, 64)
	if d := exp - time.Now().Unix() - 86400; d < -5 || d > 5 {
		t.Errorf("apns-expiration %d isn't now + TTL", exp)
	}
	wantBody := `{"aps":{"alert":{"title":"Amarchy","body":"Something needs you"},"mutable-content":1,"sound":"default"},"p":"` +
		b64(record) + `"}`
	if string(c.body) != wantBody {
		t.Fatalf("APNs body:\n%s\nwant:\n%s", c.body, wantBody)
	}

	// What the phone's extension gets is the machine's record, byte for
	// byte, and only the phone reads it.
	var got struct{ P string }
	json.Unmarshal(c.body, &got)
	p2, err := base64.RawURLEncoding.DecodeString(got.P)
	if err != nil || !bytes.Equal(p2, record) {
		t.Fatal("p isn't the record the machine sent")
	}
	plain, err := decryptRecord(p.key, p.auth, p2)
	if err != nil || string(plain) != notification {
		t.Fatalf("the phone read %q (%v)", plain, err)
	}

	// The records bin/amarchy made decrypt on the phone after the relay too.
	for _, v := range loadVectors(t) {
		if v.Plaintext == nil {
			continue
		}
		a := e.push(endpoint, v.record, nil)
		if a.status != http.StatusCreated {
			t.Fatalf("%s: %d %s", v.Name, a.status, a.body)
		}
		calls := e.apns.got()
		var got struct{ P string }
		json.Unmarshal(calls[len(calls)-1].body, &got)
		plain, err := decryptRecord(v.privateKey, v.auth, b64d(t, got.P))
		if err != nil || string(plain) != *v.Plaintext {
			t.Fatalf("%s: the phone read %q (%v)", v.Name, plain, err)
		}
		if n := len(calls[len(calls)-1].body); n > 4096 {
			t.Fatalf("%s: %d bytes is over APNs' 4 KB", v.Name, n)
		}
	}

	logs := e.logs.String()
	t.Logf("the relay's log:\n%s", logs)
	if !strings.Contains(logs, "POST register 200 device="+deviceID(handleOf(endpoint))) ||
		!strings.Contains(logs, "POST push 201 device="+deviceID(handleOf(endpoint))+" upstream=200") {
		t.Errorf("the log doesn't say what happened:\n%s", logs)
	}
	assertQuiet(t, logs, map[string]string{
		"plaintext": "Fix the login", "token": token, "handle": handleOf(endpoint), "JWT": jwt,
		"record": b64(record), "provider token": c.token,
	})
}

func TestEndToEndAPNsSandbox(t *testing.T) {
	e := newEnv(t, nil)
	p := newPhone(t)
	token := apnsToken()
	endpoint := e.register("apns-sandbox", strings.ToUpper(token)) // Apple's hex in any case
	a := e.push(endpoint, p.encrypt(t, notification), map[string]string{"Urgency": "low", "TTL": "0", "Topic": ""})
	if a.status != http.StatusCreated || a.header.Get("TTL") != "0" {
		t.Fatalf("push: %d %s %v", a.status, a.body, a.header)
	}
	calls := e.sandbox.got()
	if len(calls) != 1 || len(e.apns.got()) != 0 {
		t.Fatalf("the sandbox got %d, production %d", len(calls), len(e.apns.got()))
	}
	c := calls[0]
	if c.path != "/3/device/"+token || c.header.Get("apns-priority") != "5" ||
		c.header.Get("apns-expiration") != "0" || c.header.Get("apns-collapse-id") != "" {
		t.Fatalf("sandbox push: %s %v", c.path, c.header)
	}
}

func TestEndToEndFCM(t *testing.T) {
	e := newEnv(t, nil)
	p := newPhone(t)
	token := "fcm-token_" + strings.Repeat("Ab1:", 30)
	endpoint := e.register("fcm", token)
	record := p.encrypt(t, notification)
	jwt := e.machine.jwt(e.url, time.Now().Add(12*time.Hour))
	auth := e.machine.authWith(jwt)
	for i := 0; i < 2; i++ {
		a := e.push(endpoint, record, map[string]string{"Topic": "abc_DEF-123", "TTL": "3600", "Authorization": auth})
		if a.status != http.StatusCreated || a.header.Get("TTL") != "3600" {
			t.Fatalf("push: %d %s", a.status, a.body)
		}
	}
	calls := e.google.got()
	if len(calls) != 2 {
		t.Fatalf("FCM got %d", len(calls))
	}
	if grants, _ := e.google.counts(); grants != 1 {
		t.Errorf("the access token was fetched %d times, not kept", grants)
	}
	m := calls[0].msg.Message
	if m.Token != token || m.Android.Priority != "HIGH" || m.Android.TTL != "3600s" || m.Android.CollapseKey != "abc_DEF-123" ||
		len(m.Data) != 1 {
		t.Fatalf("FCM message: %s", calls[0].body)
	}
	if got := b64d(t, m.Data["p"]); !bytes.Equal(got, record) {
		t.Fatal("data.p isn't the record the machine sent")
	}
	plain, err := decryptRecord(p.key, p.auth, b64d(t, m.Data["p"]))
	if err != nil || string(plain) != notification {
		t.Fatalf("the phone read %q (%v)", plain, err)
	}
	assertQuiet(t, e.logs.String(), map[string]string{
		"plaintext": "Fix the login", "token": token, "handle": handleOf(endpoint), "JWT": jwt,
		"record": b64(record), "access token": "grant-1",
	})

	// No Topic: no collapse_key at all.
	e.push(endpoint, record, nil)
	calls = e.google.got()
	if bytes.Contains(calls[len(calls)-1].body, []byte("collapse_key")) {
		t.Fatalf("a collapse_key without a Topic: %s", calls[len(calls)-1].body)
	}
}

func TestFCMMetadataServer(t *testing.T) {
	e := newEnv(t, func(v map[string]string) { delete(v, "FCM_CREDENTIALS"); delete(v, "FCM_TOKEN_URL") })
	endpoint := e.register("fcm", "tok")
	a := e.push(endpoint, newPhone(t).encrypt(t, notification), nil)
	if a.status != http.StatusCreated {
		t.Fatalf("push: %d %s", a.status, a.body)
	}
	if grants, metas := e.google.counts(); metas != 1 || grants != 0 {
		t.Fatalf("metadata tokens %d, grants %d", metas, grants)
	}
}

func TestFCMUnauthorizedRenewsOnce(t *testing.T) {
	e := newEnv(t, nil)
	endpoint := e.register("fcm", "tok")
	rec := newPhone(t).encrypt(t, notification)
	if a := e.push(endpoint, rec, nil); a.status != http.StatusCreated {
		t.Fatalf("push: %d %s", a.status, a.body)
	}
	// FCM stops taking the cached token: it's dropped, a new one works.
	e.google.with(func(g *fakeGoogle) { g.reject["grant-1"] = true })
	if a := e.push(endpoint, rec, nil); a.status != http.StatusCreated {
		t.Fatalf("push after a 401: %d %s", a.status, a.body)
	}
	if grants, _ := e.google.counts(); grants != 2 {
		t.Fatalf("grants: %d", grants)
	}
	// Every token refused: one retry, then 502.
	e.google.with(func(g *fakeGoogle) { g.reject["grant-2"], g.reject["grant-3"] = true, true })
	if a := e.push(endpoint, rec, nil); a.status != http.StatusBadGateway {
		t.Fatalf("push with every token refused: %d %s", a.status, a.body)
	}
	// The token server failing is a 502 too.
	e.google.with(func(g *fakeGoogle) { g.tokenErr = http.StatusBadRequest })
	if a := e.push(endpoint, rec, nil); a.status != http.StatusBadGateway || !strings.Contains(a.body, "access token") {
		t.Fatalf("push with no token: %d %s", a.status, a.body)
	}
}

func TestAPNsExpiredProviderTokenRenews(t *testing.T) {
	e := newEnv(t, nil)
	endpoint := e.register("apns", apnsToken())
	e.apns.set(func(n int, c apnsCall, w http.ResponseWriter) bool {
		if n == 0 {
			w.WriteHeader(http.StatusForbidden)
			fmt.Fprint(w, `{"reason":"ExpiredProviderToken"}`)
			return true
		}
		return false
	})
	a := e.push(endpoint, newPhone(t).encrypt(t, notification), nil)
	if a.status != http.StatusCreated {
		t.Fatalf("push: %d %s", a.status, a.body)
	}
	calls := e.apns.got()
	if len(calls) != 2 || calls[1].token == calls[0].token {
		t.Fatalf("%d calls; renewed: %v", len(calls), len(calls) == 2 && calls[1].token != calls[0].token)
	}
	// Always expired: one retry, then 502.
	e.apns.answer(http.StatusForbidden, "ExpiredProviderToken")
	if a := e.push(endpoint, newPhone(t).encrypt(t, notification), nil); a.status != http.StatusBadGateway {
		t.Fatalf("push: %d %s", a.status, a.body)
	}
}

func TestAPNsProviderTokenCached(t *testing.T) {
	e := newEnv(t, nil)
	endpoint := e.register("apns", apnsToken())
	for i := 0; i < 3; i++ {
		e.push(endpoint, newPhone(t).encrypt(t, notification), nil)
	}
	calls := e.apns.got()
	if len(calls) != 3 || calls[0].token != calls[1].token || calls[1].token != calls[2].token {
		t.Fatal("the provider token isn't kept between pushes")
	}
	// Past its age it's renewed.
	e.relay.apns.mu.Lock()
	e.relay.apns.issued = time.Now().Add(-apnsTokenAge - time.Second)
	e.relay.apns.mu.Unlock()
	e.push(endpoint, newPhone(t).encrypt(t, notification), nil)
	if calls := e.apns.got(); calls[3].token == calls[2].token {
		t.Fatal("an old provider token wasn't renewed")
	}
}

func TestUpstreamAnswers(t *testing.T) {
	cases := []struct {
		name     string
		platform string
		status   int
		reason   string // APNs' reason, or FCM's whole body
		header   []string
		want     int
	}{
		{"APNs 410 Unregistered", "apns", 410, "Unregistered", nil, 410},
		{"APNs BadDeviceToken", "apns", 400, "BadDeviceToken", nil, 410},
		{"APNs DeviceTokenNotForTopic", "apns", 400, "DeviceTokenNotForTopic", nil, 410},
		{"APNs other 400", "apns", 400, "PayloadTooLarge", nil, 502},
		{"APNs InvalidProviderToken", "apns", 403, "InvalidProviderToken", nil, 502},
		{"APNs 429", "apns", 429, "TooManyRequests", []string{"Retry-After", "17"}, 429},
		{"APNs 500", "apns", 500, "InternalServerError", nil, 502},
		{"APNs 503", "apns", 503, "ServiceUnavailable", nil, 502},
		{"FCM UNREGISTERED", "fcm", 404, fcmErrorBody(404, "NOT_FOUND", "UNREGISTERED"), nil, 410},
		{"FCM 404", "fcm", 404, `{}`, nil, 410},
		{"FCM UNREGISTERED as 400", "fcm", 400, fcmErrorBody(400, "INVALID_ARGUMENT", "UNREGISTERED"), nil, 410},
		{"FCM bad token", "fcm", 400, `{"error":{"code":400,"message":"The registration token is not a valid FCM registration token","status":"INVALID_ARGUMENT",` +
			`"details":[{"@type":"type.googleapis.com/google.firebase.fcm.v1.FcmError","errorCode":"INVALID_ARGUMENT"}]}}`, nil, 410},
		{"FCM token field", "fcm", 400, `{"error":{"code":400,"message":"Invalid value","status":"INVALID_ARGUMENT",` +
			`"details":[{"@type":"type.googleapis.com/google.rpc.BadRequest","fieldViolations":[{"field":"message.token","description":"Invalid registration token"}]}]}}`, nil, 410},
		{"FCM bad message", "fcm", 400, `{"error":{"code":400,"message":"Invalid value at 'message.android.ttl'","status":"INVALID_ARGUMENT"}}`, nil, 502},
		{"FCM SENDER_ID_MISMATCH", "fcm", 403, fcmErrorBody(403, "PERMISSION_DENIED", "SENDER_ID_MISMATCH"), nil, 502},
		{"FCM 429", "fcm", 429, fcmErrorBody(429, "RESOURCE_EXHAUSTED", "QUOTA_EXCEEDED"), nil, 429},
		{"FCM 500", "fcm", 500, fcmErrorBody(500, "INTERNAL", "INTERNAL"), nil, 502},
		{"FCM 503", "fcm", 503, `oops`, nil, 502},
	}
	e := newEnv(t, nil)
	rec := newPhone(t).encrypt(t, notification)
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			token := apnsToken()
			if c.platform == "apns" {
				e.apns.answer(c.status, c.reason, c.header...)
			} else {
				token = "fcm-" + token
				e.google.answer(c.status, c.reason)
			}
			endpoint := e.register(c.platform, token)
			a := e.push(endpoint, rec, nil)
			if a.status != c.want {
				t.Fatalf("%d %s, want %d", a.status, a.body, c.want)
			}
			if c.want == 429 {
				ra, err := strconv.Atoi(a.header.Get("Retry-After"))
				if err != nil || ra < 1 {
					t.Fatalf("429 with Retry-After %q", a.header.Get("Retry-After"))
				}
				if c.platform == "apns" && ra != 17 {
					t.Fatalf("APNs' Retry-After 17 became %d", ra)
				}
			}
			if !strings.Contains(e.logs.String(), fmt.Sprintf("POST push %d device=%s upstream=%d", c.want, deviceID(handleOf(endpoint)), c.status)) {
				t.Fatalf("the log doesn't say it:\n%s", e.logs.String())
			}
			assertQuiet(t, e.logs.String()+a.body, map[string]string{"token": token, "handle": handleOf(endpoint)})
		})
	}
}

func TestUpstreamUnreachable(t *testing.T) {
	// A port nothing listens on, and an APNs that never answers.
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	dead := "https://" + ln.Addr().String()
	ln.Close()
	e := newEnv(t, func(v map[string]string) {
		v["APNS_URL"] = dead
		v["FCM_URL"] = strings.Replace(dead, "https", "http", 1)
	})
	rec := newPhone(t).encrypt(t, notification)
	for _, platform := range []string{"apns", "fcm"} {
		token := apnsToken()
		endpoint := e.register(platform, token)
		a := e.push(endpoint, rec, nil)
		if a.status != http.StatusBadGateway || !strings.Contains(a.body, "couldn't be reached") {
			t.Fatalf("%s down: %d %s", platform, a.status, a.body)
		}
		assertQuiet(t, e.logs.String()+a.body, map[string]string{"token": token, "handle": handleOf(endpoint)})
	}

	slow := newEnv(t, nil, func(c *Config) { c.UpstreamTimeout = 200 * time.Millisecond })
	slow.apns.set(func(int, apnsCall, http.ResponseWriter) bool { time.Sleep(time.Second); return false })
	token := apnsToken()
	endpoint := slow.register("apns", token)
	start := time.Now()
	a := slow.push(endpoint, rec, nil)
	if a.status != http.StatusBadGateway || !strings.Contains(a.body, "in time") || time.Since(start) > 900*time.Millisecond {
		t.Fatalf("APNs too slow: %d %s after %v", a.status, a.body, time.Since(start))
	}
	assertQuiet(t, slow.logs.String()+a.body, map[string]string{"token": token})
}

func TestPushRefusals(t *testing.T) {
	e := newEnv(t, nil)
	rec := newPhone(t).encrypt(t, notification)
	endpoint := e.register("apns", apnsToken())
	handle := handleOf(endpoint)
	other := newMachine(t)
	now := time.Now()
	good := func(exp time.Time) string { return e.machine.auth(e.url, exp) }
	raw := b64d(t, handle)
	raw[len(raw)/2] ^= 1
	tampered := b64(raw)
	// A JWT signed by another key, with the handle's k.
	forgedSig := "vapid t=" + other.jwt(e.url, now.Add(time.Hour)) + ", k=" + b64(e.machine.pub)
	parts := strings.Split(e.machine.jwt(e.url, now.Add(time.Hour)), ".")
	hs256 := "vapid t=" + b64([]byte(`{"alg":"HS256"}`)) + "." + parts[1] + "." + parts[2] + ", k=" + b64(e.machine.pub)

	cases := []struct {
		name   string
		path   string
		header map[string]string
		body   []byte
		want   int
	}{
		{"forged handle", "/v1/push/" + b64(bytes.Repeat([]byte{1}, 120)), nil, rec, 404},
		{"tampered handle", "/v1/push/" + tampered, nil, rec, 404},
		{"not base64", "/v1/push/not*base64", nil, rec, 404},
		{"empty-ish handle", "/v1/push/AAAA", nil, rec, 404},
		{"no Authorization", "", map[string]string{"Authorization": ""}, rec, 401},
		{"old WebPush scheme", "", map[string]string{"Authorization": "WebPush " + e.machine.jwt(e.url, now.Add(time.Hour))}, rec, 401},
		{"no k", "", map[string]string{"Authorization": "vapid t=" + e.machine.jwt(e.url, now.Add(time.Hour))}, rec, 401},
		{"wrong VAPID key", "", map[string]string{"Authorization": other.auth(e.url, now.Add(time.Hour))}, rec, 403},
		{"bad signature", "", map[string]string{"Authorization": forgedSig}, rec, 401},
		{"not ES256", "", map[string]string{"Authorization": hs256}, rec, 401},
		{"not a JWT", "", map[string]string{"Authorization": "vapid t=abc.def, k=" + b64(e.machine.pub)}, rec, 401},
		{"expired", "", map[string]string{"Authorization": good(now.Add(-time.Minute))}, rec, 401},
		{"exp too far", "", map[string]string{"Authorization": good(now.Add(25 * time.Hour))}, rec, 401},
		{"wrong aud", "", map[string]string{"Authorization": e.machine.auth("https://fcm.googleapis.com", now.Add(time.Hour))}, rec, 403},
		{"not aes128gcm", "", map[string]string{"Content-Encoding": "aesgcm"}, rec, 415},
		{"no Content-Encoding", "", map[string]string{"Content-Encoding": ""}, rec, 415},
		{"too big", "", nil, append(append([]byte{}, rec...), make([]byte, maxRecord+1-len(rec))...), 413},
		{"too short", "", nil, rec[:minRecord-1], 400},
		{"key id length", "", nil, withByte(rec, 20, 64), 400},
		{"key id not a point", "", nil, withByte(rec, 21, 0x02), 400},
		{"record size", "", nil, withByte(withByte(withByte(withByte(rec, 16, 0), 17, 0), 18, 0), 19, 17), 400},
		{"two records", "", nil, withByte(withByte(withByte(withByte(rec, 16, 0), 17, 0), 18, 0), 19, 18), 400},
		{"no TTL", "", map[string]string{"TTL": ""}, rec, 400},
		{"negative TTL", "", map[string]string{"TTL": "-1"}, rec, 400},
		{"TTL not a number", "", map[string]string{"TTL": "1h"}, rec, 400},
		{"TTL with a sign", "", map[string]string{"TTL": "+60"}, rec, 400},
		{"bad Urgency", "", map[string]string{"Urgency": "urgent"}, rec, 400},
		{"Topic too long", "", map[string]string{"Topic": strings.Repeat("a", 33)}, rec, 400},
		{"Topic not base64url", "", map[string]string{"Topic": "a/b+c="}, rec, 400},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			target := endpoint
			if c.path != "" {
				target = e.url + c.path
			}
			before := len(e.apns.got())
			a := e.push(target, c.body, c.header)
			if a.status != c.want {
				t.Fatalf("%d %s, want %d", a.status, a.body, c.want)
			}
			if len(e.apns.got()) != before {
				t.Fatal("a refused push went to APNs")
			}
		})
	}

	// What's allowed at the edges.
	for name, h := range map[string]map[string]string{
		"exp at 24 hours":       {"Authorization": good(now.Add(24 * time.Hour))},
		"TTL capped at 28 days": {"TTL": "999999999999"},
		"Topic of 32":           {"Topic": strings.Repeat("A", 32)},
		"Urgency very-low":      {"Urgency": "very-low"},
		"no Urgency":            {"Urgency": ""},
		"Content-Encoding case": {"Content-Encoding": "AES128GCM"},
	} {
		a := e.push(endpoint, rec, h)
		if a.status != http.StatusCreated {
			t.Fatalf("%s: %d %s", name, a.status, a.body)
		}
		if name == "TTL capped at 28 days" && a.header.Get("TTL") != strconv.Itoa(maxTTL) {
			t.Fatalf("TTL echoed %q, want the cap", a.header.Get("TTL"))
		}
	}
	if a := e.push(endpoint, append(append([]byte{}, rec...), make([]byte, maxRecord-len(rec))...), nil); a.status != http.StatusCreated {
		t.Fatalf("2900 bytes: %d %s", a.status, a.body)
	}

	// Only POST.
	if a := e.do(http.MethodGet, "/v1/push/"+handle, nil, nil); a.status != http.StatusMethodNotAllowed {
		t.Fatalf("GET a push endpoint: %d", a.status)
	}
	assertQuiet(t, e.logs.String(), map[string]string{"handle": handle})
}

func withByte(b []byte, i int, v byte) []byte {
	out := append([]byte{}, b...)
	out[i] = v
	return out
}

func TestSecrets(t *testing.T) {
	const old = "the-old-secret-it-was-made-with-0123456789"
	a := newEnv(t, func(v map[string]string) { v["RELAY_SECRET"] = old })
	rec := newPhone(t).encrypt(t, notification)
	endpoint := a.register("apns", apnsToken())

	// A relay with another secret didn't make it.
	b := newEnv(t, nil)
	b.machine = a.machine
	if r := b.push(strings.Replace(endpoint, a.url, b.url, 1), rec, nil); r.status != http.StatusNotFound {
		t.Fatalf("a handle from another secret: %d %s", r.status, r.body)
	}
	// Rotated: the new secret makes endpoints, the old one still opens.
	c := newEnv(t, func(v map[string]string) { v["RELAY_SECRETS"] = "  , " + old })
	c.machine = a.machine
	if r := c.push(strings.Replace(endpoint, a.url, c.url, 1), rec, nil); r.status != http.StatusCreated {
		t.Fatalf("a handle from the old secret: %d %s", r.status, r.body)
	}
	fresh := c.register("apns", apnsToken())
	if _, err := a.relay.sealer.open(handleOf(fresh)); err == nil {
		t.Fatal("a new endpoint was sealed with the old secret")
	}
	if r := c.push(fresh, rec, nil); r.status != http.StatusCreated {
		t.Fatalf("a new endpoint: %d %s", r.status, r.body)
	}
}

// A relay that moved (RELAY_URL changed) still takes the endpoints phones
// hold: machines sign those for its old address.
func TestMovedAddress(t *testing.T) {
	const moved = "https://relay.example.com"
	rec := newPhone(t).encrypt(t, notification)
	for _, keepOld := range []bool{true, false} {
		e := newEnv(t, func(v map[string]string) {
			if keepOld {
				v["RELAY_OLD_URLS"] = v["RELAY_URL"]
			}
			v["RELAY_URL"] = moved
		})
		a := e.registerAs("apns", apnsToken(), testApp, b64(e.machine.pub))
		var out struct{ Endpoint string }
		json.Unmarshal([]byte(a.body), &out)
		if !strings.HasPrefix(out.Endpoint, moved+"/v1/push/") {
			t.Fatalf("a new endpoint isn't at the new address: %q", out.Endpoint)
		}
		h := handleOf(out.Endpoint)
		// An endpoint at the old address: its machine signs for that.
		old := e.push(e.url+"/v1/push/"+h, rec, nil)
		// A new one: signed for the new address (reached here at the old).
		fresh := e.push(e.url+"/v1/push/"+h, rec, map[string]string{"Authorization": e.machine.auth(moved, time.Now().Add(time.Hour))})
		if fresh.status != http.StatusCreated {
			t.Fatalf("signed for the new address: %d %s", fresh.status, fresh.body)
		}
		if keepOld && old.status != http.StatusCreated || !keepOld && old.status != http.StatusForbidden {
			t.Fatalf("signed for the old address (RELAY_OLD_URLS %v): %d %s", keepOld, old.status, old.body)
		}
	}
}

func TestRegisterRefusals(t *testing.T) {
	e := newEnv(t, nil)
	key := b64(e.machine.pub)
	bad := append([]byte{}, e.machine.pub...)
	bad[64] ^= 1 // off the curve
	cases := []struct {
		name                       string
		platform, token, app, skey string
		want                       int
	}{
		{"unknown platform", "wns", apnsToken(), testApp, key, 400},
		{"unknown app", "apns", apnsToken(), "com.example.other", key, 400},
		{"unknown FCM app", "fcm", "tok", "com.example.other", key, 400},
		{"APNs token short", "apns", apnsToken()[:62], testApp, key, 400},
		{"APNs token long", "apns", strings.Repeat("ab", 101), testApp, key, 400},
		{"APNs token odd", "apns", apnsToken() + "a", testApp, key, 400},
		{"APNs token not hex", "apns", strings.Repeat("zz", 32), testApp, key, 400},
		{"FCM token empty", "fcm", "", testApp, key, 400},
		{"FCM token long", "fcm", strings.Repeat("a", 4097), testApp, key, 413}, // past 4 KB of JSON first
		{"FCM token space", "fcm", "a b", testApp, key, 400},
		{"no app", "fcm", "tok", "", key, 400},
		{"server key short", "apns", apnsToken(), testApp, key[:40], 400},
		{"server key off the curve", "apns", apnsToken(), testApp, b64(bad), 400},
		{"server key not base64", "apns", apnsToken(), testApp, "!!!", 400},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if a := e.registerAs(c.platform, c.token, c.app, c.skey); a.status != c.want {
				t.Fatalf("%d %s, want %d", a.status, a.body, c.want)
			}
		})
	}
	if a := e.do(http.MethodPost, "/v1/register", nil, []byte("not json")); a.status != http.StatusBadRequest {
		t.Fatalf("not JSON: %d", a.status)
	}
	big := []byte(`{"platform":"fcm","token":"` + strings.Repeat("a", maxRegister) + `"}`)
	if a := e.do(http.MethodPost, "/v1/register", nil, big); a.status != http.StatusRequestEntityTooLarge {
		t.Fatalf("over 4 KB: %d", a.status)
	}
	// A long FCM token (in a body of 4 KB at most), and a padded key, fit.
	long := strings.Repeat("a", maxRegister-200)
	if a := e.registerAs("fcm", long, testApp, key+"="); a.status != http.StatusOK {
		t.Fatalf("a long FCM token: %d %s", a.status, a.body)
	}

	// Not configured: 503, with words.
	apnsOnly := newEnv(t, func(v map[string]string) {
		for _, k := range []string{"FCM_PROJECT", "FCM_CREDENTIALS", "FCM_APPS", "FCM_URL", "FCM_TOKEN_URL", "FCM_METADATA_URL"} {
			delete(v, k)
		}
	})
	if a := apnsOnly.registerAs("fcm", "tok", testApp, key); a.status != http.StatusServiceUnavailable || !strings.Contains(a.body, "FCM") {
		t.Fatalf("FCM off: %d %s", a.status, a.body)
	}
	fcmOnly := newEnv(t, func(v map[string]string) {
		for _, k := range []string{"APNS_KEY", "APNS_KEY_ID", "APNS_TEAM_ID", "APNS_TOPICS", "APNS_URL", "APNS_SANDBOX_URL"} {
			delete(v, k)
		}
	})
	for _, p := range []string{"apns", "apns-sandbox"} {
		if a := fcmOnly.registerAs(p, apnsToken(), testApp, key); a.status != http.StatusServiceUnavailable || !strings.Contains(a.body, "APNs") {
			t.Fatalf("APNs off: %d %s", a.status, a.body)
		}
	}
	if a := fcmOnly.do(http.MethodGet, "/v1/health", nil, nil); a.body != `{"ok":true,"apns":false,"fcm":true}`+"\n" {
		t.Fatalf("health: %s", a.body)
	}
	// FCM_APPS unset: any app.
	anyApp := newEnv(t, func(v map[string]string) { delete(v, "FCM_APPS") })
	if a := anyApp.registerAs("fcm", "tok", "com.example.other", key); a.status != http.StatusOK {
		t.Fatalf("FCM for any app: %d %s", a.status, a.body)
	}
}

func TestRateLimits(t *testing.T) {
	rec := newPhone(t).encrypt(t, notification)

	t.Run("device", func(t *testing.T) {
		e := newEnv(t, func(v map[string]string) { v["RELAY_DEVICE_BURST"] = "2"; v["RELAY_DEVICE_PER_MIN"] = "1" })
		endpoint := e.register("apns", apnsToken())
		otherDevice := e.register("apns", apnsToken())
		for i := 0; i < 2; i++ {
			if a := e.push(endpoint, rec, nil); a.status != http.StatusCreated {
				t.Fatalf("push %d: %d", i, a.status)
			}
		}
		a := e.push(endpoint, rec, nil)
		ra, _ := strconv.Atoi(a.header.Get("Retry-After"))
		if a.status != http.StatusTooManyRequests || ra < 1 || ra > 60 {
			t.Fatalf("over the device's limit: %d, Retry-After %q", a.status, a.header.Get("Retry-After"))
		}
		if a := e.push(otherDevice, rec, nil); a.status != http.StatusCreated {
			t.Fatalf("another device: %d", a.status)
		}
		// Refused pushes (not its machine's) don't use the device's budget.
		dev := newEnv(t, func(v map[string]string) { v["RELAY_DEVICE_BURST"] = "1" })
		ep := dev.register("apns", apnsToken())
		for i := 0; i < 3; i++ {
			dev.push(ep, rec, map[string]string{"Authorization": newMachine(t).auth(dev.url, time.Now().Add(time.Hour))})
		}
		if a := dev.push(ep, rec, nil); a.status != http.StatusCreated {
			t.Fatalf("after refused pushes: %d", a.status)
		}
	})

	t.Run("address pushes", func(t *testing.T) {
		e := newEnv(t, func(v map[string]string) { v["RELAY_PUSH_BURST"] = "2"; v["RELAY_PUSH_PER_MIN"] = "60" })
		endpoint := e.register("apns", apnsToken())
		e.push(endpoint, rec, nil)
		e.push(e.url+"/v1/push/forged", rec, nil) // counted too
		a := e.push(endpoint, rec, nil)
		if a.status != http.StatusTooManyRequests || a.header.Get("Retry-After") != "1" {
			t.Fatalf("over the address's limit: %d, Retry-After %q", a.status, a.header.Get("Retry-After"))
		}
	})

	t.Run("address registrations", func(t *testing.T) {
		e := newEnv(t, func(v map[string]string) { v["RELAY_REGISTER_BURST"] = "2"; v["RELAY_REGISTER_PER_HOUR"] = "20" })
		e.register("apns", apnsToken())
		e.register("apns", apnsToken())
		a := e.registerAs("apns", apnsToken(), testApp, b64(e.machine.pub))
		ra, _ := strconv.Atoi(a.header.Get("Retry-After"))
		if a.status != http.StatusTooManyRequests || ra < 170 || ra > 180 {
			t.Fatalf("over the registrations' limit: %d, Retry-After %q", a.status, a.header.Get("Retry-After"))
		}
	})

	t.Run("behind a proxy", func(t *testing.T) {
		for _, trust := range []bool{true, false} {
			e := newEnv(t, func(v map[string]string) {
				v["RELAY_REGISTER_BURST"] = "1"
				if trust {
					v["RELAY_TRUST_PROXY"] = "1"
				}
			})
			body, _ := json.Marshal(map[string]string{"platform": "apns", "token": apnsToken(), "app": testApp, "server_key": b64(e.machine.pub)})
			from := func(xff string) int {
				return e.do(http.MethodPost, "/v1/register", map[string]string{"X-Forwarded-For": xff}, body).status
			}
			// The last entry is the proxy's: what's before it, anyone can write.
			first, second := from("6.6.6.6, 198.51.100.1"), from("6.6.6.6, 198.51.100.2")
			v6a, v6b := from("2001:db8:1:2::1"), from("2001:db8:1:2::ffff")
			if trust && (first != 200 || second != 200 || v6a != 200 || v6b != 429) {
				t.Fatalf("trusted: %d %d %d %d", first, second, v6a, v6b)
			}
			if !trust && (first != 200 || second != 429) {
				t.Fatalf("not trusted: %d %d", first, second)
			}
		}
	})

	t.Run("behind Fly's proxy", func(t *testing.T) {
		e := newEnv(t, func(v map[string]string) {
			v["RELAY_REGISTER_BURST"] = "1"
			v["RELAY_TRUST_PROXY"] = "1"
			v["RELAY_CLIENT_IP_HEADER"] = "fly-client-ip"
		})
		body, _ := json.Marshal(map[string]string{"platform": "apns", "token": apnsToken(), "app": testApp, "server_key": b64(e.machine.pub)})
		from := func(client string) int {
			// Fly's own address is X-Forwarded-For's last: the same for everyone.
			return e.do(http.MethodPost, "/v1/register", map[string]string{
				"Fly-Client-IP": client, "X-Forwarded-For": client + ", 203.0.113.9"}, body).status
		}
		if a, b, again := from("198.51.100.1"), from("198.51.100.2"), from("198.51.100.1"); a != 200 || b != 200 || again != 429 {
			t.Fatalf("Fly-Client-IP: %d %d %d", a, b, again)
		}
	})
}

func TestHealthAndRoot(t *testing.T) {
	e := newEnv(t, nil)
	a := e.do(http.MethodGet, "/v1/health", nil, nil)
	if a.status != 200 || a.body != `{"ok":true,"apns":true,"fcm":true}`+"\n" {
		t.Fatalf("health: %d %s", a.status, a.body)
	}
	a = e.do(http.MethodGet, "/", nil, nil)
	if a.status != 200 || strings.Count(a.body, "\n") != 1 || !strings.Contains(a.body, Repo) ||
		!strings.HasPrefix(a.header.Get("Content-Type"), "text/plain") {
		t.Fatalf("root: %d %q", a.status, a.body)
	}
	if a := e.do(http.MethodGet, "/nothing", nil, nil); a.status != 404 {
		t.Fatalf("/nothing: %d", a.status)
	}
	logs := e.logs.String()
	if !strings.Contains(logs, "GET health 200 device=- upstream=-") || !strings.Contains(logs, "GET other 404") {
		t.Fatalf("log:\n%s", logs)
	}
}

func TestServerTimeouts(t *testing.T) {
	e := newEnv(t, nil)
	s := e.relay.Server()
	if s.ReadHeaderTimeout == 0 || s.ReadTimeout == 0 || s.WriteTimeout <= e.relay.pushBudget() || s.IdleTimeout == 0 ||
		s.MaxHeaderBytes == 0 {
		t.Fatalf("a timeout or limit is missing: %+v", s)
	}
}

package relay

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestHandleRoundTrip(t *testing.T) {
	s, err := newSealer(testSecret, nil)
	if err != nil {
		t.Fatal(err)
	}
	key := newMachine(t).pub
	issued := time.Unix(1_790_000_000, 0)
	for _, d := range []Device{
		{Platform: "apns", Token: apnsToken(), App: testApp, ServerKey: key, Issued: issued},
		{Platform: "apns-sandbox", Token: apnsToken() + apnsToken(), App: "a", ServerKey: key, Issued: issued},
		{Platform: "fcm", Token: "dGVzdA:APA91b" + strings.Repeat("x", 150), App: testApp, ServerKey: key, Issued: issued},
		{Platform: "fcm", Token: strings.Repeat("y", maxFCMToken), App: strings.Repeat("p", 255), ServerKey: key, Issued: issued},
	} {
		h, err := s.seal(d)
		if err != nil {
			t.Fatal(err)
		}
		if len(h) > maxHandleChars || strings.ContainsAny(h, "=+/") {
			t.Fatalf("handle of %d characters, or not base64url", len(h))
		}
		got, err := s.open(h)
		if err != nil {
			t.Fatalf("%s: %v", d.Platform, err)
		}
		if got.Platform != d.Platform || got.Token != d.Token || got.App != d.App ||
			!bytes.Equal(got.ServerKey, d.ServerKey) || !got.Issued.Equal(d.Issued) {
			t.Fatalf("opened %+v, sealed %+v", got, d)
		}
		// Two seals of one device differ (a random nonce), and leak nothing.
		h2, _ := s.seal(d)
		if h2 == h || strings.Contains(h, d.Token) {
			t.Fatal("a handle isn't sealed")
		}
		// Any byte changed makes it someone else's: refused. (Every byte of
		// the shorter handles; the 4 KB one would only be slow.)
		raw, _ := base64.RawURLEncoding.DecodeString(h)
		if len(raw) > 512 {
			continue
		}
		for i := range raw {
			bad := append([]byte{}, raw...)
			bad[i] ^= 0x80
			if _, err := s.open(base64.RawURLEncoding.EncodeToString(bad)); err == nil {
				t.Fatalf("opened a handle with byte %d changed", i)
			}
		}
	}
	if _, err := s.seal(Device{Platform: "apns", Token: "zz", App: testApp, ServerKey: key}); err == nil {
		t.Fatal("sealed an APNs token that isn't hex")
	}
	if _, err := s.open(strings.Repeat("A", maxHandleChars+4)); err == nil {
		t.Fatal("opened an overlong handle")
	}
}

func TestLimiter(t *testing.T) {
	l := newLimiter(3, 6, time.Minute, 100) // 3 at once, then one every 10 s
	now := time.Unix(1000, 0)
	for i := 0; i < 3; i++ {
		if ok, _ := l.allow("a", now); !ok {
			t.Fatalf("burst %d refused", i)
		}
	}
	ok, wait := l.allow("a", now)
	if ok || wait != 10*time.Second || retryAfter(wait) != 10 {
		t.Fatalf("over the burst: %v, wait %v", ok, wait)
	}
	if ok, _ := l.allow("b", now); !ok {
		t.Fatal("another key shares the bucket")
	}
	if ok, wait := l.allow("a", now.Add(4*time.Second)); ok || retryAfter(wait) != 6 {
		t.Fatalf("4 s later: %v, wait %v", ok, wait)
	}
	if ok, _ := l.allow("a", now.Add(10*time.Second)); !ok {
		t.Fatal("a token didn't come back after 10 s")
	}
	// Refills stop at the burst.
	for i := 0; i < 3; i++ {
		if ok, _ := l.allow("a", now.Add(time.Hour)); !ok {
			t.Fatalf("after an hour, %d refused", i)
		}
	}
	if ok, _ := l.allow("a", now.Add(time.Hour)); ok {
		t.Fatal("the bucket held more than its burst")
	}
	if retryAfter(time.Millisecond) != 1 || retryAfter(0) != 1 || retryAfter(1500*time.Millisecond) != 2 {
		t.Fatal("Retry-After isn't whole seconds, at least one")
	}

	// Bounded: the least recently used goes.
	small := newLimiter(1, 1, time.Hour, 3)
	for _, k := range []string{"a", "b", "c"} {
		small.allow(k, now)
	}
	small.allow("a", now) // a is used again; b is the oldest now
	small.allow("d", now)
	if small.len() != 3 {
		t.Fatalf("%d buckets, bound 3", small.len())
	}
	if ok, _ := small.allow("a", now); ok {
		t.Fatal("a was evicted (it was used most recently)")
	}
	if ok, _ := small.allow("b", now); !ok {
		t.Fatal("b wasn't evicted")
	}
}

func TestOversizedChunkedPush(t *testing.T) {
	e := newEnv(t, nil)
	endpoint := e.register("apns", apnsToken())
	rec := newPhone(t).encrypt(t, notification)
	body := io.MultiReader(bytes.NewReader(rec), bytes.NewReader(make([]byte, maxRecord)))
	req, _ := http.NewRequest(http.MethodPost, endpoint, io.NopCloser(body)) // no length: chunked
	req.Header.Set("Content-Encoding", "aes128gcm")
	req.Header.Set("TTL", "60")
	req.Header.Set("Authorization", e.machine.auth(e.url, time.Now().Add(time.Hour)))
	resp, err := e.srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusRequestEntityTooLarge || len(e.apns.got()) != 0 {
		t.Fatalf("a chunked body over the limit: %d", resp.StatusCode)
	}
}

func TestNormalizeOrigin(t *testing.T) {
	for in, want := range map[string]string{
		"https://relay.example.com":      "https://relay.example.com",
		"https://Relay.Example.com/":     "https://relay.example.com",
		"HTTPS://relay.example.com:443":  "https://relay.example.com",
		"https://relay.example.com:8443": "https://relay.example.com:8443",
		"http://127.0.0.1:8099":          "http://127.0.0.1:8099",
		"http://[::1]:80":                "http://[::1]",
		"http://[::1]:8099":              "http://[::1]:8099",
	} {
		if got, err := NormalizeOrigin(in); err != nil || got != want {
			t.Errorf("%s: %q, %v; want %q", in, got, err, want)
		}
	}
	for _, in := range []string{"relay.example.com", "ftp://relay.example.com", "https://", "https://relay.example.com/relay",
		"https://u:p@relay.example.com", "https://relay.example.com/?a=1"} {
		if got, err := NormalizeOrigin(in); err == nil {
			t.Errorf("%s: took it as %q", in, got)
		}
	}
}

func TestFromEnv(t *testing.T) {
	dir := t.TempDir()
	k, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	der, _ := x509.MarshalPKCS8PrivateKey(k)
	p8 := string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
	keyFile := filepath.Join(dir, "AuthKey.p8")
	os.WriteFile(keyFile, []byte(p8), 0o600)
	g := &fakeGoogle{t: t, email: "relay@" + testProject + ".iam.gserviceaccount.com"}
	credsFile := filepath.Join(dir, "sa.json")
	os.WriteFile(credsFile, []byte(g.credentialsJSON()), 0o600)

	parse := func(vars map[string]string) (*Config, []string) {
		cfg, err := FromEnv(func(k string) string { return vars[k] })
		if err != nil {
			return cfg, err.(*ConfigError).Problems
		}
		return cfg, nil
	}
	base := func() map[string]string {
		return map[string]string{"RELAY_URL": "https://relay.example.com", "RELAY_SECRET": testSecret}
	}

	cfg, problems := parse(base())
	if problems != nil || cfg.Listen != ":8080" || cfg.URL != "https://relay.example.com" || cfg.APNs != nil || cfg.FCM != nil ||
		cfg.Limits != DefaultLimits || cfg.TrustProxy {
		t.Fatalf("the least config: %+v %v", cfg, problems)
	}

	// Missing what it needs: says so, by name, and never echoes a secret.
	_, problems = parse(map[string]string{"RELAY_SECRET": "short-secret-value"})
	all := strings.Join(problems, "\n")
	if !strings.Contains(all, "RELAY_URL is missing") || !strings.Contains(all, "RELAY_SECRET is too short") ||
		strings.Contains(all, "short-secret-value") {
		t.Fatalf("problems: %s", all)
	}

	v := base()
	v["PORT"] = "9000"
	v["RELAY_TRUST_PROXY"] = "1"
	v["RELAY_DEVICE_BURST"], v["RELAY_PUSH_PER_MIN"] = "5", "7"
	v["APNS_KEY_FILE"], v["APNS_KEY_ID"], v["APNS_TEAM_ID"], v["APNS_TOPICS"] = keyFile, testKeyID, testTeam, "a.b, c.d,"
	v["FCM_CREDENTIALS"], v["FCM_APPS"] = credsFile, "a.b"
	cfg, problems = parse(v)
	if problems != nil {
		t.Fatalf("a whole config: %v", problems)
	}
	if cfg.Listen != ":9000" || !cfg.TrustProxy || cfg.Limits.DeviceBurst != 5 || cfg.Limits.PushPerMin != 7 ||
		cfg.Limits.DevicePerMin != DefaultLimits.DevicePerMin {
		t.Fatalf("parsed: %+v", cfg)
	}
	if !cfg.APNs.ready() || cfg.APNs.URL != DefaultAPNsURL || cfg.APNs.SandboxURL != DefaultAPNsSandboxURL ||
		strings.Join(cfg.APNs.Topics, "|") != "a.b|c.d" {
		t.Fatalf("APNs: %+v", cfg.APNs)
	}
	if cfg.FCM.Project != testProject || cfg.FCM.Credentials == nil || cfg.FCM.URL != DefaultFCMURL ||
		cfg.FCM.Credentials.TokenURI != "https://oauth2.googleapis.com/token" {
		t.Fatalf("FCM: %+v", cfg.FCM)
	}
	summary := strings.Join(cfg.Summary(), "\n")
	if strings.Contains(summary, testSecret) || strings.Contains(summary, "PRIVATE KEY") || !strings.Contains(summary, "apns: on") ||
		!strings.Contains(summary, "fcm: on") {
		t.Fatalf("summary:\n%s", summary)
	}

	// RELAY_LISTEN wins over PORT.
	v = base()
	v["RELAY_LISTEN"], v["PORT"] = "127.0.0.1:8099", "9000"
	if cfg, _ := parse(v); cfg.Listen != "127.0.0.1:8099" {
		t.Fatalf("listen: %s", cfg.Listen)
	}

	// The key as one line, as some hosts keep it: with \n, or just its base64.
	for name, key := range map[string]string{
		"escaped newlines": strings.ReplaceAll(p8, "\n", `\n`),
		"bare base64":      base64.StdEncoding.EncodeToString(der),
	} {
		v := base()
		v["APNS_KEY"], v["APNS_KEY_ID"], v["APNS_TEAM_ID"], v["APNS_TOPICS"] = key, testKeyID, testTeam, testApp
		if cfg, problems := parse(v); problems != nil || !cfg.APNs.ready() {
			t.Fatalf("APNS_KEY as %s: %v", name, problems)
		}
	}

	bad := map[string]func(map[string]string){
		"APNS_KEY_ID": func(v map[string]string) { v["APNS_KEY"], v["APNS_TEAM_ID"], v["APNS_TOPICS"] = p8, testTeam, testApp },
		"APNS_TOPICS": func(v map[string]string) {
			v["APNS_KEY"], v["APNS_TEAM_ID"], v["APNS_KEY_ID"] = p8, testTeam, testKeyID
		},
		"APNS_KEY (the": func(v map[string]string) {
			v["APNS_TEAM_ID"], v["APNS_KEY_ID"], v["APNS_TOPICS"] = testTeam, testKeyID, testApp
		},
		"isn't an APNs key": func(v map[string]string) {
			v["APNS_KEY"], v["APNS_TEAM_ID"], v["APNS_KEY_ID"], v["APNS_TOPICS"] = "bm9wZQ", testTeam, testKeyID, testApp
		},
		"not both": func(v map[string]string) {
			v["APNS_KEY"], v["APNS_KEY_FILE"], v["APNS_TEAM_ID"], v["APNS_KEY_ID"], v["APNS_TOPICS"] = p8, keyFile, testTeam, testKeyID, testApp
		},
		"APNS_KEY_FILE": func(v map[string]string) {
			v["APNS_KEY_FILE"], v["APNS_TEAM_ID"], v["APNS_KEY_ID"], v["APNS_TOPICS"] = dir+"/none", testTeam, testKeyID, testApp
		},
		"APNS_URL": func(v map[string]string) {
			v["APNS_KEY"], v["APNS_TEAM_ID"], v["APNS_KEY_ID"], v["APNS_TOPICS"], v["APNS_URL"] = p8, testTeam, testKeyID, testApp, "api.push.apple.com"
		},
		"FCM_APPS is set":         func(v map[string]string) { v["FCM_APPS"] = "a.b" },
		"service account":         func(v map[string]string) { v["FCM_CREDENTIALS"] = `{"type":"authorized_user"}` },
		"can't be read":           func(v map[string]string) { v["FCM_CREDENTIALS"] = dir + "/none.json" },
		"RELAY_TRUST_PROXY":       func(v map[string]string) { v["RELAY_TRUST_PROXY"] = "maybe" },
		"RELAY_CLIENT_IP_HEADER":  func(v map[string]string) { v["RELAY_CLIENT_IP_HEADER"] = "Fly Client IP" },
		"RELAY_DEVICE_BURST must": func(v map[string]string) { v["RELAY_DEVICE_BURST"] = "0" },
		"PORT must":               func(v map[string]string) { v["PORT"] = "http" },
		"RELAY_SECRETS: secret 2": func(v map[string]string) { v["RELAY_SECRETS"] = testSecret + ",short" },
		"RELAY_URL must be only":  func(v map[string]string) { v["RELAY_URL"] = "https://relay.example.com/push" },
	}
	for want, change := range bad {
		v := base()
		change(v)
		_, problems := parse(v)
		if !strings.Contains(strings.Join(problems, "\n"), want) {
			t.Errorf("%s: problems %v", want, problems)
		}
	}

	// FCM with credentials but no project: the credentials' project.
	v = base()
	v["FCM_CREDENTIALS"] = g.credentialsJSON()
	if cfg, problems := parse(v); problems != nil || cfg.FCM.Project != testProject {
		t.Fatalf("FCM project from its credentials: %v", problems)
	}
	// FCM on Google Cloud: a project, no credentials.
	v = base()
	v["FCM_PROJECT"] = "p"
	if cfg, problems := parse(v); problems != nil || cfg.FCM.Credentials != nil || cfg.FCM.MetadataURL != DefaultMetadataURL {
		t.Fatalf("FCM on Google Cloud: %v", problems)
	}
}

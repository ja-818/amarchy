package relay

import (
	"bytes"
	"crypto"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"log"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

const (
	testApp     = "io.github.ja818.amarchy"
	testTeam    = "TEAM123456"
	testKeyID   = "KEY1234567"
	testProject = "amarchy-test"
	testSecret  = "a-secret-for-tests-only-0123456789abcdef"
)

func b64(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

// syncBuffer is the relay's log, read while its handlers still write.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// ---- APNs ----

type apnsCall struct {
	path   string
	proto  int
	header http.Header
	body   []byte
	token  string // the provider token it came with
}

// fakeAPNs is Apple's push service: HTTP/2 over TLS, checking the provider
// token as Apple does (ES256, the team's key, kid and iss).
type fakeAPNs struct {
	srv   *httptest.Server
	key   *ecdsa.PublicKey
	mu    sync.Mutex
	calls []apnsCall
	// respond answers the nth call (0-based); nil: 200.
	respond func(n int, c apnsCall, w http.ResponseWriter) bool
}

func newFakeAPNs(t *testing.T, key *ecdsa.PublicKey) *fakeAPNs {
	f := &fakeAPNs{key: key}
	f.srv = httptest.NewUnstartedServer(http.HandlerFunc(f.serve))
	f.srv.EnableHTTP2 = true
	f.srv.StartTLS()
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeAPNs) serve(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	tok, _ := strings.CutPrefix(r.Header.Get("Authorization"), "bearer ")
	c := apnsCall{path: r.URL.Path, proto: r.ProtoMajor, header: r.Header.Clone(), body: body, token: tok}
	f.mu.Lock()
	n := len(f.calls)
	f.calls = append(f.calls, c)
	respond := f.respond
	f.mu.Unlock()
	if !verifyProviderToken(tok, f.key) {
		w.WriteHeader(http.StatusForbidden)
		io.WriteString(w, `{"reason":"InvalidProviderToken"}`)
		return
	}
	if respond != nil && respond(n, c, w) {
		return
	}
	w.Header().Set("apns-id", "00000000-0000-0000-0000-000000000000")
	w.WriteHeader(http.StatusOK)
}

func (f *fakeAPNs) got() []apnsCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]apnsCall(nil), f.calls...)
}

func (f *fakeAPNs) set(respond func(n int, c apnsCall, w http.ResponseWriter) bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.respond = respond
}

func (f *fakeAPNs) answer(status int, reason string, header ...string) {
	f.set(func(_ int, _ apnsCall, w http.ResponseWriter) bool {
		for i := 0; i+1 < len(header); i += 2 {
			w.Header().Set(header[i], header[i+1])
		}
		w.WriteHeader(status)
		if reason != "" {
			fmt.Fprintf(w, `{"reason":%q}`, reason)
		}
		return true
	})
}

func verifyProviderToken(tok string, key *ecdsa.PublicKey) bool {
	parts := strings.Split(tok, ".")
	if len(parts) != 3 {
		return false
	}
	var header struct{ Alg, Kid string }
	var claims struct {
		Iss string
		Iat int64
	}
	h, _ := base64.RawURLEncoding.DecodeString(parts[0])
	c, _ := base64.RawURLEncoding.DecodeString(parts[1])
	sig, _ := base64.RawURLEncoding.DecodeString(parts[2])
	if json.Unmarshal(h, &header) != nil || json.Unmarshal(c, &claims) != nil || len(sig) != 64 {
		return false
	}
	if header.Alg != "ES256" || header.Kid != testKeyID || claims.Iss != testTeam ||
		time.Since(time.Unix(claims.Iat, 0)).Abs() > time.Hour {
		return false
	}
	d := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	return ecdsa.Verify(key, d[:], new(big.Int).SetBytes(sig[:32]), new(big.Int).SetBytes(sig[32:]))
}

// ---- Google: its OAuth token endpoint, the metadata server, FCM ----

var (
	rsaOnce sync.Once
	rsaKey  *rsa.PrivateKey
)

func serviceAccountKey(t *testing.T) *rsa.PrivateKey {
	rsaOnce.Do(func() {
		k, err := rsa.GenerateKey(rand.Reader, 2048)
		if err != nil {
			t.Fatal(err)
		}
		rsaKey = k
	})
	return rsaKey
}

// fakeGoogle hands out access tokens (for a service account's signed
// grant, or from the metadata server) and is FCM, which takes only them.
type fakeGoogle struct {
	t        *testing.T
	sa       *rsa.PublicKey
	email    string
	oauth    *httptest.Server
	metadata *httptest.Server
	fcm      *httptest.Server

	mu       sync.Mutex
	issued   map[string]bool
	grants   int // tokens given for a signed grant
	metas    int // tokens given by the metadata server
	calls    []fcmCall
	reject   map[string]bool // access tokens FCM says 401 to
	respond  func(n int, c fcmCall, w http.ResponseWriter) bool
	tokenErr int // the token endpoints answer this, when set
}

type fcmCall struct {
	path   string
	header http.Header
	body   []byte
	msg    fcmRequest
}

func newFakeGoogle(t *testing.T) *fakeGoogle {
	g := &fakeGoogle{t: t, sa: &serviceAccountKey(t).PublicKey, email: "relay@" + testProject + ".iam.gserviceaccount.com",
		issued: map[string]bool{}, reject: map[string]bool{}}
	g.oauth = httptest.NewServer(http.HandlerFunc(g.serveGrant))
	g.metadata = httptest.NewServer(http.HandlerFunc(g.serveMetadata))
	g.fcm = httptest.NewServer(http.HandlerFunc(g.serveFCM))
	t.Cleanup(func() { g.oauth.Close(); g.metadata.Close(); g.fcm.Close() })
	return g
}

func (g *fakeGoogle) credentialsJSON() string {
	der, _ := x509.MarshalPKCS8PrivateKey(serviceAccountKey(g.t))
	b, _ := json.Marshal(map[string]string{
		"type": "service_account", "project_id": testProject, "private_key_id": "kid-1",
		"private_key":  string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})),
		"client_email": g.email, "token_uri": "https://oauth2.googleapis.com/token",
	})
	return string(b)
}

func (g *fakeGoogle) issue(w http.ResponseWriter, prefix string, n int) {
	tok := fmt.Sprintf("%s-%d", prefix, n)
	g.issued[tok] = true
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprintf(w, `{"access_token":%q,"expires_in":3599,"token_type":"Bearer"}`, tok)
}

func (g *fakeGoogle) serveGrant(w http.ResponseWriter, r *http.Request) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.tokenErr != 0 {
		w.WriteHeader(g.tokenErr)
		io.WriteString(w, `{"error":"invalid_grant","error_description":"no"}`)
		return
	}
	r.ParseForm()
	if r.Method != http.MethodPost || r.Form.Get("grant_type") != "urn:ietf:params:oauth:grant-type:jwt-bearer" {
		http.Error(w, `{"error":"unsupported_grant_type"}`, http.StatusBadRequest)
		return
	}
	parts := strings.Split(r.Form.Get("assertion"), ".")
	if len(parts) != 3 {
		http.Error(w, `{"error":"invalid_grant"}`, http.StatusBadRequest)
		return
	}
	var header struct{ Alg, Typ, Kid string }
	var claims struct {
		Iss, Scope, Aud string
		Iat, Exp        int64
	}
	h, _ := base64.RawURLEncoding.DecodeString(parts[0])
	c, _ := base64.RawURLEncoding.DecodeString(parts[1])
	sig, _ := base64.RawURLEncoding.DecodeString(parts[2])
	json.Unmarshal(h, &header)
	json.Unmarshal(c, &claims)
	d := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if header.Alg != "RS256" || header.Kid != "kid-1" || rsa.VerifyPKCS1v15(g.sa, crypto.SHA256, d[:], sig) != nil ||
		claims.Iss != g.email || claims.Scope != fcmScope || claims.Aud != g.oauth.URL+"/token" ||
		claims.Exp-claims.Iat != 3600 || time.Since(time.Unix(claims.Iat, 0)).Abs() > time.Minute {
		http.Error(w, `{"error":"invalid_grant"}`, http.StatusBadRequest)
		return
	}
	g.grants++
	g.issue(w, "grant", g.grants)
}

func (g *fakeGoogle) serveMetadata(w http.ResponseWriter, r *http.Request) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if r.Header.Get("Metadata-Flavor") != "Google" {
		http.Error(w, "Missing Metadata-Flavor:Google header.", http.StatusForbidden)
		return
	}
	if g.tokenErr != 0 {
		w.WriteHeader(g.tokenErr)
		return
	}
	g.metas++
	g.issue(w, "meta", g.metas)
}

func (g *fakeGoogle) serveFCM(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	c := fcmCall{path: r.URL.Path, header: r.Header.Clone(), body: body}
	json.Unmarshal(body, &c.msg)
	tok, _ := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	g.mu.Lock()
	ok, rejected := g.issued[tok], g.reject[tok]
	n := len(g.calls)
	g.calls = append(g.calls, c)
	respond := g.respond
	g.mu.Unlock()
	if !ok || rejected {
		w.WriteHeader(http.StatusUnauthorized)
		io.WriteString(w, `{"error":{"code":401,"message":"Request had invalid authentication credentials.","status":"UNAUTHENTICATED"}}`)
		return
	}
	if r.URL.Path != "/v1/projects/"+testProject+"/messages:send" {
		http.NotFound(w, r)
		return
	}
	if respond != nil && respond(n, c, w) {
		return
	}
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprintf(w, `{"name":"projects/%s/messages/0:1"}`, testProject)
}

func (g *fakeGoogle) got() []fcmCall {
	g.mu.Lock()
	defer g.mu.Unlock()
	return append([]fcmCall(nil), g.calls...)
}

// counts is how many access tokens it gave: for a grant, from the metadata server.
func (g *fakeGoogle) counts() (grants, metas int) {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.grants, g.metas
}

func (g *fakeGoogle) with(change func(g *fakeGoogle)) {
	g.mu.Lock()
	defer g.mu.Unlock()
	change(g)
}

func (g *fakeGoogle) answer(status int, body string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.respond = func(_ int, _ fcmCall, w http.ResponseWriter) bool {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		io.WriteString(w, body)
		return true
	}
}

func fcmErrorBody(code int, status, errorCode string) string {
	return fmt.Sprintf(`{"error":{"code":%d,"message":"x","status":%q,"details":[{"@type":"type.googleapis.com/google.firebase.fcm.v1.FcmError","errorCode":%q}]}}`,
		code, status, errorCode)
}

// ---- the machine and the phone ----

// machine is an amarchy machine: its VAPID key signs what it sends.
type machine struct {
	key *ecdsa.PrivateKey
	pub []byte
}

func newMachine(t *testing.T) *machine {
	k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	pub, _ := k.PublicKey.Bytes()
	return &machine{key: k, pub: pub}
}

// jwt is a VAPID JWT, as bin/amarchy's push_send makes it.
func (m *machine) jwt(aud string, exp time.Time) string {
	claims, _ := json.Marshal(map[string]any{"aud": aud, "exp": exp.Unix(), "sub": "https://github.com/ja-818/amarchy"})
	tok, err := signES256(m.key, []byte(`{"typ":"JWT","alg":"ES256"}`), claims)
	if err != nil {
		panic(err)
	}
	return tok
}

func (m *machine) auth(aud string, exp time.Time) string { return m.authWith(m.jwt(aud, exp)) }

func (m *machine) authWith(jwt string) string { return "vapid t=" + jwt + ", k=" + b64(m.pub) }

// phone is a phone's push keys, made on it.
type phone struct {
	key  *ecdh.PrivateKey
	auth []byte
}

func newPhone(t *testing.T) *phone {
	k, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	auth := make([]byte, 16)
	rand.Read(auth)
	return &phone{key: k, auth: auth}
}

func (p *phone) encrypt(t *testing.T, plaintext string) []byte {
	rec, err := encryptRecord(p.key.PublicKey().Bytes(), p.auth, []byte(plaintext))
	if err != nil {
		t.Fatal(err)
	}
	return rec
}

func apnsToken() string {
	b := make([]byte, 32)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// ---- the relay under test ----

type env struct {
	t       *testing.T
	relay   *Relay
	srv     *httptest.Server
	url     string
	logs    *syncBuffer
	apns    *fakeAPNs
	sandbox *fakeAPNs
	google  *fakeGoogle
	machine *machine
	vars    map[string]string
}

// newEnv runs a relay configured from its environment, as it is deployed,
// with fake APNs and FCM behind it. change edits the variables first, then
// tune the configuration they made.
func newEnv(t *testing.T, change func(vars map[string]string), tune ...func(*Config)) *env {
	t.Helper()
	e := &env{t: t, logs: &syncBuffer{}, machine: newMachine(t)}
	teamKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	der, _ := x509.MarshalPKCS8PrivateKey(teamKey)
	e.apns = newFakeAPNs(t, &teamKey.PublicKey)
	e.sandbox = newFakeAPNs(t, &teamKey.PublicKey)
	e.google = newFakeGoogle(t)

	var handler http.Handler = http.NotFoundHandler()
	var mu sync.RWMutex
	e.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.RLock()
		h := handler
		mu.RUnlock()
		h.ServeHTTP(w, r)
	}))
	t.Cleanup(e.srv.Close)
	e.url = e.srv.URL

	e.vars = map[string]string{
		"RELAY_URL":               e.url,
		"RELAY_SECRET":            testSecret,
		"APNS_KEY":                string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})),
		"APNS_KEY_ID":             testKeyID,
		"APNS_TEAM_ID":            testTeam,
		"APNS_TOPICS":             "other.app, " + testApp,
		"APNS_URL":                e.apns.srv.URL,
		"APNS_SANDBOX_URL":        e.sandbox.srv.URL,
		"FCM_PROJECT":             testProject,
		"FCM_CREDENTIALS":         e.google.credentialsJSON(),
		"FCM_APPS":                testApp,
		"FCM_URL":                 e.google.fcm.URL,
		"FCM_TOKEN_URL":           e.google.oauth.URL + "/token",
		"FCM_METADATA_URL":        e.google.metadata.URL + "/token",
		"RELAY_REGISTER_BURST":    "1000",
		"RELAY_REGISTER_PER_HOUR": "1000",
	}
	if change != nil {
		change(e.vars)
	}
	cfg, err := FromEnv(func(k string) string { return e.vars[k] })
	if err != nil {
		t.Fatalf("config: %v", err)
	}
	if cfg.APNs != nil {
		pool := x509.NewCertPool()
		pool.AddCert(e.apns.srv.Certificate())
		cfg.APNs.TLS = &tls.Config{RootCAs: pool}
	}
	cfg.Logger = log.New(e.logs, "", 0)
	for _, f := range tune {
		f(cfg)
	}
	r, err := New(*cfg)
	if err != nil {
		t.Fatal(err)
	}
	e.relay = r
	mu.Lock()
	handler = r.Handler()
	mu.Unlock()
	return e
}

type answer struct {
	status int
	header http.Header
	body   string
}

func (e *env) do(method, path string, header map[string]string, body []byte) answer {
	e.t.Helper()
	target := path
	if !strings.HasPrefix(path, "http") {
		target = e.url + path
	}
	req, err := http.NewRequest(method, target, bytes.NewReader(body))
	if err != nil {
		e.t.Fatal(err)
	}
	for k, v := range header {
		req.Header.Set(k, v)
	}
	resp, err := e.srv.Client().Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return answer{resp.StatusCode, resp.Header, string(b)}
}

// register registers a device; it must work.
func (e *env) register(platform, token string) string {
	e.t.Helper()
	a := e.registerAs(platform, token, testApp, b64(e.machine.pub))
	if a.status != http.StatusOK {
		e.t.Fatalf("register: %d %s", a.status, a.body)
	}
	var out struct{ Endpoint string }
	if err := json.Unmarshal([]byte(a.body), &out); err != nil {
		e.t.Fatal(err)
	}
	if !strings.HasPrefix(out.Endpoint, e.url+"/v1/push/") {
		e.t.Fatalf("endpoint %q isn't the relay's", out.Endpoint)
	}
	return out.Endpoint
}

func (e *env) registerAs(platform, token, app, key string) answer {
	body, _ := json.Marshal(map[string]string{"platform": platform, "token": token, "app": app, "server_key": key})
	return e.do(http.MethodPost, "/v1/register", map[string]string{"Content-Type": "application/json"}, body)
}

// push sends a record as a machine does (bin/amarchy push_send); header
// overrides or, with "", drops what it sends.
func (e *env) push(endpoint string, record []byte, header map[string]string) answer {
	e.t.Helper()
	u, _ := url.Parse(endpoint)
	h := map[string]string{
		"TTL":              "86400",
		"Urgency":          "high",
		"Content-Encoding": "aes128gcm",
		"Content-Type":     "application/octet-stream",
		"Authorization":    e.machine.auth(u.Scheme+"://"+u.Host, time.Now().Add(12*time.Hour)),
	}
	for k, v := range header {
		if v == "" {
			delete(h, k)
		} else {
			h[k] = v
		}
	}
	return e.do(http.MethodPost, endpoint, h, record)
}

func handleOf(endpoint string) string {
	return endpoint[strings.LastIndex(endpoint, "/")+1:]
}

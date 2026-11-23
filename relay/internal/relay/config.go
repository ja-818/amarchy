// Package relay is amarchy's push relay: a Web Push service (RFC 8030) in
// front of APNs and FCM. A machine sends to it exactly as to any push
// service; it forwards the record, still encrypted for the phone (RFC 8291),
// and keeps nothing but its rate limits.
package relay

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// What the relay talks to when its environment doesn't say otherwise.
const (
	DefaultAPNsURL        = "https://api.push.apple.com"
	DefaultAPNsSandboxURL = "https://api.sandbox.push.apple.com"
	DefaultFCMURL         = "https://fcm.googleapis.com"
	DefaultMetadataURL    = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token"
	DefaultGoogleTokenURL = "https://oauth2.googleapis.com/token"
	DefaultPort           = "8080"
	DefaultUpstream       = 15 * time.Second

	// MinSecretLen keeps the handle key out of reach of guessing.
	MinSecretLen = 32
)

// Limits are the token buckets' sizes and rates.
type Limits struct {
	DeviceBurst     int // pushes to one device at once
	DevicePerMin    int // then this many a minute
	RegisterBurst   int // registrations from one address at once
	RegisterPerHour int // then this many an hour
	PushBurst       int // pushes from one address at once
	PushPerMin      int // then this many a minute
}

// DefaultLimits are the plan's: generous for a person's machines, tight for a flood.
var DefaultLimits = Limits{
	DeviceBurst: 30, DevicePerMin: 15,
	RegisterBurst: 20, RegisterPerHour: 20,
	PushBurst: 300, PushPerMin: 600,
}

// APNsConfig is what it takes to send to Apple: a provider token key.
type APNsConfig struct {
	Key        *ecdsa.PrivateKey
	KeySource  string // "APNS_KEY" or the file it came from (for check)
	KeyID      string
	TeamID     string
	Topics     []string // the app ids (bundle ids) it sends for
	URL        string
	SandboxURL string
	TLS        *tls.Config // nil: the system's roots (tests trust their fake)
}

// FCMConfig is what it takes to send to Firebase Cloud Messaging.
type FCMConfig struct {
	Project string
	Apps    []string // the Android package names it sends for; empty: any
	URL     string
	// Credentials signs for OAuth access tokens; nil: Google Cloud's
	// metadata server gives them (Cloud Run's own service account).
	Credentials       *ServiceAccount
	CredentialsSource string
	TokenURL          string // overrides the credentials' token_uri (tests)
	MetadataURL       string
}

// ServiceAccount is the part of a Google service account key the relay uses.
type ServiceAccount struct {
	Type         string `json:"type"`
	ProjectID    string `json:"project_id"`
	PrivateKeyID string `json:"private_key_id"`
	PrivateKey   string `json:"private_key"`
	ClientEmail  string `json:"client_email"`
	TokenURI     string `json:"token_uri"`
	key          *rsa.PrivateKey
}

// Config is the relay's whole setup.
type Config struct {
	Listen string
	URL    string // the relay's public origin, normalized: scheme://host[:port]
	// OldURLs are origins it was at before: endpoints phones still hold
	// start with them, so machines sign for them.
	OldURLs    []string
	Secret     string
	OldSecrets []string
	TrustProxy bool
	// ClientIPHeader is the header a proxy puts the client's address in
	// (Fly-Client-IP); it takes the place of X-Forwarded-For.
	ClientIPHeader string
	Limits         Limits
	APNs           *APNsConfig // nil: doesn't send to Apple
	FCM            *FCMConfig  // nil: doesn't send to Google

	// Not from the environment: knobs for tests and embedding.
	UpstreamTimeout time.Duration    // each call to APNs, FCM or a token server; 0: 15 s
	Logger          *log.Logger      // nil: stderr
	HTTPClient      *http.Client     // FCM and its tokens; nil: one with timeouts
	Now             func() time.Time // nil: time.Now
}

// ConfigError lists everything wrong with the environment at once, so one
// run of `amarchy-relay check` says all of it.
type ConfigError struct{ Problems []string }

func (e *ConfigError) Error() string { return strings.Join(e.Problems, "; ") }

// FromEnv reads the relay's configuration. It returns what it could read
// even when there are problems, so check can show both.
func FromEnv(getenv func(string) string) (*Config, error) {
	var problems []string
	bad := func(format string, args ...any) { problems = append(problems, fmt.Sprintf(format, args...)) }
	env := func(name string) string { return strings.TrimSpace(getenv(name)) }

	c := &Config{Limits: DefaultLimits}

	c.Listen = env("RELAY_LISTEN")
	if c.Listen == "" {
		port := env("PORT")
		if port == "" {
			port = DefaultPort
		}
		if n, err := strconv.Atoi(port); err != nil || n < 1 || n > 65535 {
			bad("PORT must be a port number, like 8080")
		}
		c.Listen = ":" + port
	}

	if raw := env("RELAY_URL"); raw == "" {
		bad("RELAY_URL is missing: set it to this relay's public address, like https://relay.example.com " +
			"(the endpoints it gives out start with it, and machines sign for it)")
	} else if origin, err := NormalizeOrigin(raw); err != nil {
		bad("RELAY_URL %v", err)
	} else {
		c.URL = origin
	}
	for _, raw := range splitList(env("RELAY_OLD_URLS")) {
		if origin, err := NormalizeOrigin(raw); err != nil {
			bad("RELAY_OLD_URLS: %s %v", raw, err)
		} else {
			c.OldURLs = append(c.OldURLs, origin)
		}
	}

	c.Secret = getenv("RELAY_SECRET")
	switch {
	case c.Secret == "":
		bad("RELAY_SECRET is missing: `amarchy-relay secret` makes one (keep it: the endpoints it gave out open with it)")
	case len(c.Secret) < MinSecretLen:
		bad("RELAY_SECRET is too short: it needs %d characters or more (`amarchy-relay secret` makes one)", MinSecretLen)
	}
	for i, s := range strings.Split(getenv("RELAY_SECRETS"), ",") {
		s = strings.TrimSpace(s)
		if s == "" {
			continue
		}
		if len(s) < MinSecretLen {
			bad("RELAY_SECRETS: secret %d is too short (%d characters or more)", i+1, MinSecretLen)
			continue
		}
		c.OldSecrets = append(c.OldSecrets, s)
	}

	switch v := strings.ToLower(env("RELAY_TRUST_PROXY")); v {
	case "", "0", "false", "no":
	case "1", "true", "yes":
		c.TrustProxy = true
	default:
		bad("RELAY_TRUST_PROXY must be 1 or 0")
	}
	if h := env("RELAY_CLIENT_IP_HEADER"); h != "" {
		if !isToken(h) {
			bad("RELAY_CLIENT_IP_HEADER must be a header's name, like Fly-Client-IP")
		} else {
			c.ClientIPHeader = http.CanonicalHeaderKey(h)
		}
	}

	limit := func(name string, into *int) {
		v := env(name)
		if v == "" {
			return
		}
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			bad("%s must be a whole number, 1 or more", name)
			return
		}
		*into = n
	}
	limit("RELAY_DEVICE_BURST", &c.Limits.DeviceBurst)
	limit("RELAY_DEVICE_PER_MIN", &c.Limits.DevicePerMin)
	limit("RELAY_REGISTER_BURST", &c.Limits.RegisterBurst)
	limit("RELAY_REGISTER_PER_HOUR", &c.Limits.RegisterPerHour)
	limit("RELAY_PUSH_BURST", &c.Limits.PushBurst)
	limit("RELAY_PUSH_PER_MIN", &c.Limits.PushPerMin)

	apns, apnsProblems := apnsFromEnv(env, getenv)
	c.APNs = apns
	problems = append(problems, apnsProblems...)

	fcm, fcmProblems := fcmFromEnv(env)
	c.FCM = fcm
	problems = append(problems, fcmProblems...)

	if len(problems) > 0 {
		return c, &ConfigError{Problems: problems}
	}
	return c, nil
}

// NormalizeOrigin turns RELAY_URL into the origin machines sign for (a
// VAPID JWT's aud): lowercase scheme and host, the default port dropped.
func NormalizeOrigin(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return "", errors.New("isn't a URL")
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "https" && scheme != "http" {
		return "", errors.New("must start with https:// (or http:// on your own computer)")
	}
	if u.Host == "" || u.Hostname() == "" {
		return "", errors.New("has no host")
	}
	if u.User != nil || (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" {
		return "", errors.New("must be only the relay's origin, like https://relay.example.com (no path)")
	}
	host := strings.ToLower(u.Hostname())
	if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	if port := u.Port(); port != "" && !(scheme == "https" && port == "443") && !(scheme == "http" && port == "80") {
		host += ":" + port
	}
	return scheme + "://" + host, nil
}

func splitList(v string) []string {
	var out []string
	for _, s := range strings.Split(v, ",") {
		if s = strings.TrimSpace(s); s != "" {
			out = append(out, s)
		}
	}
	return out
}

func apnsFromEnv(env func(string) string, raw func(string) string) (*APNsConfig, []string) {
	keyText, keyFile := raw("APNS_KEY"), env("APNS_KEY_FILE")
	keyID, teamID, topics := env("APNS_KEY_ID"), env("APNS_TEAM_ID"), splitList(env("APNS_TOPICS"))
	if strings.TrimSpace(keyText) == "" && keyFile == "" && keyID == "" && teamID == "" && len(topics) == 0 {
		return nil, nil // APNs off, and nothing says it should be on
	}
	var problems []string
	bad := func(format string, args ...any) { problems = append(problems, fmt.Sprintf(format, args...)) }
	c := &APNsConfig{KeyID: keyID, TeamID: teamID, Topics: topics,
		URL: env("APNS_URL"), SandboxURL: env("APNS_SANDBOX_URL")}
	if c.URL == "" {
		c.URL = DefaultAPNsURL
	}
	if c.SandboxURL == "" {
		c.SandboxURL = DefaultAPNsSandboxURL
	}
	for name, u := range map[string]string{"APNS_URL": c.URL, "APNS_SANDBOX_URL": c.SandboxURL} {
		if err := checkBaseURL(u); err != nil {
			bad("%s %v", name, err)
		}
	}
	c.URL, c.SandboxURL = strings.TrimRight(c.URL, "/"), strings.TrimRight(c.SandboxURL, "/")

	var data []byte
	switch {
	case strings.TrimSpace(keyText) != "" && keyFile != "":
		bad("APNs: set APNS_KEY or APNS_KEY_FILE, not both")
	case strings.TrimSpace(keyText) != "":
		data, c.KeySource = []byte(keyText), "APNS_KEY"
	case keyFile != "":
		b, err := os.ReadFile(keyFile)
		if err != nil {
			bad("APNs: can't read APNS_KEY_FILE (%v)", errors.Unwrap(err))
		}
		data, c.KeySource = b, keyFile
	default:
		bad("APNs is half set up: APNS_KEY (the .p8 key's contents) or APNS_KEY_FILE (its path) is missing")
	}
	if data != nil {
		key, err := ParseAPNsKey(data)
		if err != nil {
			bad("APNs: %v", err)
		}
		c.Key = key
	}
	if keyID == "" {
		bad("APNs is half set up: APNS_KEY_ID (the key's 10-character id) is missing")
	}
	if teamID == "" {
		bad("APNs is half set up: APNS_TEAM_ID (your Apple developer team id) is missing")
	}
	if len(topics) == 0 {
		bad("APNs is half set up: APNS_TOPICS (the apps' bundle ids, comma separated) is missing")
	}
	return c, problems
}

// ParseAPNsKey reads Apple's .p8 key: PEM, PEM with its newlines written as
// \n (as some hosts keep env values), or just the base64 inside it.
func ParseAPNsKey(data []byte) (*ecdsa.PrivateKey, error) {
	s := strings.TrimSpace(string(data))
	if !strings.Contains(s, "\n") && strings.Contains(s, `\n`) {
		s = strings.ReplaceAll(s, `\n`, "\n")
	}
	var der []byte
	if block, _ := pem.Decode([]byte(s)); block != nil {
		der = block.Bytes
	} else {
		clean := strings.Join(strings.Fields(s), "")
		var err error
		for _, enc := range []*base64.Encoding{base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding} {
			if der, err = enc.DecodeString(clean); err == nil {
				break
			}
		}
		if err != nil {
			return nil, errors.New("the key isn't a .p8 file's contents (PEM, or the base64 inside it)")
		}
	}
	var key *ecdsa.PrivateKey
	if k, err := x509.ParsePKCS8PrivateKey(der); err == nil {
		key, _ = k.(*ecdsa.PrivateKey)
	} else if k, err := x509.ParseECPrivateKey(der); err == nil {
		key = k
	}
	if key == nil || key.Curve != elliptic.P256() {
		return nil, errors.New("the key isn't an APNs key (a P-256 private key, the .p8 Apple gives)")
	}
	return key, nil
}

func fcmFromEnv(env func(string) string) (*FCMConfig, []string) {
	project, creds, apps := env("FCM_PROJECT"), env("FCM_CREDENTIALS"), splitList(env("FCM_APPS"))
	if project == "" && creds == "" {
		if len(apps) > 0 {
			return nil, []string{"FCM_APPS is set but FCM isn't: set FCM_PROJECT (your Firebase project's id)"}
		}
		return nil, nil
	}
	var problems []string
	bad := func(format string, args ...any) { problems = append(problems, fmt.Sprintf(format, args...)) }
	c := &FCMConfig{Project: project, Apps: apps, URL: env("FCM_URL"),
		TokenURL: env("FCM_TOKEN_URL"), MetadataURL: env("FCM_METADATA_URL")}
	if c.URL == "" {
		c.URL = DefaultFCMURL
	}
	if c.MetadataURL == "" {
		c.MetadataURL = DefaultMetadataURL
	}
	for name, u := range map[string]string{"FCM_URL": c.URL, "FCM_METADATA_URL": c.MetadataURL, "FCM_TOKEN_URL": c.TokenURL} {
		if u == "" {
			continue
		}
		if err := checkBaseURL(u); err != nil {
			bad("%s %v", name, err)
		}
	}
	c.URL = strings.TrimRight(c.URL, "/")
	if creds != "" {
		sa, source, err := ParseServiceAccount(creds)
		if err != nil {
			bad("FCM_CREDENTIALS: %v", err)
		} else {
			c.Credentials, c.CredentialsSource = sa, source
			if c.Project == "" {
				c.Project = sa.ProjectID
			}
		}
	}
	if c.Project == "" && len(problems) == 0 {
		bad("FCM_PROJECT (your Firebase project's id) is missing")
	}
	return c, problems
}

// ParseServiceAccount reads a Google service account key: its JSON, or the
// path of a file with it.
func ParseServiceAccount(v string) (*ServiceAccount, string, error) {
	data, source := []byte(v), "FCM_CREDENTIALS"
	if !strings.HasPrefix(strings.TrimSpace(v), "{") {
		b, err := os.ReadFile(v)
		if err != nil {
			return nil, "", fmt.Errorf("isn't a service account's JSON, and can't be read as a file (%v)", errors.Unwrap(err))
		}
		data, source = b, v
	}
	var sa ServiceAccount
	if err := json.Unmarshal(data, &sa); err != nil {
		return nil, "", errors.New("isn't valid JSON")
	}
	if sa.Type != "service_account" || sa.ClientEmail == "" || sa.PrivateKey == "" {
		return nil, "", errors.New("must be a service account's key (\"type\": \"service_account\", with client_email and private_key); " +
			"leave it unset on Google Cloud to use the service's own account")
	}
	block, _ := pem.Decode([]byte(sa.PrivateKey))
	if block == nil {
		return nil, "", errors.New("its private_key isn't PEM")
	}
	k, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		if k, err = x509.ParsePKCS1PrivateKey(block.Bytes); err != nil {
			return nil, "", errors.New("its private_key isn't an RSA key")
		}
	}
	rk, ok := k.(*rsa.PrivateKey)
	if !ok {
		return nil, "", errors.New("its private_key isn't an RSA key")
	}
	sa.key = rk
	if sa.TokenURI == "" {
		sa.TokenURI = DefaultGoogleTokenURL
	}
	return &sa, source, nil
}

func checkBaseURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return errors.New("must be an http(s) URL")
	}
	return nil
}

// Summary says what's configured, in lines, never a secret.
func (c *Config) Summary() []string {
	onOff := func(b bool) string {
		if b {
			return "on"
		}
		return "off"
	}
	var lines []string
	lines = append(lines, "listen: "+c.Listen)
	if c.URL != "" {
		lines = append(lines, "address: "+c.URL+" (endpoints are "+c.URL+"/v1/push/..., machines sign for it)")
	} else {
		lines = append(lines, "address: not set (RELAY_URL)")
	}
	if len(c.OldURLs) > 0 {
		lines = append(lines, "older addresses machines may still sign for: "+strings.Join(c.OldURLs, ", "))
	}
	secret := "not set"
	if len(c.Secret) >= MinSecretLen {
		secret = "set"
	} else if c.Secret != "" {
		secret = "set, too short"
	}
	if n := len(c.OldSecrets); n > 0 {
		secret += fmt.Sprintf(", and %d older still opened (RELAY_SECRETS)", n)
	}
	lines = append(lines, "secret: "+secret)

	if a := c.APNs; a != nil {
		key := "no key"
		if a.Key != nil {
			key = "key from " + a.KeySource
		}
		lines = append(lines, fmt.Sprintf("apns: %s (%s, id %q, team %q; apps %s; %s, sandbox %s)",
			onOff(a.ready()), key, a.KeyID, a.TeamID, listOr(a.Topics, "none"), a.URL, a.SandboxURL))
	} else {
		lines = append(lines, "apns: off (no APNS_KEY)")
	}
	if f := c.FCM; f != nil {
		creds := "Google Cloud's own service account (" + f.MetadataURL + ")"
		if f.Credentials != nil {
			creds = "service account " + f.Credentials.ClientEmail + " from " + f.CredentialsSource
		}
		lines = append(lines, fmt.Sprintf("fcm: %s (project %q, %s; apps %s; %s)",
			onOff(f.Project != ""), f.Project, creds, listOr(f.Apps, "any"), f.URL))
	} else {
		lines = append(lines, "fcm: off (no FCM_PROJECT)")
	}
	l := c.Limits
	lines = append(lines, fmt.Sprintf("limits: a device %d at once then %d a minute; an address %d registrations then %d an hour, %d pushes then %d a minute",
		l.DeviceBurst, l.DevicePerMin, l.RegisterBurst, l.RegisterPerHour, l.PushBurst, l.PushPerMin))
	if c.ClientIPHeader != "" {
		lines = append(lines, "client address: the "+c.ClientIPHeader+" header (RELAY_CLIENT_IP_HEADER)")
	} else if c.TrustProxy {
		lines = append(lines, "client address: the last X-Forwarded-For entry (RELAY_TRUST_PROXY=1)")
	} else {
		lines = append(lines, "client address: the connection's (RELAY_TRUST_PROXY off)")
	}
	return lines
}

func (a *APNsConfig) ready() bool {
	return a != nil && a.Key != nil && a.KeyID != "" && a.TeamID != "" && len(a.Topics) > 0
}

// isToken says whether s can be a header's name (RFC 9110 5.1).
func isToken(s string) bool {
	for i := 0; i < len(s); i++ {
		c := s[i]
		if !(c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || strings.IndexByte("!#$%&'*+-.^_`|~", c) >= 0) {
			return false
		}
	}
	return s != ""
}

func listOr(list []string, none string) string {
	if len(list) == 0 {
		return none
	}
	return strings.Join(list, ", ")
}

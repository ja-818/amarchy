package relay

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"math/big"
	"net/http"
	"slices"
	"strings"
	"time"
)

// What a push may be (RFC 8030, RFC 8291, RFC 8292).
const (
	maxRecord     = 2900 // base64url in a 4 KB APNs payload, with the rest of it
	maxTTL        = 28 * 24 * 3600
	maxTopic      = 32
	maxAuthHeader = 4096
	maxExp        = 24 * time.Hour
	expLeeway     = time.Minute
	// salt, record size, key id length, the server's one-time key, then
	// at least a padding delimiter and the tag.
	recordHeader = 16 + 4 + 1 + serverKeyLen
	minRecord    = recordHeader + 17
)

// reqError is a refusal: its status and the words that say why. The words
// never echo what the request carried, so they're safe to log.
type reqError struct {
	status int
	msg    string
}

func refuse(status int, msg string) *reqError { return &reqError{status, msg} }

// parseVAPID reads `Authorization: vapid t=<JWT>, k=<key>` (RFC 8292).
func parseVAPID(h string) (jwt string, key []byte, ok bool) {
	if len(h) > maxAuthHeader {
		return "", nil, false
	}
	scheme, rest, found := strings.Cut(strings.TrimSpace(h), " ")
	if !found || !strings.EqualFold(scheme, "vapid") {
		return "", nil, false
	}
	var k string
	for _, part := range strings.Split(rest, ",") {
		name, value, found := strings.Cut(strings.TrimSpace(part), "=")
		if !found {
			return "", nil, false
		}
		value = strings.Trim(strings.TrimSpace(value), `"`)
		switch strings.ToLower(strings.TrimSpace(name)) {
		case "t":
			jwt = value
		case "k":
			k = value
		}
	}
	if jwt == "" || k == "" {
		return "", nil, false
	}
	key, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(k, "="))
	if err != nil || len(key) != serverKeyLen {
		return "", nil, false
	}
	return jwt, key, true
}

// checkVAPID says whether the request was signed by the machine the handle
// was made for, for this relay (origins: its address, then the older ones
// endpoints may still start with), recently.
func checkVAPID(auth string, serverKey []byte, origins []string, now time.Time) *reqError {
	jwt, k, ok := parseVAPID(auth)
	if !ok {
		return refuse(http.StatusUnauthorized, "Authorization must be: vapid t=<JWT>, k=<the machine's key, base64url>")
	}
	if !bytes.Equal(k, serverKey) {
		return refuse(http.StatusForbidden, "this endpoint was made for another key than k")
	}
	parts := strings.Split(jwt, ".")
	if len(parts) != 3 {
		return refuse(http.StatusUnauthorized, "t isn't a JWT")
	}
	var header struct {
		Alg string `json:"alg"`
	}
	if !decodeJWTPart(parts[0], &header) || header.Alg != "ES256" {
		return refuse(http.StatusUnauthorized, "the JWT must be signed with ES256")
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || len(sig) != 64 {
		return refuse(http.StatusUnauthorized, "the JWT's signature must be ES256's 64 bytes (r and s)")
	}
	pub, err := ecdsa.ParseUncompressedPublicKey(elliptic.P256(), k)
	if err != nil {
		return refuse(http.StatusUnauthorized, "k isn't a P-256 public key")
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	r, s := new(big.Int).SetBytes(sig[:32]), new(big.Int).SetBytes(sig[32:])
	if !ecdsa.Verify(pub, digest[:], r, s) {
		return refuse(http.StatusUnauthorized, "the JWT's signature doesn't verify with k")
	}
	var claims struct {
		Aud json.RawMessage `json:"aud"`
		Exp json.Number     `json:"exp"`
	}
	if !decodeJWTPart(parts[1], &claims) {
		return refuse(http.StatusUnauthorized, "the JWT's claims aren't JSON")
	}
	if !audIs(claims.Aud, origins) {
		return refuse(http.StatusForbidden, "the JWT's aud must be this relay: "+origins[0])
	}
	exp, err := claims.Exp.Float64()
	if err != nil {
		return refuse(http.StatusUnauthorized, "the JWT has no exp")
	}
	// In float seconds, so no exp, however large, overflows.
	nowS := float64(now.Unix())
	if exp <= nowS {
		return refuse(http.StatusUnauthorized, "the JWT expired")
	}
	if exp > nowS+(maxExp+expLeeway).Seconds() {
		return refuse(http.StatusUnauthorized, "the JWT's exp must be within 24 hours")
	}
	return nil
}

func decodeJWTPart(part string, into any) bool {
	b, err := base64.RawURLEncoding.DecodeString(part)
	if err != nil {
		return false
	}
	d := json.NewDecoder(bytes.NewReader(b))
	d.UseNumber()
	return d.Decode(into) == nil
}

// audIs says whether aud is one of the origins, taking it as RFC 7519 has
// it: a string, or a list of them.
func audIs(raw json.RawMessage, origins []string) bool {
	var auds []string
	var one string
	if json.Unmarshal(raw, &one) == nil {
		auds = []string{one}
	} else if json.Unmarshal(raw, &auds) != nil {
		return false
	}
	for _, a := range auds {
		if slices.Contains(origins, a) {
			return true
		}
	}
	return false
}

// pushOptions are a push's headers, checked.
type pushOptions struct {
	ttl     int
	urgency string
	topic   string
}

func parsePushHeaders(h http.Header) (pushOptions, *reqError) {
	var o pushOptions
	ttl := strings.TrimSpace(h.Get("TTL"))
	if ttl == "" {
		return o, refuse(http.StatusBadRequest, "TTL is required: the seconds the push may wait for the phone")
	}
	for _, c := range ttl {
		if c < '0' || c > '9' {
			return o, refuse(http.StatusBadRequest, "TTL must be a whole number of seconds, 0 or more")
		}
	}
	// Past the cap the push service lowers it (RFC 8030 5.2), so a long
	// string of digits needn't parse: it's the cap.
	o.ttl = maxTTL
	if len(ttl) <= 9 {
		n := 0
		for _, c := range ttl {
			n = n*10 + int(c-'0')
		}
		o.ttl = min(n, maxTTL)
	}

	switch u := strings.ToLower(strings.TrimSpace(h.Get("Urgency"))); u {
	case "":
		o.urgency = "normal"
	case "very-low", "low", "normal", "high":
		o.urgency = u
	default:
		return o, refuse(http.StatusBadRequest, "Urgency must be very-low, low, normal or high")
	}

	if t := strings.TrimSpace(h.Get("Topic")); t != "" {
		if len(t) > maxTopic {
			return o, refuse(http.StatusBadRequest, "Topic must be 32 characters or fewer")
		}
		for _, c := range t {
			if !isBase64URL(c) {
				return o, refuse(http.StatusBadRequest, "Topic must use only base64url's characters (A-Z a-z 0-9 - _)")
			}
		}
		o.topic = t
	}
	return o, nil
}

func isBase64URL(c rune) bool {
	return c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-' || c == '_'
}

// checkRecord says whether a body is shaped like one aes128gcm record for
// Web Push (RFC 8188 2.1, RFC 8291 4): it can't read it, only its frame.
func checkRecord(b []byte) *reqError {
	if len(b) < minRecord {
		return refuse(http.StatusBadRequest, "the body is too short for an aes128gcm record")
	}
	if rs := binary.BigEndian.Uint32(b[16:20]); rs < 18 {
		return refuse(http.StatusBadRequest, "the record size must be 18 or more")
	} else if uint64(len(b)-recordHeader) > uint64(rs) {
		return refuse(http.StatusBadRequest, "the body must be one record (no longer than its record size)")
	}
	if b[20] != serverKeyLen || b[21] != 0x04 {
		return refuse(http.StatusBadRequest, "the record's key id must be the server's 65-byte public key (RFC 8291)")
	}
	return nil
}

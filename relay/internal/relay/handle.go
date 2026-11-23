package relay

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"time"
)

// A handle is the device, sealed: the relay keeps no database, so the
// endpoint it gives out carries everything it needs to send, readable and
// forgeable only with its secret.
//
//	header: version (1) | key id (2)          authenticated, not secret
//	nonce (12) | AES-256-GCM of the body | tag (16)
//	body:   platform (1) | issued (4, unix seconds) | len(app) (1) | app |
//	        server key (65) | token (the rest; APNs' as its raw bytes)
const (
	handleVersion  = 1
	handleHeader   = 3
	handleNonce    = 12
	serverKeyLen   = 65
	maxHandleChars = 8192 // an FCM token's 4096 bytes, sealed, with room
)

// Platforms, as they are in a handle.
const (
	platformAPNs        byte = 1
	platformAPNsSandbox byte = 2
	platformFCM         byte = 3
)

var platformNames = map[byte]string{platformAPNs: "apns", platformAPNsSandbox: "apns-sandbox", platformFCM: "fcm"}

var errBadHandle = errors.New("not a handle this relay made")

// Device is what a handle holds.
type Device struct {
	Platform  string // "apns", "apns-sandbox" or "fcm"
	Token     string // APNs: lowercase hex; FCM: as given
	App       string // the bundle id or package name (APNs' topic)
	ServerKey []byte // the machine's VAPID public key, 65 bytes
	Issued    time.Time
}

type sealKey struct {
	id   [2]byte
	aead cipher.AEAD
}

// sealer seals with the current secret and opens with it or an older one,
// so a secret can be rotated without breaking the endpoints phones hold.
type sealer struct{ keys []sealKey }

func newSealer(current string, older []string) (*sealer, error) {
	s := &sealer{}
	for _, secret := range append([]string{current}, older...) {
		key, err := hkdf.Key(sha256.New, []byte(secret), nil, "amarchy-relay handle key v1", 32)
		if err != nil {
			return nil, err
		}
		id, err := hkdf.Key(sha256.New, []byte(secret), nil, "amarchy-relay handle key id v1", 2)
		if err != nil {
			return nil, err
		}
		block, err := aes.NewCipher(key)
		if err != nil {
			return nil, err
		}
		aead, err := cipher.NewGCM(block)
		if err != nil {
			return nil, err
		}
		s.keys = append(s.keys, sealKey{id: [2]byte(id), aead: aead})
	}
	return s, nil
}

func platformByte(name string) (byte, bool) {
	for b, n := range platformNames {
		if n == name {
			return b, true
		}
	}
	return 0, false
}

func (s *sealer) seal(d Device) (string, error) {
	p, ok := platformByte(d.Platform)
	if !ok || len(d.App) == 0 || len(d.App) > 255 || len(d.ServerKey) != serverKeyLen || d.Token == "" {
		return "", errors.New("relay: can't seal an incomplete device")
	}
	token := []byte(d.Token)
	if p != platformFCM {
		var err error
		if token, err = hex.DecodeString(d.Token); err != nil {
			return "", err
		}
	}
	body := make([]byte, 0, 1+4+1+len(d.App)+serverKeyLen+len(token))
	body = append(body, p)
	body = binary.BigEndian.AppendUint32(body, uint32(d.Issued.Unix()))
	body = append(body, byte(len(d.App)))
	body = append(body, d.App...)
	body = append(body, d.ServerKey...)
	body = append(body, token...)

	k := s.keys[0]
	out := make([]byte, handleHeader+handleNonce, handleHeader+handleNonce+len(body)+k.aead.Overhead())
	out[0], out[1], out[2] = handleVersion, k.id[0], k.id[1]
	if _, err := rand.Read(out[handleHeader:]); err != nil {
		return "", err
	}
	out = k.aead.Seal(out, out[handleHeader:handleHeader+handleNonce], body, out[:handleHeader])
	return base64.RawURLEncoding.EncodeToString(out), nil
}

func (s *sealer) open(h string) (Device, error) {
	if len(h) == 0 || len(h) > maxHandleChars {
		return Device{}, errBadHandle
	}
	raw, err := base64.RawURLEncoding.Strict().DecodeString(h)
	if err != nil || len(raw) < handleHeader+handleNonce+16 || raw[0] != handleVersion {
		return Device{}, errBadHandle
	}
	header, nonce, sealed := raw[:handleHeader], raw[handleHeader:handleHeader+handleNonce], raw[handleHeader+handleNonce:]
	for _, k := range s.keys {
		if header[1] != k.id[0] || header[2] != k.id[1] {
			continue
		}
		body, err := k.aead.Open(nil, nonce, sealed, header)
		if err != nil {
			continue // two secrets can share an id: try the next
		}
		return parseHandleBody(body)
	}
	return Device{}, errBadHandle
}

func parseHandleBody(b []byte) (Device, error) {
	if len(b) < 1+4+1 {
		return Device{}, errBadHandle
	}
	name, ok := platformNames[b[0]]
	if !ok {
		return Device{}, errBadHandle
	}
	issued := time.Unix(int64(binary.BigEndian.Uint32(b[1:5])), 0)
	n := int(b[5])
	rest := b[6:]
	if n == 0 || len(rest) < n+serverKeyLen+1 {
		return Device{}, errBadHandle
	}
	d := Device{Platform: name, App: string(rest[:n]), Issued: issued}
	d.ServerKey = append([]byte(nil), rest[n:n+serverKeyLen]...)
	token := rest[n+serverKeyLen:]
	if b[0] == platformFCM {
		d.Token = string(token)
	} else {
		d.Token = hex.EncodeToString(token)
	}
	return d, nil
}

// deviceID names a device in logs and keys its rate limit: a hash of its
// handle, never the handle (which is a capability) or the token.
func deviceID(handle string) string {
	sum := sha256.Sum256([]byte(handle))
	return hex.EncodeToString(sum[:4])
}

func deviceKey(handle string) string {
	sum := sha256.Sum256([]byte(handle))
	return string(sum[:])
}

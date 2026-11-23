package relay

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// The two ends of RFC 8291, as the machine (bin/amarchy's push_encrypt) and
// the phone (its Notification Service Extension, its messaging service) do
// them: the relay sits between and must hand over the record untouched.

// webPushKeys derives the content key and nonce (RFC 8291 3.3, 3.4).
func webPushKeys(secret, auth, uaPublic, asPublic, salt []byte) (cek, nonce []byte, err error) {
	info := "WebPush: info\x00" + string(uaPublic) + string(asPublic)
	ikm, err := hkdf.Key(sha256.New, secret, auth, info, 32)
	if err != nil {
		return nil, nil, err
	}
	if cek, err = hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: aes128gcm\x00", 16); err != nil {
		return nil, nil, err
	}
	nonce, err = hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: nonce\x00", 12)
	return cek, nonce, err
}

// encryptRecord is the machine's side: a one-time key, one record.
func encryptRecord(uaPublic, auth, plaintext []byte) ([]byte, error) {
	ua, err := ecdh.P256().NewPublicKey(uaPublic)
	if err != nil {
		return nil, err
	}
	as, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	secret, err := as.ECDH(ua)
	if err != nil {
		return nil, err
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return nil, err
	}
	asPublic := as.PublicKey().Bytes()
	cek, nonce, err := webPushKeys(secret, auth, uaPublic, asPublic, salt)
	if err != nil {
		return nil, err
	}
	block, _ := aes.NewCipher(cek)
	gcm, _ := cipher.NewGCM(block)
	out := append([]byte{}, salt...)
	out = binary.BigEndian.AppendUint32(out, 4096)
	out = append(out, byte(len(asPublic)))
	out = append(out, asPublic...)
	return gcm.Seal(out, nonce, append(append([]byte{}, plaintext...), 2), nil), nil
}

// decryptRecord is the phone's side.
func decryptRecord(ua *ecdh.PrivateKey, auth, record []byte) ([]byte, error) {
	if len(record) < 21 {
		return nil, errors.New("too short")
	}
	salt, idlen := record[:16], int(record[20])
	if len(record) < 21+idlen+17 {
		return nil, errors.New("too short")
	}
	keyid, ct := record[21:21+idlen], record[21+idlen:]
	as, err := ecdh.P256().NewPublicKey(keyid)
	if err != nil {
		return nil, err
	}
	secret, err := ua.ECDH(as)
	if err != nil {
		return nil, err
	}
	cek, nonce, err := webPushKeys(secret, auth, ua.PublicKey().Bytes(), keyid, salt)
	if err != nil {
		return nil, err
	}
	block, _ := aes.NewCipher(cek)
	gcm, _ := cipher.NewGCM(block)
	plain, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return nil, err
	}
	// Padding is zeros after a 0x02 delimiter (the last record's).
	plain = bytes.TrimRight(plain, "\x00")
	if len(plain) == 0 || plain[len(plain)-1] != 2 {
		return nil, errors.New("no padding delimiter")
	}
	return plain[:len(plain)-1], nil
}

type pushVector struct {
	Name       string  `json:"name"`
	UAPrivate  string  `json:"ua_private"`
	UAPKCS8    string  `json:"ua_private_pkcs8"`
	UAPublic   string  `json:"ua_public"`
	Auth       string  `json:"auth"`
	Record     string  `json:"record"`
	Plaintext  *string `json:"plaintext"`
	privateKey *ecdh.PrivateKey
	auth       []byte
	record     []byte
}

func b64d(t testing.TB, s string) []byte {
	t.Helper()
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		t.Fatalf("base64url %q: %v", s, err)
	}
	return b
}

func loadVectors(t testing.TB) []pushVector {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "phone", "testdata", "push-vectors.json"))
	if err != nil {
		t.Fatalf("the phones' push vectors: %v", err)
	}
	var file struct {
		Vectors []pushVector `json:"vectors"`
	}
	if err := json.Unmarshal(data, &file); err != nil {
		t.Fatal(err)
	}
	if len(file.Vectors) == 0 {
		t.Fatal("no push vectors")
	}
	for i := range file.Vectors {
		v := &file.Vectors[i]
		k, err := ecdh.P256().NewPrivateKey(b64d(t, v.UAPrivate))
		if err != nil {
			t.Fatalf("%s: ua_private: %v", v.Name, err)
		}
		if !bytes.Equal(k.PublicKey().Bytes(), b64d(t, v.UAPublic)) {
			t.Fatalf("%s: ua_public isn't ua_private's", v.Name)
		}
		// The same key as the phones load it (PKCS#8).
		pk, err := x509.ParsePKCS8PrivateKey(b64d(t, v.UAPKCS8))
		if err != nil {
			t.Fatalf("%s: ua_private_pkcs8: %v", v.Name, err)
		}
		if pk8, err := pk.(interface {
			ECDH() (*ecdh.PrivateKey, error)
		}).ECDH(); err != nil || !pk8.Equal(k) {
			t.Fatalf("%s: ua_private_pkcs8 isn't ua_private", v.Name)
		}
		v.privateKey, v.auth, v.record = k, b64d(t, v.Auth), b64d(t, v.Record)
	}
	return file.Vectors
}

func TestPushVectorsDecrypt(t *testing.T) {
	sawFailure, sawRFC := false, false
	for _, v := range loadVectors(t) {
		t.Run(v.Name, func(t *testing.T) {
			got, err := decryptRecord(v.privateKey, v.auth, v.record)
			if v.Plaintext == nil {
				sawFailure = true
				if err == nil {
					t.Fatalf("decrypted a record that must fail: %q", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("decrypt: %v", err)
			}
			if string(got) != *v.Plaintext {
				t.Fatalf("decrypted %q, want %q", got, *v.Plaintext)
			}
			if v.Name == "RFC 8291 section 5" {
				sawRFC = true
			}
			// What the relay checks of a record holds for every real one.
			if rerr := checkRecord(v.record); rerr != nil {
				t.Fatalf("the relay would refuse it: %s", rerr.msg)
			}
			if len(v.record) > maxRecord {
				t.Fatalf("%d bytes: over the relay's %d", len(v.record), maxRecord)
			}
		})
	}
	if !sawFailure || !sawRFC {
		t.Fatalf("the vectors lost their RFC example (%v) or their must-fail one (%v)", sawRFC, sawFailure)
	}
}

func TestEncryptRoundTrip(t *testing.T) {
	ua, _ := ecdh.P256().GenerateKey(rand.Reader)
	auth := make([]byte, 16)
	rand.Read(auth)
	msg := []byte(`{"title":"Fix the login"}`)
	rec, err := encryptRecord(ua.PublicKey().Bytes(), auth, msg)
	if err != nil {
		t.Fatal(err)
	}
	if rerr := checkRecord(rec); rerr != nil {
		t.Fatal(rerr.msg)
	}
	got, err := decryptRecord(ua, auth, rec)
	if err != nil || !bytes.Equal(got, msg) {
		t.Fatalf("round trip: %q, %v", got, err)
	}
	other := make([]byte, 16)
	if _, err := decryptRecord(ua, other, rec); err == nil {
		t.Fatal("decrypted with the wrong auth secret")
	}
}

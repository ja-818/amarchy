# The push vectors every decrypting side tests against (the relay's Go
# tests, the iOS extension's, Android's): notifications encrypted for a
# phone by the server's own code (bin/amarchy's push_encrypt, RFC 8291's
# aes128gcm), with the phone's keys, and RFC 8291's own example. Each is
# checked here, decrypted again, before it's written.
#
#   python3 phone/testdata/make-vectors.py      writes phone/testdata/push-vectors.json

import importlib.machinery, importlib.util, json, os, sys, tempfile
from pathlib import Path

home = tempfile.mkdtemp(prefix="push-vectors-", dir=os.environ.get("TMPDIR"))
os.environ.update(HOME=home, XDG_STATE_HOME=home + "/state", XDG_CONFIG_HOME=home + "/config")
os.environ.pop("AMARCHY_SESSION", None)
root = Path(__file__).resolve().parent.parent.parent
loader = importlib.machinery.SourceFileLoader("amarchy_under_test", str(root / "bin/amarchy"))
am = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(am)

OID = bytes.fromhex("06082a8648ce3d030107")


def sec1(d, pub):
    """A P-256 private key (its 32 bytes and its point) as SEC1 DER."""
    return bytes([0x30, 0x77, 0x02, 0x01, 0x01, 0x04, 0x20]) + d + bytes([0xa0, 0x0a]) + OID + \
        bytes([0xa1, 0x44, 0x03, 0x42, 0x00]) + pub


def pkcs8(d, pub):
    """The same key as PKCS#8 DER (what Java's KeyFactory reads)."""
    alg = bytes([0x30, 0x13, 0x06, 0x07]) + bytes.fromhex("2a8648ce3d0201") + OID
    inner = sec1(d, pub)
    octets = bytes([0x04, len(inner)]) + inner
    body = bytes([0x02, 0x01, 0x00]) + alg + octets
    return bytes([0x30, 0x81, len(body)]) + body


def key_file(d, pub):
    path = Path(home) / f"k{os.urandom(4).hex()}.der"
    path.write_bytes(sec1(d, pub))
    pem = Path(str(path) + ".pem")
    pem.write_bytes(am.openssl("ec", "-inform", "DER", "-in", str(path)))
    return pem


def raw_private(pem):
    """The 32 bytes of a private key file's scalar."""
    der = am.openssl("ec", "-in", str(pem), "-outform", "DER")
    return der[7:39]


def decrypt(record, d, pub, auth):
    """RFC 8291's aes128gcm read back, as a phone does: the plaintext."""
    salt, rs, idlen = record[:16], int.from_bytes(record[16:20], "big"), record[20]
    as_public, ct = record[21:21 + idlen], record[21 + idlen:]
    secret = am.ecdh(key_file(d, pub), as_public)
    ikm = am.hkdf(auth, secret, b"WebPush: info\0" + pub + as_public, 32)
    cek = am.hkdf(salt, ikm, b"Content-Encoding: aes128gcm\0", 16)
    nonce = am.hkdf(salt, ikm, b"Content-Encoding: nonce\0", 12)
    # GCM's keystream is its own inverse: encrypt the ciphertext's bytes to
    # get the plaintext, then encrypt that again to check the tag.
    body, tag = ct[:-16], ct[-16:]
    plain = am.aes128gcm(cek, nonce, body)[:-16]
    if am.aes128gcm(cek, nonce, plain)[-16:] != tag:
        raise ValueError("the tag doesn't match")
    if rs < 18 or len(record) > rs + 86:
        raise ValueError("record size")
    plain = plain.rstrip(b"\0")
    if not plain.endswith(b"\2"):
        raise ValueError("not the last record")
    return plain[:-1]


vectors = []

# RFC 8291, section 5: its keys, salt and record.
rfc = {"name": "RFC 8291 section 5",
       "ua_private": "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
       "ua_public": "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
       "auth": "BTBZMqHH6r4Tts7J_aSIgg",
       "record": "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
       "plaintext": "When I grow up, I want to be a watermelon"}
d, pub, auth = am.unb64u(rfc["ua_private"]), am.unb64u(rfc["ua_public"]), am.unb64u(rfc["auth"])
got = decrypt(am.unb64u(rfc["record"]), d, pub, auth)
assert got == rfc["plaintext"].encode(), got
rfc["ua_private_pkcs8"] = am.b64u(pkcs8(d, pub))
vectors.append(rfc)

# The server's own: a phone's keys made as a phone makes them, notifications
# as the server sends a phone app (its buttons, its address, a long body).
payloads = [
    {"title": "Fix the login", "body": "Asks: Allow Bash: npm test?\nHouston Os", "tag": "houston-os-fix-login",
     "url": "/#/s/houston-os-fix-login", "ask": "houston-os-fix-login", "waiting": 2,
     "server": "https://amarchy.example.ts.net", "session": "houston-os-fix-login", "sound": "chime",
     "actions": [{"label": "Allow", "path": "/api/session/houston-os-fix-login/answer",
                  "body": {"request_id": "r1", "choice": "allow"}},
                 {"label": "Deny", "path": "/api/session/houston-os-fix-login/answer",
                  "body": {"request_id": "r1", "choice": "deny"}}]},
    {"title": "Amarchy", "body": "Notifications work.", "tag": "amarchy-test", "url": "/"},
    {"title": "Ünïcode ✓ 日本語", "body": "Done: " + "a long reply " * 150, "tag": "x", "url": "/#/s/x", "waiting": 0},
]
for i, payload in enumerate(payloads):
    pem = Path(home) / f"device{i}.pem"
    am.ec_new(pem)
    pub = am.ec_public(pem)
    d = raw_private(pem)
    auth = os.urandom(16)
    keys = {"p256dh": am.b64u(pub), "auth": am.b64u(auth)}
    plain = json.dumps(payload).encode()
    record = am.push_encrypt(keys, plain)
    assert decrypt(record, d, pub, auth) == plain
    vectors.append({"name": f"bin/amarchy push_encrypt {i}", "ua_private": am.b64u(d),
                    "ua_private_pkcs8": am.b64u(pkcs8(d, pub)), "ua_public": keys["p256dh"],
                    "auth": keys["auth"], "record": am.b64u(record), "plaintext": plain.decode()})

# One a phone must refuse: the last vector's record with a byte changed.
bad = dict(vectors[-1], name="tampered (must fail)", plaintext=None)
rec = bytearray(am.unb64u(bad["record"]))
rec[-20] ^= 1
bad["record"] = am.b64u(bytes(rec))
vectors.append(bad)

out = Path(__file__).resolve().parent / "push-vectors.json"
out.write_text(json.dumps({"about": "RFC 8291 aes128gcm records and the phone keys to read them (make-vectors.py). "
                                    "ua_private: the P-256 scalar, 32 bytes; ua_private_pkcs8: the same key as PKCS#8 DER; "
                                    "all base64url without padding. plaintext null: decrypting must fail.",
                           "vectors": vectors}, indent=1, ensure_ascii=False) + "\n")
print(f"wrote {out} ({len(vectors)} vectors)")

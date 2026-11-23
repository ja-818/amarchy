package relay

import (
	"bytes"
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	fcmScope = "https://www.googleapis.com/auth/firebase.messaging"
	// An access token is used until this long before it expires.
	tokenEarly = 60 * time.Second
)

type fcmSender struct {
	cfg    *FCMConfig
	client *http.Client
	now    func() time.Time

	mu      sync.Mutex
	access  string
	expires time.Time
}

// accessToken is the cached OAuth token FCM takes; failed (the one FCM just
// refused) is dropped unless another push already replaced it.
func (f *fcmSender) accessToken(ctx context.Context, failed string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.access != "" && f.access != failed && f.now().Before(f.expires.Add(-tokenEarly)) {
		return f.access, nil
	}
	f.access = ""
	var req *http.Request
	var err error
	if sa := f.cfg.Credentials; sa != nil {
		req, err = f.grantRequest(ctx, sa)
	} else {
		// Google Cloud's own: Cloud Run's service account, from the
		// metadata server only the instance can reach.
		req, err = http.NewRequestWithContext(ctx, http.MethodGet, f.cfg.MetadataURL, nil)
		if err == nil {
			req.Header.Set("Metadata-Flavor", "Google")
		}
	}
	if err != nil {
		return "", err
	}
	resp, err := f.client.Do(req)
	if err != nil {
		return "", errors.New("its token server " + netFailure(ctx, err))
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	var tok struct {
		AccessToken string      `json:"access_token"`
		ExpiresIn   json.Number `json:"expires_in"`
		Error       string      `json:"error"`
	}
	_ = json.Unmarshal(b, &tok)
	if resp.StatusCode != http.StatusOK || tok.AccessToken == "" {
		return "", fmt.Errorf("its token server said %d %s", resp.StatusCode, word(tok.Error))
	}
	secs, err := tok.ExpiresIn.Int64()
	if err != nil || secs <= 0 {
		secs = 300
	}
	f.access, f.expires = tok.AccessToken, f.now().Add(time.Duration(secs)*time.Second)
	return f.access, nil
}

// grantRequest asks for a token with the service account's key: a JWT
// bearer grant (RFC 7523), signed RS256.
func (f *fcmSender) grantRequest(ctx context.Context, sa *ServiceAccount) (*http.Request, error) {
	tokenURL := sa.TokenURI
	if f.cfg.TokenURL != "" {
		tokenURL = f.cfg.TokenURL
	}
	now := f.now().Unix()
	header, _ := json.Marshal(map[string]string{"alg": "RS256", "typ": "JWT", "kid": sa.PrivateKeyID})
	claims, _ := json.Marshal(map[string]any{
		"iss": sa.ClientEmail, "scope": fcmScope, "aud": tokenURL, "iat": now, "exp": now + 3600,
	})
	unsigned := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(claims)
	digest := sha256.Sum256([]byte(unsigned))
	sig, err := rsa.SignPKCS1v15(nil, sa.key, crypto.SHA256, digest[:])
	if err != nil {
		return nil, err
	}
	form := url.Values{
		"grant_type": {"urn:ietf:params:oauth:grant-type:jwt-bearer"},
		"assertion":  {unsigned + "." + base64.RawURLEncoding.EncodeToString(sig)},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	return req, nil
}

type fcmRequest struct {
	Message struct {
		Token   string            `json:"token"`
		Data    map[string]string `json:"data"`
		Android struct {
			Priority    string `json:"priority"`
			TTL         string `json:"ttl"`
			CollapseKey string `json:"collapse_key,omitempty"`
		} `json:"android"`
	} `json:"message"`
}

func fcmBody(d Device, m message) []byte {
	var r fcmRequest
	r.Message.Token = d.Token
	r.Message.Data = map[string]string{"p": base64.RawURLEncoding.EncodeToString(m.record)}
	r.Message.Android.Priority = "HIGH"
	r.Message.Android.TTL = strconv.Itoa(m.ttl) + "s"
	r.Message.Android.CollapseKey = m.topic
	b, _ := json.Marshal(r)
	return b
}

// fcmError is FCM v1's error: google.rpc.Status, with FcmError's code and
// BadRequest's field violations in its details.
type fcmError struct {
	Error struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Status  string `json:"status"`
		Details []struct {
			Type            string `json:"@type"`
			ErrorCode       string `json:"errorCode"`
			FieldViolations []struct {
				Field       string `json:"field"`
				Description string `json:"description"`
			} `json:"fieldViolations"`
		} `json:"details"`
	} `json:"error"`
}

func (e *fcmError) code() string {
	for _, d := range e.Error.Details {
		if d.ErrorCode != "" {
			return d.ErrorCode
		}
	}
	return e.Error.Status
}

// aboutToken says whether an INVALID_ARGUMENT is the token's fault (the
// device is gone) rather than the message's (the relay's).
func (e *fcmError) aboutToken() bool {
	for _, d := range e.Error.Details {
		for _, v := range d.FieldViolations {
			if v.Field == "message.token" {
				return true
			}
		}
	}
	return strings.Contains(strings.ToLower(e.Error.Message), "registration token")
}

func (f *fcmSender) send(ctx context.Context, d Device, m message) result {
	body := fcmBody(d, m)
	endpoint := f.cfg.URL + "/v1/projects/" + url.PathEscape(f.cfg.Project) + "/messages:send"
	failed := ""
	for attempt := 0; ; attempt++ {
		tok, err := f.accessToken(ctx, failed)
		if err != nil {
			return result{status: http.StatusBadGateway, msg: "the relay couldn't get an FCM access token: " + err.Error()}
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
		if err != nil {
			return result{status: http.StatusBadGateway, msg: "the relay's FCM address is wrong"}
		}
		req.Header.Set("Authorization", "Bearer "+tok)
		req.Header.Set("Content-Type", "application/json; charset=utf-8")
		resp, err := f.client.Do(req)
		if err != nil {
			return result{status: http.StatusBadGateway, msg: "FCM " + netFailure(ctx, err)}
		}
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
		resp.Body.Close()
		code := resp.StatusCode
		var e fcmError
		_ = json.Unmarshal(b, &e)
		errCode := word(e.code())
		switch {
		case code == http.StatusOK:
			return result{status: http.StatusCreated, upstream: code}
		case code == http.StatusUnauthorized && attempt == 0:
			failed = tok
			continue
		case code == http.StatusNotFound, errCode == "UNREGISTERED",
			errCode == "INVALID_ARGUMENT" && e.aboutToken():
			return result{status: http.StatusGone, upstream: code, msg: "FCM says this device is gone (" + errCode + ")"}
		case code == http.StatusTooManyRequests:
			return result{status: http.StatusTooManyRequests, upstream: code, msg: "FCM says too many pushes",
				retryAfter: upstreamRetryAfter(resp, time.Minute)}
		case code >= 400 && code < 500:
			return result{status: http.StatusBadGateway, upstream: code, msg: fmt.Sprintf("FCM refused it: %d %s", code, errCode)}
		default:
			return result{status: http.StatusBadGateway, upstream: code, msg: fmt.Sprintf("FCM failed: %d %s", code, errCode)}
		}
	}
}

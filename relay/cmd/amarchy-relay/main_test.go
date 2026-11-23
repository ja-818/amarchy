package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"
)

const secretForTests = "a-secret-for-tests-only-0123456789abcdef"

type syncBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *syncBuffer) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.String()
}

func envOf(vars map[string]string) func(string) string {
	return func(k string) string { return vars[k] }
}

func TestSecret(t *testing.T) {
	var out, errs bytes.Buffer
	if code := run(context.Background(), []string{"secret"}, envOf(nil), &out, &errs); code != 0 {
		t.Fatalf("exit %d: %s", code, errs.String())
	}
	s := strings.TrimSpace(out.String())
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil || len(b) != 32 || len(s) < 32 {
		t.Fatalf("secret %q", s)
	}
	var again bytes.Buffer
	run(context.Background(), []string{"secret"}, envOf(nil), &again, &errs)
	if strings.TrimSpace(again.String()) == s {
		t.Fatal("two secrets are the same")
	}
}

func TestCheck(t *testing.T) {
	var out bytes.Buffer
	code := run(context.Background(), []string{"check"}, envOf(map[string]string{"RELAY_SECRET": secretForTests}), &out, io.Discard)
	if code != 2 || !strings.Contains(out.String(), "RELAY_URL is missing") || strings.Contains(out.String(), secretForTests) {
		t.Fatalf("exit %d:\n%s", code, out.String())
	}
	out.Reset()
	code = run(context.Background(), []string{"check"}, envOf(map[string]string{
		"RELAY_SECRET": secretForTests, "RELAY_URL": "https://relay.example.com", "FCM_PROJECT": "p",
	}), &out, io.Discard)
	if code != 0 || !strings.Contains(out.String(), "It can start.") || !strings.Contains(out.String(), "apns: off") ||
		!strings.Contains(out.String(), "fcm: on") || strings.Contains(out.String(), secretForTests) {
		t.Fatalf("exit %d:\n%s", code, out.String())
	}
}

func TestUsage(t *testing.T) {
	var out, errs bytes.Buffer
	if code := run(context.Background(), []string{"nope"}, envOf(nil), &out, &errs); code != 2 || !strings.Contains(errs.String(), "amarchy-relay secret") {
		t.Fatalf("an unknown command: %d %q", code, errs.String())
	}
	if code := run(context.Background(), []string{"--help"}, envOf(nil), &out, &errs); code != 0 || !strings.Contains(out.String(), "check") {
		t.Fatalf("help: %d", code)
	}
}

func TestServeNeedsItsConfig(t *testing.T) {
	var errs bytes.Buffer
	code := run(context.Background(), nil, envOf(map[string]string{"RELAY_SECRET": secretForTests}), io.Discard, &errs)
	if code != 2 || !strings.Contains(errs.String(), "can't start") || !strings.Contains(errs.String(), "RELAY_URL") {
		t.Fatalf("exit %d: %s", code, errs.String())
	}
}

func TestServeAndStop(t *testing.T) {
	ctx, stop := context.WithCancel(context.Background())
	defer stop()
	logs := &syncBuffer{}
	done := make(chan int, 1)
	go func() {
		done <- run(ctx, nil, envOf(map[string]string{
			"RELAY_SECRET": secretForTests, "RELAY_URL": "https://relay.example.com", "RELAY_LISTEN": "127.0.0.1:0",
		}), io.Discard, logs)
	}()
	listening := regexp.MustCompile(`listening on (127\.0\.0\.1:\d+)`)
	var addr string
	for deadline := time.Now().Add(5 * time.Second); addr == "" && time.Now().Before(deadline); time.Sleep(10 * time.Millisecond) {
		if m := listening.FindStringSubmatch(logs.String()); m != nil {
			addr = m[1]
		}
	}
	if addr == "" {
		t.Fatalf("it didn't start:\n%s", logs.String())
	}
	resp, err := http.Get("http://" + addr + "/v1/health")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if string(body) != `{"ok":true,"apns":false,"fcm":false}`+"\n" {
		t.Fatalf("health: %s", body)
	}
	stop() // as SIGTERM does
	select {
	case code := <-done:
		if code != 0 {
			t.Fatalf("stopped with %d:\n%s", code, logs.String())
		}
	case <-time.After(5 * time.Second):
		t.Fatal("it didn't stop")
	}
	if !strings.Contains(logs.String(), "GET health 200") || !strings.Contains(logs.String(), "stopping") {
		t.Fatalf("log:\n%s", logs.String())
	}
}

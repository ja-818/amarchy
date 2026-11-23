package relay

import (
	"container/list"
	"math"
	"sync"
	"time"
)

// maxBuckets bounds each limiter's memory: past it, the least recently
// used bucket goes (a flood of new keys can only refill old ones early).
const maxBuckets = 100_000

// limiter is a set of token buckets, one per key, in memory: the relay
// runs as one instance, so its limits hold without shared state.
type limiter struct {
	mu      sync.Mutex
	burst   float64
	rate    float64 // tokens a second
	max     int
	buckets map[string]*list.Element
	order   *list.List // most recently used first
}

type bucket struct {
	key    string
	tokens float64
	at     time.Time
}

// newLimiter allows burst at once, then n every per.
func newLimiter(burst, n int, per time.Duration, max int) *limiter {
	return &limiter{
		burst:   float64(burst),
		rate:    float64(n) / per.Seconds(),
		max:     max,
		buckets: make(map[string]*list.Element),
		order:   list.New(),
	}
}

// allow takes a token from key's bucket. When there's none it says how long
// until there is.
func (l *limiter) allow(key string, now time.Time) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	var b *bucket
	if e, ok := l.buckets[key]; ok {
		b = e.Value.(*bucket)
		l.order.MoveToFront(e)
		if elapsed := now.Sub(b.at).Seconds(); elapsed > 0 {
			b.tokens = math.Min(l.burst, b.tokens+elapsed*l.rate)
		}
		b.at = now
	} else {
		b = &bucket{key: key, tokens: l.burst, at: now}
		l.buckets[key] = l.order.PushFront(b)
		for l.order.Len() > l.max {
			oldest := l.order.Back()
			l.order.Remove(oldest)
			delete(l.buckets, oldest.Value.(*bucket).key)
		}
	}
	if b.tokens >= 1 {
		b.tokens--
		return true, 0
	}
	return false, time.Duration((1 - b.tokens) / l.rate * float64(time.Second))
}

func (l *limiter) len() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.order.Len()
}

// retryAfter is Retry-After's whole seconds, at least one.
func retryAfter(d time.Duration) int {
	return max(1, int(math.Ceil(d.Seconds())))
}

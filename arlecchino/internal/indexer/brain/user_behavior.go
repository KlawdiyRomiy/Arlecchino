package brain

import (
	"sync"
	"time"
)

type UserBehavior struct {
	mu             sync.RWMutex
	TypingSpeed    float64
	AcceptanceRate float64
	LastAcceptedAt time.Time
	LastTypedAt    time.Time
	LastRejectedAt time.Time
	SessionSymbols []string

	totalShown      int
	totalAccepted   int
	recentTyping    []typingEvent
	maxRecentTyping int
}

type typingEvent struct {
	timestamp time.Time
	chars     int
}

func NewUserBehavior() *UserBehavior {
	return &UserBehavior{
		SessionSymbols:  make([]string, 0, 20),
		recentTyping:    make([]typingEvent, 0, 100),
		maxRecentTyping: 100,
		AcceptanceRate:  0.3,
		TypingSpeed:     3.0,
		LastTypedAt:     time.Time{},
		LastRejectedAt:  time.Time{},
	}
}

func (b *UserBehavior) RecordTyping(chars int) {
	b.mu.Lock()
	defer b.mu.Unlock()

	now := time.Now()
	b.recentTyping = append(b.recentTyping, typingEvent{
		timestamp: now,
		chars:     chars,
	})

	if len(b.recentTyping) > b.maxRecentTyping {
		b.recentTyping = b.recentTyping[1:]
	}

	b.LastTypedAt = now
	b.updateTypingSpeed()
}

func (b *UserBehavior) updateTypingSpeed() {
	if len(b.recentTyping) < 2 {
		return
	}

	cutoff := time.Now().Add(-10 * time.Second)
	var totalChars int
	var startTime, endTime time.Time
	started := false

	for _, evt := range b.recentTyping {
		if evt.timestamp.After(cutoff) {
			if !started {
				startTime = evt.timestamp
				started = true
			}
			endTime = evt.timestamp
			totalChars += evt.chars
		}
	}

	if !started || endTime.Sub(startTime) < 100*time.Millisecond {
		return
	}

	duration := endTime.Sub(startTime).Seconds()
	if duration > 0 {
		b.TypingSpeed = float64(totalChars) / duration
	}
}

func (b *UserBehavior) RecordShown() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.totalShown++
	b.updateAcceptanceRate()
}

func (b *UserBehavior) RecordAccepted(symbol string) {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.totalAccepted++
	b.LastAcceptedAt = time.Now()

	for i, s := range b.SessionSymbols {
		if s == symbol {
			copy(b.SessionSymbols[1:i+1], b.SessionSymbols[0:i])
			b.SessionSymbols[0] = symbol
			b.updateAcceptanceRate()
			return
		}
	}

	if len(b.SessionSymbols) >= 20 {
		b.SessionSymbols = b.SessionSymbols[:19]
	}
	b.SessionSymbols = append([]string{symbol}, b.SessionSymbols...)
	b.updateAcceptanceRate()
}

func (b *UserBehavior) RecordRejected() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.LastRejectedAt = time.Now()
	b.updateAcceptanceRate()
}

func (b *UserBehavior) updateAcceptanceRate() {
	if b.totalShown == 0 {
		return
	}
	b.AcceptanceRate = float64(b.totalAccepted) / float64(b.totalShown)
}

func (b *UserBehavior) AdjustThreshold(base float64) float64 {
	b.mu.RLock()
	defer b.mu.RUnlock()

	if b.AcceptanceRate > 0.4 {
		return base * 0.8
	}
	if b.AcceptanceRate < 0.1 {
		return base * 1.2
	}
	return base
}

func (b *UserBehavior) GetTypingSpeed() float64 {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.TypingSpeed
}

func (b *UserBehavior) GetAcceptanceRate() float64 {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.AcceptanceRate
}

func (b *UserBehavior) GetLastAcceptedAt() time.Time {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.LastAcceptedAt
}

func (b *UserBehavior) GetLastTypedAt() time.Time {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.LastTypedAt
}

func (b *UserBehavior) GetLastRejectedAt() time.Time {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.LastRejectedAt
}

func (b *UserBehavior) GetSessionSymbols() []string {
	b.mu.RLock()
	defer b.mu.RUnlock()
	result := make([]string, len(b.SessionSymbols))
	copy(result, b.SessionSymbols)
	return result
}

func (b *UserBehavior) Reset() {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.totalShown = 0
	b.totalAccepted = 0
	b.TypingSpeed = 3.0
	b.AcceptanceRate = 0.3
	b.LastAcceptedAt = time.Time{}
	b.LastTypedAt = time.Time{}
	b.LastRejectedAt = time.Time{}
	b.SessionSymbols = make([]string, 0, 20)
	b.recentTyping = make([]typingEvent, 0, 100)
}

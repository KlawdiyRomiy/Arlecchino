package ai

import (
	"errors"
	"strings"
	"sync"
	"time"
)

const editorPredictionBackgroundOptInSource = "editor_prediction_background"

type predictionBudgetReservation struct {
	minuteBucket   string
	dayBucket      string
	fileKey        string
	reservedTokens int
	valid          bool
}

type predictionBudgetLedger struct {
	mu                 sync.Mutex
	minuteBucket       string
	dayBucket          string
	requestsThisMinute int
	tokensThisMinute   int
	tokensToday        int
	requestsByFile     map[string]int
	pending            int
	lastRequestAt      time.Time
	cooldownUntil      time.Time
	cooldownReason     string
	minIntervalLeftMs  int
}

func newPredictionBudgetLedger() *predictionBudgetLedger {
	return &predictionBudgetLedger{requestsByFile: map[string]int{}}
}

func predictionMinuteBucket(now time.Time) string {
	return now.UTC().Format("2006-01-02T15:04")
}

func predictionDayBucket(now time.Time) string {
	return now.UTC().Format("2006-01-02")
}

func (l *predictionBudgetLedger) resetWindowsLocked(now time.Time) {
	minute := predictionMinuteBucket(now)
	if l.minuteBucket != minute {
		l.minuteBucket = minute
		l.requestsThisMinute = 0
		l.tokensThisMinute = 0
		l.requestsByFile = map[string]int{}
	}
	day := predictionDayBucket(now)
	if l.dayBucket != day {
		l.dayBucket = day
		l.tokensToday = 0
	}
	if !l.cooldownUntil.IsZero() && !l.cooldownUntil.After(now) {
		l.cooldownUntil = time.Time{}
		l.cooldownReason = ""
	}
}

func (l *predictionBudgetLedger) Snapshot(settings AIPredictionSettings) AIPredictionBudgetSnapshot {
	if l == nil {
		return AIPredictionBudgetSnapshot{}
	}
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	l.resetWindowsLocked(now)
	l.minIntervalLeftMs = 0
	if settings.MinIntervalMs > 0 && !l.lastRequestAt.IsZero() {
		elapsed := now.Sub(l.lastRequestAt)
		minInterval := time.Duration(settings.MinIntervalMs) * time.Millisecond
		if elapsed < minInterval {
			l.minIntervalLeftMs = int((minInterval - elapsed).Milliseconds())
			if l.minIntervalLeftMs < 1 {
				l.minIntervalLeftMs = 1
			}
		}
	}
	return l.snapshotLocked("")
}

func (l *predictionBudgetLedger) Reserve(settings AIPredictionSettings, filePath string, estimatedInputTokens int) (predictionBudgetReservation, AIPredictionBudgetSnapshot, error) {
	if l == nil {
		return predictionBudgetReservation{}, AIPredictionBudgetSnapshot{}, nil
	}
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	l.resetWindowsLocked(now)
	l.minIntervalLeftMs = 0
	if !l.cooldownUntil.IsZero() && l.cooldownUntil.After(now) {
		reason := firstNonEmpty(l.cooldownReason, "provider cooldown")
		return predictionBudgetReservation{}, l.snapshotLocked(reason), errors.New(reason)
	}
	budget := settings.Budget
	if settings.MaxPending > 0 && l.pending >= settings.MaxPending {
		reason := "prediction request already pending"
		return predictionBudgetReservation{}, l.snapshotLocked(reason), errors.New(reason)
	}
	if settings.MinIntervalMs > 0 && !l.lastRequestAt.IsZero() {
		elapsed := now.Sub(l.lastRequestAt)
		minInterval := time.Duration(settings.MinIntervalMs) * time.Millisecond
		if elapsed < minInterval {
			l.minIntervalLeftMs = int((minInterval - elapsed).Milliseconds())
			if l.minIntervalLeftMs < 1 {
				l.minIntervalLeftMs = 1
			}
			reason := "prediction interval budget active"
			return predictionBudgetReservation{}, l.snapshotLocked(reason), errors.New(reason)
		}
	}
	reservedTokens := estimatedInputTokens + settings.MaxOutputTokens
	if reservedTokens < 1 {
		reservedTokens = 1
	}
	fileKey := strings.TrimSpace(filePath)
	if fileKey == "" {
		fileKey = "<unknown>"
	}
	if budget.RequestsPerMinute > 0 && l.requestsThisMinute+1 > budget.RequestsPerMinute {
		reason := "prediction request budget exhausted"
		return predictionBudgetReservation{}, l.snapshotLocked(reason), errors.New(reason)
	}
	if budget.TokensPerMinute > 0 && l.tokensThisMinute+reservedTokens > budget.TokensPerMinute {
		reason := "prediction minute token budget exhausted"
		return predictionBudgetReservation{}, l.snapshotLocked(reason), errors.New(reason)
	}
	if budget.TokensPerDay > 0 && l.tokensToday+reservedTokens > budget.TokensPerDay {
		reason := "prediction daily token budget exhausted"
		return predictionBudgetReservation{}, l.snapshotLocked(reason), errors.New(reason)
	}
	if budget.RequestsPerFilePerMinute > 0 && l.requestsByFile[fileKey]+1 > budget.RequestsPerFilePerMinute {
		reason := "prediction file request budget exhausted"
		return predictionBudgetReservation{}, l.snapshotLocked(reason), errors.New(reason)
	}
	l.requestsThisMinute++
	l.tokensThisMinute += reservedTokens
	l.tokensToday += reservedTokens
	l.requestsByFile[fileKey]++
	l.pending++
	l.lastRequestAt = now
	reservation := predictionBudgetReservation{
		minuteBucket:   l.minuteBucket,
		dayBucket:      l.dayBucket,
		fileKey:        fileKey,
		reservedTokens: reservedTokens,
		valid:          true,
	}
	return reservation, l.snapshotLocked(""), nil
}

func (l *predictionBudgetLedger) Reconcile(reservation predictionBudgetReservation, actualTokens int) {
	if l == nil || !reservation.valid {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.pending > 0 {
		l.pending--
	}
	if actualTokens <= 0 || reservation.reservedTokens <= 0 {
		return
	}
	delta := actualTokens - reservation.reservedTokens
	if delta == 0 {
		return
	}
	if reservation.minuteBucket == l.minuteBucket {
		l.tokensThisMinute += delta
		if l.tokensThisMinute < 0 {
			l.tokensThisMinute = 0
		}
	}
	if reservation.dayBucket == l.dayBucket {
		l.tokensToday += delta
		if l.tokensToday < 0 {
			l.tokensToday = 0
		}
	}
}

func (l *predictionBudgetLedger) Cooldown(reason string, duration time.Duration) {
	if l == nil || duration <= 0 {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	until := time.Now().Add(duration)
	if until.After(l.cooldownUntil) {
		l.cooldownUntil = until
		l.cooldownReason = strings.TrimSpace(reason)
	}
}

func (l *predictionBudgetLedger) snapshotLocked(blockedReason string) AIPredictionBudgetSnapshot {
	snapshot := AIPredictionBudgetSnapshot{
		RequestsThisMinute: l.requestsThisMinute,
		TokensThisMinute:   l.tokensThisMinute,
		TokensToday:        l.tokensToday,
		PendingRequests:    l.pending,
		MinIntervalLeftMs:  l.minIntervalLeftMs,
		BlockedReason:      strings.TrimSpace(blockedReason),
	}
	if !l.cooldownUntil.IsZero() {
		snapshot.CooldownUntil = l.cooldownUntil.UTC().Format(time.RFC3339)
		snapshot.CooldownReason = l.cooldownReason
	}
	return snapshot
}

func predictionProviderCooldown(err error) (string, time.Duration) {
	if err == nil {
		return "", 0
	}
	value := strings.ToLower(err.Error())
	switch {
	case strings.Contains(value, "429"), strings.Contains(value, "rate limit"), strings.Contains(value, "quota"):
		return "provider rate or quota limit", 5 * time.Minute
	case strings.Contains(value, "auth"), strings.Contains(value, "api key"), strings.Contains(value, "unauthorized"), strings.Contains(value, "forbidden"):
		return "provider authentication failed", 5 * time.Minute
	case strings.Contains(value, "context deadline exceeded"), strings.Contains(value, "timeout"):
		return "provider timeout", 30 * time.Second
	default:
		return "provider error", 30 * time.Second
	}
}

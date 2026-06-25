package lsp

import (
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	defaultLSPResourceMaxRSSBytes = int64(1536) * 1024 * 1024
	defaultLSPResourceCheck       = 10 * time.Second
	defaultLSPResourceGrace       = 5 * time.Second
)

type lspResourcePolicy struct {
	MaxRSSBytes   int64
	CheckInterval time.Duration
	RestartGrace  time.Duration
}

func currentLSPResourcePolicy() lspResourcePolicy {
	return lspResourcePolicyFromEnv(os.Getenv)
}

func lspResourcePolicyFromEnv(getenv func(string) string) lspResourcePolicy {
	policy := lspResourcePolicy{
		MaxRSSBytes:   defaultLSPResourceMaxRSSBytes,
		CheckInterval: defaultLSPResourceCheck,
		RestartGrace:  defaultLSPResourceGrace,
	}
	if getenv == nil {
		return policy
	}
	if value := strings.TrimSpace(getenv("ARLECCHINO_LSP_MAX_RSS_MB")); value != "" {
		if isDisabledValue(value) {
			policy.MaxRSSBytes = 0
		} else if parsed, err := strconv.ParseInt(value, 10, 64); err == nil && parsed >= 0 {
			policy.MaxRSSBytes = parsed * 1024 * 1024
		}
	}
	if value := strings.TrimSpace(getenv("ARLECCHINO_LSP_RESOURCE_CHECK_MS")); value != "" {
		if parsed, err := strconv.ParseInt(value, 10, 64); err == nil && parsed >= 0 {
			policy.CheckInterval = time.Duration(parsed) * time.Millisecond
		}
	}
	if value := strings.TrimSpace(getenv("ARLECCHINO_LSP_RESOURCE_GRACE_MS")); value != "" {
		if parsed, err := strconv.ParseInt(value, 10, 64); err == nil && parsed >= 0 {
			policy.RestartGrace = time.Duration(parsed) * time.Millisecond
		}
	}
	return policy
}

func isDisabledValue(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "0", "false", "off", "no", "disabled":
		return true
	default:
		return false
	}
}

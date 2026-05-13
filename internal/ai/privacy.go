package ai

import (
	"crypto/sha1"
	"encoding/hex"
	"regexp"
	"strings"
	"unicode/utf8"
)

const (
	defaultContextMaxBytes    = 24 * 1024
	defaultContextMaxSnippets = 8
)

var (
	privateKeyPattern = regexp.MustCompile(`-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----`)
	envLinePattern    = regexp.MustCompile(`(?im)^\s*([A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD|COOKIE)[A-Z0-9_]*)\s*=\s*.+$`)
	tokenPattern      = regexp.MustCompile(`(?i)(bearer\s+|api[_-]?key\s*[:=]\s*["']?|token\s*[:=]\s*["']?|secret\s*[:=]\s*["']?|password\s*[:=]\s*["']?)[A-Za-z0-9._\-+/=]{8,}["']?`)
	cookiePattern     = regexp.MustCompile(`(?i)(cookie\s*[:=]\s*)[^;\n]+`)
	absPathPattern    = regexp.MustCompile(`/(Users|home|var/folders|private|tmp)/[^\s'"]+`)
)

type privacyGate struct{}

func newPrivacyGate() privacyGate {
	return privacyGate{}
}

func (privacyGate) SanitizeSnapshot(snapshot AIContextSnapshot, maxBytes int, maxSnippets int) AIContextSnapshot {
	if maxBytes <= 0 {
		maxBytes = defaultContextMaxBytes
	}
	if maxSnippets <= 0 {
		maxSnippets = defaultContextMaxSnippets
	}
	summary := AIRedactionSummary{}
	snapshot.Prompt, summary = sanitizeText(snapshot.Prompt, summary)
	snapshot.FilePath, summary = sanitizePath(snapshot.FilePath, summary)
	snapshot.TerminalInput, summary = sanitizeText(snapshot.TerminalInput, summary)
	snapshot.TerminalWorkDir, summary = sanitizePath(snapshot.TerminalWorkDir, summary)
	if len(snapshot.Snippets) > maxSnippets {
		snapshot.Snippets = snapshot.Snippets[:maxSnippets]
		summary.Truncated = true
	}
	totalBytes := len(snapshot.Prompt) + len(snapshot.TerminalInput)
	for i := range snapshot.Snippets {
		snapshot.Snippets[i].Path, summary = sanitizePath(snapshot.Snippets[i].Path, summary)
		snapshot.Snippets[i].Content, summary = sanitizeText(snapshot.Snippets[i].Content, summary)
		totalBytes += len(snapshot.Snippets[i].Content)
	}
	for i := range snapshot.Mnemonic {
		snapshot.Mnemonic[i].Content, summary = sanitizeText(snapshot.Mnemonic[i].Content, summary)
		totalBytes += len(snapshot.Mnemonic[i].Content)
	}
	summary.OriginalBytes = totalBytes
	if totalBytes > maxBytes {
		remaining := maxBytes
		snapshot.Prompt = consumeTextBudget(snapshot.Prompt, &remaining, &summary)
		snapshot.TerminalInput = consumeTextBudget(snapshot.TerminalInput, &remaining, &summary)
		for i := range snapshot.Snippets {
			snapshot.Snippets[i].Content = consumeTextBudget(snapshot.Snippets[i].Content, &remaining, &summary)
		}
		for i := range snapshot.Mnemonic {
			snapshot.Mnemonic[i].Content = consumeTextBudget(snapshot.Mnemonic[i].Content, &remaining, &summary)
		}
	}
	snapshot.ByteSize = estimateSnapshotBytes(snapshot)
	summary.SanitizedBytes = snapshot.ByteSize
	snapshot.Redaction = summary
	return snapshot
}

func consumeTextBudget(value string, remaining *int, summary *AIRedactionSummary) string {
	if value == "" {
		return ""
	}
	if *remaining <= 0 {
		summary.Truncated = true
		return ""
	}
	if len(value) > *remaining {
		summary.Truncated = true
		truncated := truncateUTF8(value, *remaining)
		*remaining = 0
		return truncated
	}
	*remaining -= len(value)
	return value
}

func sanitizeText(value string, summary AIRedactionSummary) (string, AIRedactionSummary) {
	original := value
	value = privateKeyPattern.ReplaceAllString(value, "<redacted-private-key>")
	value = envLinePattern.ReplaceAllString(value, "$1=<redacted>")
	value = tokenPattern.ReplaceAllString(value, "${1}<redacted>")
	value = cookiePattern.ReplaceAllString(value, "${1}<redacted>")
	if value != original {
		summary.SecretsRedacted++
		summary.AppliedRules = appendRule(summary.AppliedRules, "secret-looking-content")
	}
	value, summary = sanitizePath(value, summary)
	return value, summary
}

func sanitizePath(value string, summary AIRedactionSummary) (string, AIRedactionSummary) {
	original := value
	value = absPathPattern.ReplaceAllStringFunc(value, func(path string) string {
		summary.PathsRedacted++
		return "<local-path:" + shortHash(path) + ">"
	})
	if value != original {
		summary.AppliedRules = appendRule(summary.AppliedRules, "absolute-path-redaction")
	}
	return value, summary
}

func appendRule(rules []string, rule string) []string {
	for _, existing := range rules {
		if existing == rule {
			return rules
		}
	}
	return append(rules, rule)
}

func estimateSnapshotBytes(snapshot AIContextSnapshot) int {
	total := len(snapshot.Prompt) + len(snapshot.FilePath) + len(snapshot.TerminalInput) + len(snapshot.TerminalWorkDir)
	for _, snippet := range snapshot.Snippets {
		total += len(snippet.Path) + len(snippet.Content)
	}
	for _, entry := range snapshot.Mnemonic {
		total += len(entry.Content)
	}
	return total
}

func truncateUTF8(value string, maxBytes int) string {
	if maxBytes <= 0 {
		return ""
	}
	if len(value) <= maxBytes {
		return value
	}
	value = value[:maxBytes]
	for !utf8.ValidString(value) && len(value) > 0 {
		value = value[:len(value)-1]
	}
	return strings.TrimRight(value, "\x00")
}

func shortHash(value string) string {
	sum := sha1.Sum([]byte(value))
	return hex.EncodeToString(sum[:])[:10]
}

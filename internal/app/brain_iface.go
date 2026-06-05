package app

import (
	"context"

	"arlecchino/internal/indexer/brain"
	"arlecchino/internal/indexer/lsp"
	"arlecchino/internal/predictive"
)

type completionBrain interface {
	ExtractPrefix(filePath string, content []byte, line, column int) predictive.PrefixInfo
	Complete(ctx brain.CompletionContext) []brain.Suggestion
	ResolveCompletionItem(ctx context.Context, req brain.CompletionResolveRequest) (brain.ResolvedCompletion, error)
	LastCompletionTrace() brain.CompletionTrace
	CompletionTraceForRequest(requestID string) (brain.CompletionTrace, bool)
	SelectGhostTextWithContext(ctx brain.CompletionContext, suggestions []brain.Suggestion, prefix, accessChain string) brain.GhostTextResult
	HasARLELanguageSupport(language string) bool
	RecordCompletionShown()
	RecordUsage(label, filePath string)
	RecordTyping(chars int)
	RecordGhostRejected()
	RecordFileAccess(filePath string)
	InvalidateCompletionCache(filePath string)
	SetLSPManager(manager *lsp.Manager)
	Close()
}

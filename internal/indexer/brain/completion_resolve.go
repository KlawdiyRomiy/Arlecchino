package brain

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"arlecchino/internal/indexer/core"
	"arlecchino/internal/indexer/lsp"
)

const (
	completionResolveTokenTTL = 5 * time.Second
	maxCompletionResolveItems = 512
)

var (
	ErrCompletionResolveTokenExpired = errors.New("completion resolve token expired")
	ErrCompletionResolveUnavailable  = errors.New("completion resolve unavailable")
)

type completionResolveEntry struct {
	language  string
	item      lsp.CompletionItem
	context   CompletionContext
	expiresAt time.Time
}

type ResolvedCompletion struct {
	InsertText          string
	IsSnippet           bool
	PrimaryTextEdit     *CompletionPrimaryTextEdit
	AdditionalTextEdits []core.TextEdit
	Command             *lsp.Command
	Data                any
}

func (b *PredictionBrain) rememberLSPCompletionResolve(ctx CompletionContext, item lsp.CompletionItem) string {
	if b == nil || len(item.AdditionalTextEdits) > 0 {
		return ""
	}
	token := newCompletionResolveToken()
	if token == "" {
		return ""
	}

	b.resolveMu.Lock()
	defer b.resolveMu.Unlock()
	if b.resolveEntries == nil {
		b.resolveEntries = make(map[string]completionResolveEntry)
	}
	now := time.Now()
	for key, entry := range b.resolveEntries {
		if now.After(entry.expiresAt) {
			delete(b.resolveEntries, key)
		}
	}
	if len(b.resolveEntries) >= maxCompletionResolveItems {
		for key := range b.resolveEntries {
			delete(b.resolveEntries, key)
			if len(b.resolveEntries) < maxCompletionResolveItems {
				break
			}
		}
	}
	b.resolveEntries[token] = completionResolveEntry{
		language:  strings.TrimSpace(ctx.Language),
		item:      item,
		context:   CompletionContext{Language: strings.TrimSpace(ctx.Language)},
		expiresAt: now.Add(completionResolveTokenTTL),
	}
	return token
}

func (b *PredictionBrain) ResolveCompletionItem(ctx context.Context, token string) (ResolvedCompletion, error) {
	var empty ResolvedCompletion
	token = strings.TrimSpace(token)
	if b == nil || token == "" {
		return empty, ErrCompletionResolveUnavailable
	}

	b.resolveMu.Lock()
	entry, ok := b.resolveEntries[token]
	if ok {
		delete(b.resolveEntries, token)
	}
	b.resolveMu.Unlock()
	if !ok || time.Now().After(entry.expiresAt) {
		return empty, ErrCompletionResolveTokenExpired
	}
	if b.lspManager == nil {
		return empty, ErrCompletionResolveUnavailable
	}
	if ctx == nil {
		ctx = context.Background()
	}

	item, err := b.lspManager.ResolveCompletionItemWithContext(ctx, entry.language, entry.item)
	if err != nil {
		return empty, err
	}

	return b.resolvedCompletionFromLSPItem(entry, item), nil
}

func (b *PredictionBrain) resolvedCompletionFromLSPItem(entry completionResolveEntry, item lsp.CompletionItem) ResolvedCompletion {
	insertText := item.InsertText
	if insertText == "" {
		insertText = item.Label
	}
	isSnippet := item.InsertTextFormat == 2 || hasSnippetPlaceholder(insertText)
	if !isSnippet {
		insertText = sanitizeInsertText(insertText)
		if insertText == "" {
			insertText = item.Label
		}
	}

	return ResolvedCompletion{
		InsertText:          insertText,
		IsSnippet:           isSnippet,
		PrimaryTextEdit:     lspPrimaryTextEditToCompletion(item.TextEdit),
		AdditionalTextEdits: lspTextEditsToCore(item.AdditionalTextEdits),
		Command:             item.Command,
		Data:                item.Data,
	}
}

func newCompletionResolveToken() string {
	var buf [16]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return ""
	}
	return hex.EncodeToString(buf[:])
}

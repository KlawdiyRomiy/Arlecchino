package brain

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"arlecchino/internal/indexer/core"
	"arlecchino/internal/indexer/lsp"
)

const (
	completionResolveTokenTTL = 60 * time.Second
	maxCompletionResolveItems = 512
)

var (
	ErrCompletionResolveTokenExpired = errors.New("completion resolve token expired")
	ErrCompletionResolveUnavailable  = errors.New("completion resolve unavailable")
)

type completionResolveEntry struct {
	language        string
	item            lsp.CompletionItem
	context         CompletionContext
	itemIdentity    string
	documentVersion int
	requestID       string
	sessionID       string
	surfaceID       string
	expiresAt       time.Time
}

type CompletionResolveRequest struct {
	ResolveToken    string
	DocumentVersion int
	RequestID       string
	SessionID       string
	SurfaceID       string
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
	if b == nil {
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
		language:        strings.TrimSpace(ctx.Language),
		item:            item,
		context:         CompletionContext{Language: strings.TrimSpace(ctx.Language), FilePath: strings.TrimSpace(ctx.FilePath), AccessChain: strings.TrimSpace(ctx.AccessChain), SessionID: strings.TrimSpace(ctx.SessionID), SurfaceID: strings.TrimSpace(ctx.SurfaceID)},
		itemIdentity:    lspCompletionItemIdentity(item),
		documentVersion: ctx.DocumentVersion,
		requestID:       strings.TrimSpace(ctx.RequestID),
		sessionID:       strings.TrimSpace(ctx.SessionID),
		surfaceID:       strings.TrimSpace(ctx.SurfaceID),
		expiresAt:       now.Add(completionResolveTokenTTL),
	}
	return token
}

func (b *PredictionBrain) ResolveCompletionItem(ctx context.Context, req CompletionResolveRequest) (ResolvedCompletion, error) {
	var empty ResolvedCompletion
	token := strings.TrimSpace(req.ResolveToken)
	if b == nil || token == "" {
		return empty, ErrCompletionResolveUnavailable
	}

	b.resolveMu.Lock()
	entry, ok := b.resolveEntries[token]
	if ok && time.Now().After(entry.expiresAt) {
		delete(b.resolveEntries, token)
		ok = false
	}
	b.resolveMu.Unlock()
	if !ok {
		return empty, ErrCompletionResolveTokenExpired
	}
	if b.lspManager == nil {
		return empty, ErrCompletionResolveUnavailable
	}
	if !completionResolveRequestMatches(entry, req) {
		return empty, ErrCompletionResolveTokenExpired
	}
	if ctx == nil {
		ctx = context.Background()
	}

	item, err := b.lspManager.ResolveCompletionItemWithContext(ctx, entry.language, entry.item)
	if err != nil {
		return empty, err
	}
	b.resolveMu.Lock()
	if current, ok := b.resolveEntries[token]; ok && current.itemIdentity == entry.itemIdentity {
		delete(b.resolveEntries, token)
	}
	b.resolveMu.Unlock()

	return b.resolvedCompletionFromLSPItem(entry, item), nil
}

func completionResolveRequestMatches(entry completionResolveEntry, req CompletionResolveRequest) bool {
	if entry.documentVersion > 0 && req.DocumentVersion < entry.documentVersion {
		return false
	}
	if entry.requestID != "" && strings.TrimSpace(req.RequestID) != entry.requestID {
		return false
	}
	if entry.sessionID != "" && strings.TrimSpace(req.SessionID) != entry.sessionID {
		return false
	}
	if entry.surfaceID != "" && strings.TrimSpace(req.SurfaceID) != entry.surfaceID {
		return false
	}
	return true
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

func lspCompletionItemIdentity(item lsp.CompletionItem) string {
	parts := []string{
		strings.TrimSpace(item.Label),
		strings.TrimSpace(item.Detail),
		fmt.Sprintf("%d", item.Kind),
		strings.TrimSpace(item.InsertText),
		strings.TrimSpace(item.TextEditText),
		strings.TrimSpace(item.FilterText),
		strings.TrimSpace(item.SortText),
		string(item.TextEdit),
		lspAdditionalTextEditsIdentity(item.AdditionalTextEdits),
		lspCommandIdentity(item.Command),
		lspAnyIdentity(item.Data),
	}
	return strings.Join(parts, "\x00")
}

func lspAdditionalTextEditsIdentity(edits []lsp.TextEdit) string {
	if len(edits) == 0 {
		return ""
	}
	parts := make([]string, 0, len(edits))
	for _, edit := range edits {
		parts = append(parts, fmt.Sprintf("%d:%d-%d:%d:%s", edit.Range.Start.Line, edit.Range.Start.Character, edit.Range.End.Line, edit.Range.End.Character, edit.NewText))
	}
	return strings.Join(parts, "\x00")
}

func lspCommandIdentity(command *lsp.Command) string {
	if command == nil {
		return ""
	}
	return strings.Join([]string{strings.TrimSpace(command.Title), strings.TrimSpace(command.Command), lspAnyIdentity(command.Arguments)}, "\x00")
}

func lspAnyIdentity(value any) string {
	if value == nil {
		return ""
	}
	data, err := json.Marshal(value)
	if err != nil {
		return fmt.Sprintf("%v", value)
	}
	return string(data)
}

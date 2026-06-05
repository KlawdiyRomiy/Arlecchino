package app

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
	"time"

	"arlecchino/internal/autocomplete"
	"arlecchino/internal/indexer"
	"arlecchino/internal/indexer/brain"
	"arlecchino/internal/indexer/core"
	indexerlsp "arlecchino/internal/indexer/lsp"
	"arlecchino/internal/predictive"

	"github.com/google/uuid"
)

// Completions & Predictions - Editor autocomplete and command suggestions

const (
	editorCompletionTimeout            = 325 * time.Millisecond
	editorAccessChainCompletionTimeout = 2400 * time.Millisecond
	editorCompletionResolveTimeout     = 150 * time.Millisecond
)

var editorAccessOperators = []string{"?->", "->", "::", "?.", "&.", ".", ":"}

func editorAccessOperatorFromChain(accessChain string) string {
	chain := strings.TrimSpace(accessChain)
	for _, operator := range editorAccessOperators {
		if strings.HasSuffix(chain, operator) {
			return operator
		}
	}
	return ""
}

func editorAccessChainIsStaticCall(accessChain string) bool {
	return editorAccessOperatorFromChain(accessChain) == "::"
}

func editorAccessChainIsMethodCall(accessChain string) bool {
	operator := editorAccessOperatorFromChain(accessChain)
	return operator != "" && operator != "::"
}

type editorCompletionRequest struct {
	requestID string
	cancel    context.CancelFunc
}

type editorCompletionResolveRef struct {
	completionID    string
	stableKey       string
	requestID       string
	documentVersion int
	sessionID       string
	surfaceID       string
	createdAt       time.Time
}

// CommandSuggestion represents a terminal command suggestion
type CommandSuggestion struct {
	Text        string `json:"text"`
	Description string `json:"description"`
	Kind        string `json:"kind"`
}

// ClassResult represents a class search result
type ClassResult struct {
	Name      string            `json:"name"`
	Kind      string            `json:"kind"`
	Namespace string            `json:"namespace"`
	FilePath  string            `json:"filePath"`
	Line      int               `json:"line"`
	Pending   bool              `json:"pending"`
	Extra     map[string]string `json:"extra,omitempty"`
}

// EditorCompletionContext represents completion request context
type EditorCompletionContext struct {
	FilePath              string   `json:"filePath"`
	Language              string   `json:"language"`
	Line                  int      `json:"line"`
	Column                int      `json:"column"`
	Version               int      `json:"version,omitempty"`
	LineText              string   `json:"lineText"`
	TextBefore            string   `json:"textBefore"`
	TextAfter             string   `json:"textAfter"`
	FullText              string   `json:"fullText"`
	CurrentClass          string   `json:"currentClass"`
	CurrentMethod         string   `json:"currentMethod"`
	Imports               []string `json:"imports"`
	TriggerChar           string   `json:"triggerChar"`
	AccessOperator        string   `json:"accessOperator,omitempty"`
	CompletionTriggerKind int      `json:"completionTriggerKind,omitempty"`
	SessionID             string   `json:"sessionId,omitempty"`
	SurfaceID             string   `json:"surfaceId,omitempty"`
	RequestID             string   `json:"requestId,omitempty"`
}

type TextEditJSON struct {
	StartLine   int    `json:"startLine"`
	StartColumn int    `json:"startColumn"`
	EndLine     int    `json:"endLine"`
	EndColumn   int    `json:"endColumn"`
	Text        string `json:"text"`
}

type CompletionRangeJSON struct {
	StartLine   int `json:"startLine"`
	StartColumn int `json:"startColumn"`
	EndLine     int `json:"endLine"`
	EndColumn   int `json:"endColumn"`
}

type PrimaryTextEditJSON struct {
	NewText string               `json:"newText"`
	Range   *CompletionRangeJSON `json:"range,omitempty"`
	Insert  *CompletionRangeJSON `json:"insert,omitempty"`
	Replace *CompletionRangeJSON `json:"replace,omitempty"`
}

type LSPCommandJSON struct {
	Title     string `json:"title,omitempty"`
	Command   string `json:"command"`
	Arguments []any  `json:"arguments,omitempty"`
}

type EditorCompletion struct {
	Label                     string               `json:"label"`
	Text                      string               `json:"text"`
	FilterText                string               `json:"filterText,omitempty"`
	Detail                    string               `json:"detail"`
	Documentation             string               `json:"documentation,omitempty"`
	TypeInfo                  string               `json:"typeInfo,omitempty"`
	Kind                      string               `json:"kind"`
	Source                    string               `json:"source"`
	InsertText                string               `json:"insertText"`
	SortText                  string               `json:"sortText,omitempty"`
	CommitCharacters          []string             `json:"commitCharacters,omitempty"`
	IsSnippet                 bool                 `json:"isSnippet"`
	Priority                  int                  `json:"priority"`
	HighlightPositions        []int                `json:"highlightPositions,omitempty"`
	MatchType                 string               `json:"matchType,omitempty"`
	PrimaryTextEdit           *PrimaryTextEditJSON `json:"primaryTextEdit,omitempty"`
	AdditionalTextEdits       []TextEditJSON       `json:"additionalTextEdits,omitempty"`
	Command                   *LSPCommandJSON      `json:"command,omitempty"`
	Data                      any                  `json:"data,omitempty"`
	ResolveToken              string               `json:"resolveToken,omitempty"`
	CompletionID              string               `json:"completionId,omitempty"`
	StableKey                 string               `json:"stableKey,omitempty"`
	Provenance                string               `json:"provenance,omitempty"`
	ProofKind                 string               `json:"proofKind,omitempty"`
	AccessMemberAuthoritative bool                 `json:"accessMemberAuthoritative"`
	AutoImportAllowed         bool                 `json:"autoImportAllowed"`
	Primary                   bool                 `json:"primary"`
	RequiresResolve           bool                 `json:"requiresResolveBeforeApply"`
}

// EditorCompletionResult represents completion response
type EditorCompletionResult struct {
	Primary                *EditorCompletion  `json:"primary"`
	Items                  []EditorCompletion `json:"items"`
	IsIncomplete           bool               `json:"isIncomplete,omitempty"`
	LSPTriggerCharacters   []string           `json:"lspTriggerCharacters,omitempty"`
	LSPResolveProvider     bool               `json:"lspResolveProvider,omitempty"`
	LSPCompletionAvailable bool               `json:"lspCompletionAvailable,omitempty"`
	LSPStatus              string             `json:"lspStatus,omitempty"`
	SourceStatuses         map[string]string  `json:"sourceStatuses,omitempty"`
	GhostText              string             `json:"ghostText,omitempty"`
	GhostConfidence        float64            `json:"ghostConfidence,omitempty"`
	ShowGhost              bool               `json:"showGhost"`
	RequestID              string             `json:"requestId,omitempty"`
	Stale                  bool               `json:"stale,omitempty"`
}

type EditorCompletionResolveResult struct {
	InsertText            string               `json:"insertText,omitempty"`
	IsSnippet             bool                 `json:"isSnippet,omitempty"`
	PrimaryTextEdit       *PrimaryTextEditJSON `json:"primaryTextEdit,omitempty"`
	AdditionalTextEdits   []TextEditJSON       `json:"additionalTextEdits,omitempty"`
	Command               *LSPCommandJSON      `json:"command,omitempty"`
	Data                  any                  `json:"data,omitempty"`
	ResolvedWorkspaceEdit *LSPWorkspaceEdit    `json:"resolvedWorkspaceEdit,omitempty"`
}

type EditorCompletionResolveRequest struct {
	ResolveToken    string `json:"resolveToken"`
	CompletionID    string `json:"completionId,omitempty"`
	StableKey       string `json:"stableKey,omitempty"`
	DocumentVersion int    `json:"documentVersion,omitempty"`
	SessionID       string `json:"sessionId,omitempty"`
	SurfaceID       string `json:"surfaceId,omitempty"`
}

func (a *App) SuggestCommand(input string) []CommandSuggestion {
	projectPath := a.GetCurrentProjectPath()
	pluginRegistry := a.activePluginRegistry()

	// Use plugin registry for command suggestions
	if pluginRegistry != nil && projectPath != "" {
		pluginSuggestions := pluginRegistry.SuggestCommand(projectPath, input)
		if len(pluginSuggestions) > 0 {
			var result []CommandSuggestion
			for _, s := range pluginSuggestions {
				result = append(result, CommandSuggestion{
					Text:        s.Text,
					Description: s.Description,
					Kind:        s.Kind,
				})
			}
			return result
		}
	}

	// Fallback to basic suggestion
	registry := indexer.NewCommandRegistry()
	parser := indexer.NewCommandParser(registry)
	suggestions := parser.Suggest(input)

	var result []CommandSuggestion
	for _, s := range suggestions {
		result = append(result, CommandSuggestion{
			Text:        s.Text,
			Description: s.Description,
			Kind:        s.Kind,
		})
	}
	return result
}

// UpdatePrediction updates the speculative store based on terminal input
func (a *App) UpdatePrediction(input string) {
	projectPath := a.GetCurrentProjectPath()
	pluginRegistry := a.activePluginRegistry()
	if pluginRegistry != nil && projectPath != "" {
		pluginRegistry.UpdatePrediction(projectPath, input)
	}
}

// CancelPrediction clears any pending predictions
func (a *App) CancelPrediction() {
	projectPath := a.GetCurrentProjectPath()
	pluginRegistry := a.activePluginRegistry()
	if pluginRegistry != nil && projectPath != "" {
		pluginRegistry.CancelPrediction(projectPath)
	}
}

// ConfirmPrediction is called when a command is executed
func (a *App) ConfirmPrediction(input string) {
	projectPath := a.GetCurrentProjectPath()
	pluginRegistry := a.activePluginRegistry()
	if pluginRegistry != nil && projectPath != "" {
		pluginRegistry.ConfirmPrediction(projectPath, input)
	}
}

func (a *App) beginEditorCompletionRequest(ctx EditorCompletionContext) (string, string, context.Context, context.CancelFunc) {
	requestID := uuid.New().String()
	scope := editorCompletionRequestScope(ctx)
	requestCtx, cancel := context.WithCancel(context.Background())

	a.completionRequestsMu.Lock()
	if a.completionRequests == nil {
		a.completionRequests = make(map[string]editorCompletionRequest)
	}
	if previous, ok := a.completionRequests[scope]; ok && previous.cancel != nil {
		previous.cancel()
	}
	a.completionRequests[scope] = editorCompletionRequest{
		requestID: requestID,
		cancel:    cancel,
	}
	a.completionRequestsMu.Unlock()

	return requestID, scope, requestCtx, cancel
}

func (a *App) finishEditorCompletionRequest(scope, requestID string) {
	a.completionRequestsMu.Lock()
	if current, ok := a.completionRequests[scope]; ok && current.requestID == requestID {
		delete(a.completionRequests, scope)
	}
	a.completionRequestsMu.Unlock()
}

func (a *App) isCurrentEditorCompletionRequest(scope, requestID string) bool {
	a.completionRequestsMu.Lock()
	defer a.completionRequestsMu.Unlock()
	current, ok := a.completionRequests[scope]
	return ok && current.requestID == requestID
}

func editorCompletionRequestScope(ctx EditorCompletionContext) string {
	session := strings.TrimSpace(ctx.SessionID)
	if session == "" {
		session = "default"
	}
	surface := strings.TrimSpace(ctx.SurfaceID)
	if surface == "" {
		surface = strings.TrimSpace(ctx.FilePath)
	}
	if surface == "" {
		surface = "editor"
	}
	return session + "\x00" + surface
}

func (a *App) GetEditorCompletions(ctx EditorCompletionContext) EditorCompletionResult {
	completionBrain := a.activeCompletionBrain()
	if completionBrain == nil {
		a.logWarning("[Autocomplete][Backend] brain is nil - not initialized")
		return EditorCompletionResult{}
	}

	requestID, requestScope, baseRequestCtx, baseCancel := a.beginEditorCompletionRequest(ctx)
	defer baseCancel()
	defer a.finishEditorCompletionRequest(requestScope, requestID)
	ctx.RequestID = requestID

	textBeforeShort := ctx.TextBefore
	if len(textBeforeShort) > 30 {
		textBeforeShort = textBeforeShort[len(textBeforeShort)-30:]
	}
	a.logDebugf("[Autocomplete][Backend] request file=%s lang=%s line=%d col=%d textBefore='%s'",
		ctx.FilePath, ctx.Language, ctx.Line, ctx.Column, textBeforeShort)

	prefixInfo := completionBrain.ExtractPrefix(ctx.FilePath, []byte(ctx.FullText), ctx.Line, ctx.Column)
	prefix := prefixInfo.Prefix
	if !prefixInfo.InImport && predictive.DetectImportContextFromText(ctx.TextBefore, ctx.Language) {
		prefixInfo.InImport = true
	}

	if prefix == "" && ctx.TextBefore != "" && prefixInfo.AccessChain == "" {
		prefix = predictive.ExtractCurrentPrefixWithLanguage(ctx.TextBefore, ctx.Language)
	}

	timeout := editorCompletionTimeout
	if prefixInfo.AccessChain != "" {
		timeout = editorAccessChainCompletionTimeout
	}

	requestCtx, cancel := context.WithTimeout(baseRequestCtx, timeout)
	defer cancel()

	if !prefixInfo.InString && ctx.TextBefore != "" {
		inString, stringValue, stringContext := predictive.DetectStringContextFromText(ctx.TextBefore)
		if inString && stringContext != "" {
			prefixInfo.InString = true
			prefixInfo.StringContextType = stringContext
			prefixInfo.StringValue = stringValue
			if prefix == "" {
				prefix = stringValue
			}
		}
	}

	isStaticCall := editorAccessChainIsStaticCall(prefixInfo.AccessChain)
	isMethodCall := editorAccessChainIsMethodCall(prefixInfo.AccessChain)

	a.logDebugf("[Autocomplete][Backend] prefix='%s' chain='%s' static=%v method=%v inString=%v",
		prefix, prefixInfo.AccessChain, isStaticCall, isMethodCall, prefixInfo.InString)

	contentWindow, contentStartLine := extractContextLines(ctx.FullText, ctx.Line, 50)
	importsHash := computeCompletionImportsHash(ctx.FullText, ctx.Language, ctx.Imports)

	brainCtx := brain.CompletionContext{
		FilePath:              ctx.FilePath,
		Content:               []byte(contentWindow),
		FullContent:           []byte(ctx.FullText),
		Line:                  ctx.Line,
		Column:                ctx.Column,
		DocumentVersion:       ctx.Version,
		Prefix:                prefix,
		Language:              ctx.Language,
		ImportsHash:           importsHash,
		TriggerChar:           ctx.TriggerChar,
		AccessOperator:        ctx.AccessOperator,
		CompletionTriggerKind: ctx.CompletionTriggerKind,
		Scope:                 ctx.CurrentMethod,
		ParentClass:           ctx.CurrentClass,
		InString:              prefixInfo.InString,
		InComment:             prefixInfo.InComment,
		InImport:              prefixInfo.InImport,
		StringValue:           prefixInfo.StringValue,
		StringContextType:     prefixInfo.StringContextType,
		AccessChain:           prefixInfo.AccessChain,
		IsMethodCall:          isMethodCall,
		IsStaticCall:          isStaticCall,
		ContentStartLine:      contentStartLine,
		RequestID:             requestID,
		SessionID:             ctx.SessionID,
		SurfaceID:             ctx.SurfaceID,
		Ctx:                   requestCtx,
	}

	suggestions := completionBrain.Complete(brainCtx)

	if !a.isCurrentEditorCompletionRequest(requestScope, requestID) {
		return EditorCompletionResult{
			RequestID: requestID,
			Stale:     true,
		}
	}

	a.logDebugf("[Autocomplete][Backend] suggestions=%d", len(suggestions))
	for i, s := range suggestions {
		if i >= 3 {
			break
		}
		a.logDebugf("[Autocomplete][Backend] top%d text='%s' score=%.2f source=%s kind=%s",
			i+1, s.Text, s.Score, s.Source, s.Kind)
	}

	var items []EditorCompletion
	trace, ok := completionBrain.CompletionTraceForRequest(requestID)
	if !ok {
		trace = completionBrain.LastCompletionTrace()
		if trace.RequestID != requestID {
			trace = brain.CompletionTrace{RequestID: requestID}
		}
	}
	isIncomplete := trace.LSPListIncomplete
	for i, s := range suggestions {
		if s.LSPListIncomplete {
			isIncomplete = true
		}
		stableKey := editorCompletionStableKey(s)
		proofKind := editorCompletionProofKind(s)
		autoImportAllowed := editorCompletionAutoImportAllowed(s, proofKind)
		item := EditorCompletion{
			Label:                     s.DisplayText,
			Text:                      s.Text,
			FilterText:                s.MatchText,
			Detail:                    s.Detail,
			Documentation:             s.Documentation,
			TypeInfo:                  s.TypeInfo,
			Kind:                      string(s.Kind),
			Source:                    string(s.Source),
			InsertText:                s.InsertText,
			SortText:                  s.SortText,
			CommitCharacters:          append([]string(nil), s.CommitCharacters...),
			IsSnippet:                 s.IsSnippet,
			Priority:                  int(s.Score * 100),
			ResolveToken:              s.ResolveToken,
			CompletionID:              editorCompletionID(requestID, i, stableKey),
			StableKey:                 stableKey,
			Provenance:                string(s.Source),
			ProofKind:                 proofKind,
			AccessMemberAuthoritative: editorCompletionAccessMemberAuthoritative(s, proofKind),
			AutoImportAllowed:         autoImportAllowed,
			RequiresResolve:           s.ResolveToken != "",
			PrimaryTextEdit:           editorPrimaryTextEditJSON(s.PrimaryTextEdit),
			Command:                   editorLSPCommandJSON(s.Command),
			Data:                      s.Data,
		}
		if s.MatchResult != nil {
			item.HighlightPositions = s.MatchResult.Positions
			item.MatchType = s.MatchResult.Type.String()
		}
		if len(s.AdditionalTextEdits) > 0 {
			for _, edit := range s.AdditionalTextEdits {
				item.AdditionalTextEdits = append(item.AdditionalTextEdits, TextEditJSON{
					StartLine:   edit.StartLine,
					StartColumn: edit.StartColumn,
					EndLine:     edit.EndLine,
					EndColumn:   edit.EndColumn,
					Text:        edit.Text,
				})
			}
		}
		if item.ResolveToken != "" {
			a.rememberEditorCompletionResolveRef(item.ResolveToken, editorCompletionResolveRef{
				completionID:    item.CompletionID,
				stableKey:       item.StableKey,
				requestID:       requestID,
				documentVersion: ctx.Version,
				sessionID:       strings.TrimSpace(ctx.SessionID),
				surfaceID:       strings.TrimSpace(ctx.SurfaceID),
				createdAt:       time.Now(),
			})
		}
		items = append(items, item)
	}

	var primary *EditorCompletion
	if len(items) > 0 {
		items[0].Primary = true
		primary = &items[0]
	}

	ghostResult := completionBrain.SelectGhostTextWithContext(brainCtx, suggestions, prefix, prefixInfo.AccessChain)
	if ghostResult.ShouldShow {
		completionBrain.RecordCompletionShown()
	}

	a.logDebugf("[Autocomplete][Backend] ghost show=%v text='%s' confidence=%.2f",
		ghostResult.ShouldShow, ghostResult.Text, ghostResult.Confidence)

	lspCapabilities := indexerlsp.CompletionCapabilities{}
	if lspManager := a.activeLSPManager(); lspManager != nil {
		lspLanguage := autocomplete.Resolve(ctx.Language, ctx.FilePath).LSPID
		if lspLanguage == "" {
			lspLanguage = ctx.Language
		}
		lspCapabilities = lspManager.CompletionCapabilities(lspLanguage)
	}

	return EditorCompletionResult{
		Primary:                primary,
		Items:                  items,
		IsIncomplete:           isIncomplete,
		LSPTriggerCharacters:   lspCapabilities.TriggerCharacters,
		LSPResolveProvider:     lspCapabilities.ResolveProvider,
		LSPCompletionAvailable: lspCapabilities.Available,
		LSPStatus:              trace.LSPStatus,
		SourceStatuses:         trace.SourceStatuses,
		GhostText:              ghostResult.Text,
		GhostConfidence:        ghostResult.Confidence,
		ShowGhost:              ghostResult.ShouldShow,
		RequestID:              requestID,
	}
}

func (a *App) ResolveEditorCompletion(req EditorCompletionResolveRequest) (EditorCompletionResolveResult, error) {
	completionBrain := a.activeCompletionBrain()
	if completionBrain == nil {
		return EditorCompletionResolveResult{}, fmt.Errorf("completion brain is not initialized")
	}
	resolveToken := strings.TrimSpace(req.ResolveToken)
	if resolveToken == "" {
		return EditorCompletionResolveResult{}, fmt.Errorf("completion resolve token is required")
	}
	ref, ok := a.lookupEditorCompletionResolveRef(resolveToken, req)
	if !ok {
		return EditorCompletionResolveResult{}, fmt.Errorf("completion resolve token expired")
	}
	ctx, cancel := context.WithTimeout(context.Background(), editorCompletionResolveTimeout)
	defer cancel()

	resolved, err := completionBrain.ResolveCompletionItem(ctx, brain.CompletionResolveRequest{
		ResolveToken:    resolveToken,
		DocumentVersion: req.DocumentVersion,
		RequestID:       ref.requestID,
		SessionID:       req.SessionID,
		SurfaceID:       req.SurfaceID,
	})
	if err != nil {
		return EditorCompletionResolveResult{}, err
	}
	a.forgetEditorCompletionResolveRef(resolveToken)

	result := EditorCompletionResolveResult{
		InsertText:      resolved.InsertText,
		IsSnippet:       resolved.IsSnippet,
		PrimaryTextEdit: editorPrimaryTextEditJSON(resolved.PrimaryTextEdit),
		Command:         editorLSPCommandJSON(resolved.Command),
		Data:            resolved.Data,
	}
	for _, edit := range resolved.AdditionalTextEdits {
		result.AdditionalTextEdits = append(result.AdditionalTextEdits, TextEditJSON{
			StartLine:   edit.StartLine,
			StartColumn: edit.StartColumn,
			EndLine:     edit.EndLine,
			EndColumn:   edit.EndColumn,
			Text:        edit.Text,
		})
	}
	return result, nil
}

func (a *App) rememberEditorCompletionResolveRef(token string, ref editorCompletionResolveRef) {
	token = strings.TrimSpace(token)
	if token == "" {
		return
	}
	a.completionResolveRefsMu.Lock()
	defer a.completionResolveRefsMu.Unlock()
	if a.completionResolveRefs == nil {
		a.completionResolveRefs = make(map[string]editorCompletionResolveRef)
	}
	now := time.Now()
	for key, existing := range a.completionResolveRefs {
		if now.Sub(existing.createdAt) > 30*time.Second {
			delete(a.completionResolveRefs, key)
		}
	}
	a.completionResolveRefs[token] = ref
}

func (a *App) lookupEditorCompletionResolveRef(token string, req EditorCompletionResolveRequest) (editorCompletionResolveRef, bool) {
	token = strings.TrimSpace(token)
	a.completionResolveRefsMu.Lock()
	defer a.completionResolveRefsMu.Unlock()
	ref, ok := a.completionResolveRefs[token]
	if !ok {
		return editorCompletionResolveRef{}, false
	}
	if !editorCompletionResolveRefMatches(ref, req) {
		return editorCompletionResolveRef{}, false
	}
	return ref, true
}

func (a *App) forgetEditorCompletionResolveRef(token string) {
	token = strings.TrimSpace(token)
	if token == "" {
		return
	}
	a.completionResolveRefsMu.Lock()
	defer a.completionResolveRefsMu.Unlock()
	delete(a.completionResolveRefs, token)
}

func editorCompletionResolveRefMatches(ref editorCompletionResolveRef, req EditorCompletionResolveRequest) bool {
	if ref.completionID != "" && req.CompletionID != ref.completionID {
		return false
	}
	if ref.stableKey != "" && req.StableKey != ref.stableKey {
		return false
	}
	if ref.documentVersion > 0 && req.DocumentVersion != ref.documentVersion {
		return false
	}
	if ref.sessionID != "" && req.SessionID != ref.sessionID {
		return false
	}
	if ref.surfaceID != "" && req.SurfaceID != ref.surfaceID {
		return false
	}
	return true
}

func editorCompletionStableKey(s brain.Suggestion) string {
	parts := []string{
		string(s.Source),
		string(s.Kind),
		strings.TrimSpace(s.Text),
		strings.TrimSpace(s.DisplayText),
		strings.TrimSpace(s.Namespace),
		strings.TrimSpace(s.InsertText),
		strings.TrimSpace(s.SortText),
		strings.TrimSpace(s.FilePath),
		fmt.Sprintf("%d", s.Line),
		editorPrimaryTextEditIdentity(s.PrimaryTextEdit),
		editorAdditionalTextEditsIdentity(s.AdditionalTextEdits),
		strings.TrimSpace(s.ResolveToken),
		strings.TrimSpace(s.ProofKind),
	}
	if s.Import != nil {
		parts = append(parts,
			strings.TrimSpace(s.Import.Path),
			strings.TrimSpace(s.Import.Statement),
			strings.TrimSpace(s.Import.Symbol),
			strings.TrimSpace(s.Import.Mode),
		)
	}
	return strings.Join(parts, "\x00")
}

func editorAdditionalTextEditsIdentity(edits []core.TextEdit) string {
	if len(edits) == 0 {
		return ""
	}
	parts := make([]string, 0, len(edits))
	for _, edit := range edits {
		parts = append(parts, fmt.Sprintf("%d:%d:%d:%d:%s", edit.StartLine, edit.StartColumn, edit.EndLine, edit.EndColumn, edit.Text))
	}
	return strings.Join(parts, "\x00")
}

func editorPrimaryTextEditIdentity(edit *brain.CompletionPrimaryTextEdit) string {
	if edit == nil {
		return ""
	}
	parts := []string{
		edit.NewText,
		editorCompletionRangeIdentity(edit.Range),
		editorCompletionRangeIdentity(edit.Insert),
		editorCompletionRangeIdentity(edit.Replace),
	}
	return strings.Join(parts, "\x00")
}

func editorCompletionRangeIdentity(r *brain.CompletionTextRange) string {
	if r == nil {
		return ""
	}
	return fmt.Sprintf("%d:%d:%d:%d", r.StartLine, r.StartColumn, r.EndLine, r.EndColumn)
}

func editorPrimaryTextEditJSON(edit *brain.CompletionPrimaryTextEdit) *PrimaryTextEditJSON {
	if edit == nil {
		return nil
	}
	return &PrimaryTextEditJSON{
		NewText: edit.NewText,
		Range:   editorCompletionRangeJSON(edit.Range),
		Insert:  editorCompletionRangeJSON(edit.Insert),
		Replace: editorCompletionRangeJSON(edit.Replace),
	}
}

func editorCompletionRangeJSON(r *brain.CompletionTextRange) *CompletionRangeJSON {
	if r == nil {
		return nil
	}
	return &CompletionRangeJSON{
		StartLine:   r.StartLine,
		StartColumn: r.StartColumn,
		EndLine:     r.EndLine,
		EndColumn:   r.EndColumn,
	}
}

func editorLSPCommandJSON(command *indexerlsp.Command) *LSPCommandJSON {
	if command == nil {
		return nil
	}
	return &LSPCommandJSON{
		Title:     command.Title,
		Command:   command.Command,
		Arguments: command.Arguments,
	}
}

func editorCompletionID(requestID string, index int, stableKey string) string {
	hasher := sha1.New()
	hasher.Write([]byte(requestID))
	hasher.Write([]byte{0})
	hasher.Write([]byte(fmt.Sprintf("%d", index)))
	hasher.Write([]byte{0})
	hasher.Write([]byte(stableKey))
	return hex.EncodeToString(hasher.Sum(nil))
}

func editorCompletionProofKind(s brain.Suggestion) string {
	if strings.TrimSpace(s.ProofKind) != "" {
		return s.ProofKind
	}
	switch s.Source {
	case "lsp":
		if len(s.AdditionalTextEdits) > 0 {
			return "lsp-completion-edit"
		}
		if s.ResolveToken != "" {
			return "lsp-resolve-edit"
		}
		return "project-symbol"
	case "index", "ast", "local":
		return "project-symbol"
	case "library":
		return "dependency-declared"
	default:
		return "none"
	}
}

func editorCompletionAccessMemberAuthoritative(s brain.Suggestion, proofKind string) bool {
	if s.Source == core.SourceLSP {
		return true
	}
	switch strings.TrimSpace(proofKind) {
	case "receiver-member", "self-static-member":
		return strings.TrimSpace(s.Namespace) != ""
	default:
		return false
	}
}

func editorCompletionAutoImportAllowed(s brain.Suggestion, proofKind string) bool {
	switch proofKind {
	case "existing-import", "project-symbol", "stdlib-platform", "lsp-completion-edit", "lsp-resolve-edit", "lsp-code-action":
		return s.AutoImportAllowed || len(s.AdditionalTextEdits) > 0
	default:
		return false
	}
}

func extractContextLines(fullContent string, cursorLine, radius int) (string, int) {
	if fullContent == "" {
		return "", 1
	}

	lines := strings.Split(fullContent, "\n")
	if cursorLine <= 0 || cursorLine > len(lines) {
		return fullContent, 1
	}

	startLine := cursorLine - radius
	if startLine < 1 {
		startLine = 1
	}
	endLine := cursorLine + radius
	if endLine > len(lines) {
		endLine = len(lines)
	}

	window := strings.Join(lines[startLine-1:endLine], "\n")
	return window, startLine
}

func computeImportsHash(imports []string) string {
	if len(imports) == 0 {
		return ""
	}

	normalized := make([]string, 0, len(imports))
	for _, imp := range imports {
		candidate := strings.TrimSpace(strings.ToLower(imp))
		if candidate != "" {
			normalized = append(normalized, candidate)
		}
	}

	if len(normalized) == 0 {
		return ""
	}

	sort.Strings(normalized)
	hasher := sha1.New()
	for _, imp := range normalized {
		hasher.Write([]byte(imp))
		hasher.Write([]byte{0})
	}

	return hex.EncodeToString(hasher.Sum(nil))
}

func computeCompletionImportsHash(fullText, language string, frontendImports []string) string {
	parts := make([]string, 0, 2)
	if hash := computeImportsHash(frontendImports); hash != "" {
		parts = append(parts, hash)
	}
	if hash := computeImportSectionHash(fullText, language); hash != "" {
		parts = append(parts, hash)
	}
	if len(parts) == 0 {
		return ""
	}
	return strings.Join(parts, ":")
}

func computeImportSectionHash(fullText, language string) string {
	if strings.TrimSpace(fullText) == "" {
		return ""
	}

	lines := strings.Split(fullText, "\n")
	importLines := make([]string, 0, 16)
	inGoImportBlock := false

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		lower := strings.ToLower(trimmed)
		if trimmed == "" {
			continue
		}
		if inGoImportBlock {
			importLines = append(importLines, trimmed)
			if trimmed == ")" {
				inGoImportBlock = false
			}
			continue
		}
		if language == "go" && strings.HasPrefix(trimmed, "import (") {
			inGoImportBlock = true
			importLines = append(importLines, trimmed)
			continue
		}
		if isImportSectionLine(lower, trimmed, language) {
			importLines = append(importLines, trimmed)
		}
	}

	if len(importLines) == 0 {
		return ""
	}

	hasher := sha1.New()
	for _, line := range importLines {
		hasher.Write([]byte(line))
		hasher.Write([]byte{0})
	}
	return hex.EncodeToString(hasher.Sum(nil))
}

func isImportSectionLine(lower, trimmed, language string) bool {
	switch strings.ToLower(strings.TrimSpace(language)) {
	case "go":
		return strings.HasPrefix(trimmed, "import ")
	case "php", "php-laravel", "rust":
		return strings.HasPrefix(trimmed, "use ")
	case "python":
		return strings.HasPrefix(trimmed, "import ") || strings.HasPrefix(trimmed, "from ")
	case "javascript", "typescript", "javascriptreact", "typescriptreact", "vue", "svelte", "astro", "scala", "dart", "solidity", "julia", "haskell", "matlab":
		return strings.HasPrefix(trimmed, "import ") || strings.HasPrefix(trimmed, "using ")
	case "clojure":
		return strings.HasPrefix(trimmed, "(:import ") || strings.HasPrefix(trimmed, "(:require ")
	case "erlang":
		return strings.HasPrefix(trimmed, "-import(")
	case "fortran":
		return strings.HasPrefix(lower, "use ")
	case "ada":
		return strings.HasPrefix(lower, "with ")
	case "delphi", "pascal":
		return strings.HasPrefix(lower, "uses ")
	case "latex":
		return strings.HasPrefix(trimmed, "\\usepackage")
	case "perl":
		return strings.HasPrefix(trimmed, "use ")
	default:
		return false
	}
}

func (a *App) GetInlineSuggestion(filePath, content string, line, column int, prefix string) string {
	completionBrain := a.activeCompletionBrain()
	if completionBrain == nil {
		return ""
	}

	language := detectLanguageFromPath(filePath)

	prefixInfo := completionBrain.ExtractPrefix(filePath, []byte(content), line, column)
	if prefixInfo.PositionContext == "function_argument" {
		return ""
	}

	brainCtx := brain.CompletionContext{
		FilePath: filePath,
		Content:  []byte(content),
		Line:     line,
		Column:   column,
		Prefix:   prefix,
		Language: language,
	}

	suggestions := completionBrain.Complete(brainCtx)
	if len(suggestions) == 0 {
		return ""
	}

	var bestSuggestion *brain.Suggestion
	var bestScore float64 = -1
	const minConfidenceThreshold = 2.0

	for i := range suggestions {
		s := &suggestions[i]
		text := getCleanInsertText(s)
		if text == "" {
			continue
		}

		score := calculateGhostTextScore(s, text, prefix)

		if score > bestScore {
			bestScore = score
			bestSuggestion = s
		}
	}

	if bestSuggestion == nil || bestScore < minConfidenceThreshold {
		return ""
	}

	text := getCleanInsertText(bestSuggestion)

	lowerText := strings.ToLower(text)
	lowerPrefix := strings.ToLower(prefix)
	if strings.HasPrefix(lowerText, lowerPrefix) {
		return text[len(prefix):]
	}

	return text
}

func detectLanguageFromPath(filePath string) string {
	resolution := autocomplete.Resolve("", filePath)
	if resolution.CanonicalID == "" {
		return "unknown"
	}
	return resolution.CanonicalID
}

func getCleanInsertText(s *brain.Suggestion) string {
	text := s.InsertText
	if text == "" {
		text = s.Text
	}

	if s.IsSnippet {
		text = stripSnippetPlaceholders(text)
	}

	return text
}

func stripSnippetPlaceholders(text string) string {
	result := text

	for i := 0; i < 10; i++ {
		placeholder := "$" + string(rune('0'+i))
		result = strings.ReplaceAll(result, placeholder, "")
	}

	start := 0
	for {
		dollarBrace := strings.Index(result[start:], "${")
		if dollarBrace == -1 {
			break
		}
		dollarBrace += start

		closeBrace := strings.Index(result[dollarBrace:], "}")
		if closeBrace == -1 {
			break
		}
		closeBrace += dollarBrace

		inner := result[dollarBrace+2 : closeBrace]
		colonPos := strings.Index(inner, ":")
		replacement := ""
		if colonPos != -1 {
			replacement = inner[colonPos+1:]
		}

		result = result[:dollarBrace] + replacement + result[closeBrace+1:]
		start = dollarBrace + len(replacement)
	}

	return result
}

func calculateGhostTextScore(s *brain.Suggestion, text, prefix string) float64 {
	score := s.Score

	lowerText := strings.ToLower(text)
	lowerPrefix := strings.ToLower(prefix)
	if strings.HasPrefix(lowerText, lowerPrefix) {
		score += 5.0
		if text == prefix {
			score -= 10.0
		}
	} else {
		score -= 3.0
	}

	switch s.Source {
	case "lsp":
		score += 2.0
	case "local":
		score += 1.5
	case "fill_all":
		score += 3.0
	case "index":
		score += 1.0
	case "predictive":
		score += 0.5
	case "virtual":
		score -= 0.5
	}

	textLen := len(text)
	switch {
	case textLen > 100:
		score -= 3.0
	case textLen > 50:
		score -= 1.5
	case textLen < 3:
		score -= 2.0
	case textLen >= 5 && textLen <= 30:
		score += 1.0
	}

	switch s.Kind {
	case "method", "function":
		score += 1.5
	case "property", "variable":
		score += 1.0
	case "class", "interface":
		score += 0.5
	case "snippet":
		score -= 1.0
	}

	return score
}

func (a *App) RecordCompletionUsage(label string) {
	if completionBrain := a.activeCompletionBrain(); completionBrain != nil {
		completionBrain.RecordUsage(label, "")
	}
}

func (a *App) RecordTypingActivity(chars int) {
	if completionBrain := a.activeCompletionBrain(); completionBrain != nil {
		completionBrain.RecordTyping(chars)
	}
}

func (a *App) RecordGhostRejected() {
	if completionBrain := a.activeCompletionBrain(); completionBrain != nil {
		completionBrain.RecordGhostRejected()
	}
}

func (a *App) RecordGhostShown() {
	if completionBrain := a.activeCompletionBrain(); completionBrain != nil {
		completionBrain.RecordCompletionShown()
	}
}

func (a *App) RecordFileAccess(filePath string) {
	if completionBrain := a.activeCompletionBrain(); completionBrain != nil {
		completionBrain.RecordFileAccess(filePath)
	}
}

// NotifyFileOpened notifies LSP servers when a file is opened in the editor
func (a *App) NotifyFileOpened(filePath, language, content string) {
	lspManager := a.activeLSPManager()
	if lspManager != nil {
		if err := lspManager.DidOpen(language, filePath, content); err != nil {
			message := fmt.Sprintf("LSP didOpen failed for %s: %v", filePath, err)
			a.logWarning(message)
			a.emitLSPDiagnosticsStatus(language, filePath, "error", message)
		}
		return
	}
	a.emitLSPDiagnosticsStatus(language, filePath, "unavailable", "LSP diagnostics manager is not available")
}

// NotifyFileChanged notifies LSP servers when a file content changes
func (a *App) NotifyFileChanged(filePath, language string, version int, content string) {
	lspManager := a.activeLSPManager()
	if lspManager != nil {
		if err := lspManager.DidChange(language, filePath, version, content); err != nil {
			message := fmt.Sprintf("LSP didChange failed for %s: %v", filePath, err)
			a.logWarning(message)
			a.emitLSPDiagnosticsStatus(language, filePath, "error", message)
		}
	} else {
		a.emitLSPDiagnosticsStatus(language, filePath, "unavailable", "LSP diagnostics manager is not available")
	}
	if engine := a.activeCoreEngine(); engine != nil {
		engine.OnFileChanged(filePath, []byte(content))
	}
	if completionBrain := a.activeCompletionBrain(); completionBrain != nil {
		completionBrain.InvalidateCompletionCache(filePath)
	}
}

// NotifyFileClosed notifies LSP servers when a file is closed
func (a *App) NotifyFileClosed(filePath, language string) {
	lspManager := a.activeLSPManager()
	if lspManager != nil {
		if err := lspManager.DidClose(language, filePath); err != nil {
			message := fmt.Sprintf("LSP didClose failed for %s: %v", filePath, err)
			a.logWarning(message)
			a.emitLSPDiagnosticsStatus(language, filePath, "error", message)
		}
		return
	}
	a.emitLSPDiagnosticsStatus(language, filePath, "unavailable", "LSP diagnostics manager is not available")
}

func (a *App) ParseCommand(input string) map[string]interface{} {
	projectPath := a.GetCurrentProjectPath()
	pluginRegistry := a.activePluginRegistry()

	// Use plugin registry for command parsing
	if pluginRegistry != nil && projectPath != "" {
		parsed := pluginRegistry.ParseCommand(projectPath, input)
		if parsed != nil && parsed.Valid {
			return map[string]interface{}{
				"prefix":   parsed.Prefix,
				"command":  parsed.Command,
				"argument": parsed.Argument,
				"flags":    parsed.Flags,
				"valid":    parsed.Valid,
			}
		}
	}

	// Fallback to basic parser
	registry := indexer.NewCommandRegistry()
	parser := indexer.NewCommandParser(registry)
	parsed := parser.Parse(input)

	return map[string]interface{}{
		"raw":      parsed.Raw,
		"prefix":   parsed.Prefix,
		"command":  parsed.Command,
		"argument": parsed.Argument,
		"flags":    parsed.Flags,
		"valid":    parsed.Valid,
	}
}

func (a *App) PredictCommand(input string) *ClassResult {
	projectPath := a.GetCurrentProjectPath()
	pluginRegistry := a.activePluginRegistry()
	if pluginRegistry == nil || projectPath == "" {
		return nil
	}

	// Update prediction in plugins
	pluginRegistry.UpdatePrediction(projectPath, input)

	// Parse command to get the argument name
	parsed := pluginRegistry.ParseCommand(projectPath, input)
	if parsed == nil || !parsed.Valid || parsed.Argument == "" {
		return nil
	}

	// Get pending entry from plugins
	entry := pluginRegistry.GetPendingEntry(projectPath, parsed.Argument)
	if entry == nil {
		return nil
	}

	return &ClassResult{
		Name:      entry.Name,
		Kind:      entry.Kind,
		Namespace: entry.Namespace,
		FilePath:  entry.FilePath,
		Pending:   true,
	}
}

func (a *App) SearchClasses(prefix string) []ClassResult {
	projectPath := a.GetCurrentProjectPath()
	pluginRegistry := a.activePluginRegistry()
	if pluginRegistry == nil || projectPath == "" {
		return nil
	}

	pluginResults := pluginRegistry.SearchClasses(projectPath, prefix)
	var out []ClassResult
	for _, r := range pluginResults {
		out = append(out, ClassResult{
			Name:      r.Name,
			Kind:      r.Kind,
			Namespace: r.Namespace,
			FilePath:  r.FilePath,
			Line:      r.Line,
			Pending:   r.Pending,
		})
	}
	return out
}

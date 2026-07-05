package lsp

import (
	"encoding/json"

	"go.lsp.dev/protocol"
)

func ToProtocolCompletionItem(item CompletionItem) protocol.CompletionItem {
	return protocol.CompletionItem{
		Label:               item.Label,
		Kind:                protocol.CompletionItemKind(item.Kind),
		Detail:              toProtocolOptionalString(item.Detail),
		Documentation:       toProtocolTooltip(item.Documentation),
		InsertText:          toProtocolOptionalString(item.InsertText),
		InsertTextFormat:    protocol.InsertTextFormat(item.InsertTextFormat),
		AdditionalTextEdits: toProtocolTextEdits(item.AdditionalTextEdits),
		Data:                toProtocolLSPAny(item.Data),
	}
}

func ToProtocolDiagnostic(diagnostic Diagnostic) protocol.Diagnostic {
	return protocol.Diagnostic{
		Range:    toProtocolRange(diagnostic.Range),
		Severity: protocol.DiagnosticSeverity(diagnostic.Severity),
		Code:     toProtocolProgressToken(diagnostic.Code),
		Source:   toProtocolOptionalString(diagnostic.Source),
		Message:  protocol.String(diagnostic.Message),
	}
}

func toProtocolOptionalString(value string) protocol.Optional[string] {
	if value == "" {
		return protocol.Optional[string]{}
	}
	return protocol.NewOptional(value)
}

func toProtocolTooltip(value any) protocol.InlayHintTooltip {
	switch v := value.(type) {
	case nil:
		return nil
	case string:
		if v == "" {
			return nil
		}
		return protocol.String(v)
	case protocol.InlayHintTooltip:
		return v
	case json.RawMessage:
		return rawTooltip(v)
	default:
		raw, err := json.Marshal(v)
		if err != nil {
			return nil
		}
		return rawTooltip(raw)
	}
}

func rawTooltip(raw json.RawMessage) protocol.InlayHintTooltip {
	var text string
	if err := json.Unmarshal(raw, &text); err == nil {
		if text == "" {
			return nil
		}
		return protocol.String(text)
	}
	var markup struct {
		Kind  string `json:"kind"`
		Value string `json:"value"`
	}
	if err := json.Unmarshal(raw, &markup); err == nil && markup.Value != "" {
		kind := protocol.MarkupKind(markup.Kind)
		if kind == "" {
			kind = protocol.MarkupKindPlainText
		}
		return &protocol.MarkupContent{Kind: kind, Value: markup.Value}
	}
	return nil
}

func toProtocolProgressToken(value any) protocol.ProgressToken {
	switch v := value.(type) {
	case nil:
		return nil
	case string:
		if v == "" {
			return nil
		}
		return protocol.String(v)
	case int:
		return protocol.Integer(v)
	case int32:
		return protocol.Integer(v)
	case int64:
		return protocol.Integer(v)
	case float64:
		if v == float64(int32(v)) {
			return protocol.Integer(v)
		}
		return nil
	case protocol.ProgressToken:
		return v
	default:
		return nil
	}
}

func toProtocolLSPAny(value any) protocol.LSPAny {
	switch v := value.(type) {
	case nil:
		return nil
	case json.RawMessage:
		if json.Valid(v) {
			return protocol.LSPAny(append([]byte(nil), v...))
		}
		return nil
	case []byte:
		if json.Valid(v) {
			return protocol.LSPAny(append([]byte(nil), v...))
		}
		return nil
	default:
		raw, err := json.Marshal(v)
		if err != nil || !json.Valid(raw) {
			return nil
		}
		return protocol.LSPAny(raw)
	}
}

func ProtocolTextEditPayload(edit json.RawMessage) json.RawMessage {
	return edit
}

func toProtocolTextEdits(edits []TextEdit) []protocol.TextEdit {
	if len(edits) == 0 {
		return nil
	}
	result := make([]protocol.TextEdit, 0, len(edits))
	for _, edit := range edits {
		result = append(result, protocol.TextEdit{
			Range:   toProtocolRange(edit.Range),
			NewText: edit.NewText,
		})
	}
	return result
}

func toProtocolRange(r Range) protocol.Range {
	return protocol.Range{
		Start: protocol.Position{Line: uint32(r.Start.Line), Character: uint32(r.Start.Character)},
		End:   protocol.Position{Line: uint32(r.End.Line), Character: uint32(r.End.Character)},
	}
}

package lsp

import (
	"encoding/json"

	"go.lsp.dev/protocol"
)

func ToProtocolCompletionItem(item CompletionItem) protocol.CompletionItem {
	return protocol.CompletionItem{
		Label:               item.Label,
		Kind:                protocol.CompletionItemKind(item.Kind),
		Detail:              item.Detail,
		Documentation:       item.Documentation,
		InsertText:          item.InsertText,
		InsertTextFormat:    protocol.InsertTextFormat(item.InsertTextFormat),
		AdditionalTextEdits: toProtocolTextEdits(item.AdditionalTextEdits),
		Data:                item.Data,
	}
}

func ToProtocolDiagnostic(diagnostic Diagnostic) protocol.Diagnostic {
	return protocol.Diagnostic{
		Range:    toProtocolRange(diagnostic.Range),
		Severity: protocol.DiagnosticSeverity(diagnostic.Severity),
		Code:     diagnostic.Code,
		Source:   diagnostic.Source,
		Message:  diagnostic.Message,
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

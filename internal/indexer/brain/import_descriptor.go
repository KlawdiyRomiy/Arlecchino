package brain

import "strings"

type ImportDescriptor struct {
	Path      string `json:"path,omitempty"`
	Statement string `json:"statement,omitempty"`
	Symbol    string `json:"symbol,omitempty"`
	Mode      string `json:"mode,omitempty"`
}

func (d *ImportDescriptor) Empty() bool {
	if d == nil {
		return true
	}
	return strings.TrimSpace(d.Path) == "" &&
		strings.TrimSpace(d.Statement) == "" &&
		strings.TrimSpace(d.Symbol) == "" &&
		strings.TrimSpace(d.Mode) == ""
}

func cloneImportDescriptor(d *ImportDescriptor) *ImportDescriptor {
	if d == nil {
		return nil
	}
	clone := *d
	return &clone
}

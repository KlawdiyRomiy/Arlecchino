package codeintel

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"sync"
	"time"

	roaring "github.com/RoaringBitmap/roaring/v2"
	"github.com/scip-code/scip/bindings/go/scip"
)

const backendNameSCIP = "scip"

type BackendStatus struct {
	Name         string `json:"name"`
	Ready        bool   `json:"ready"`
	Indexed      bool   `json:"indexed"`
	ExternalTool string `json:"externalTool,omitempty"`
	CachePath    string `json:"cachePath,omitempty"`
	Message      string `json:"message,omitempty"`
}

type SymbolOccurrence struct {
	Symbol     string `json:"symbol"`
	Path       string `json:"path"`
	Line       int    `json:"line"`
	Character  int    `json:"character"`
	EndLine    int    `json:"endLine"`
	EndChar    int    `json:"endChar"`
	Definition bool   `json:"definition"`
	Read       bool   `json:"read"`
	Write      bool   `json:"write"`
}

type ImportSummary struct {
	Documents   int `json:"documents"`
	Occurrences int `json:"occurrences"`
	Symbols     int `json:"symbols"`
}

type CodeIntelBackend interface {
	Status() BackendStatus
	ImportSCIPIndex(context.Context, *scip.Index) (ImportSummary, error)
	Definitions(symbol string) ([]SymbolOccurrence, error)
	References(symbol string) ([]SymbolOccurrence, error)
}

type SCIPBackend struct {
	mu              sync.RWMutex
	cacheDir        string
	externalTool    string
	records         []SymbolOccurrence
	bySymbol        map[string]*roaring.Bitmap
	definitions     map[string]*roaring.Bitmap
	references      map[string]*roaring.Bitmap
	indexed         bool
	lastImportError string
}

func NewSCIPBackend(projectRoot string) *SCIPBackend {
	cacheDir := filepath.Join(projectRoot, ".arlecchino", "codeintel")
	tool, _ := DiscoverSCIPGo()
	return &SCIPBackend{
		cacheDir:     cacheDir,
		externalTool: tool,
		bySymbol:     map[string]*roaring.Bitmap{},
		definitions:  map[string]*roaring.Bitmap{},
		references:   map[string]*roaring.Bitmap{},
	}
}

func DiscoverSCIPGo() (string, bool) {
	path, err := exec.LookPath("scip-go")
	return path, err == nil
}

func (b *SCIPBackend) Status() BackendStatus {
	b.mu.RLock()
	defer b.mu.RUnlock()

	status := BackendStatus{
		Name:         backendNameSCIP,
		Ready:        true,
		Indexed:      b.indexed,
		ExternalTool: b.externalTool,
		CachePath:    b.cacheDir,
		Message:      "SCIP import backend; external scip-go discovery is optional",
	}
	if b.lastImportError != "" {
		status.Message = b.lastImportError
	}
	return status
}

func (b *SCIPBackend) ImportSCIPIndex(ctx context.Context, index *scip.Index) (ImportSummary, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if index == nil {
		return ImportSummary{}, errors.New("SCIP index is nil")
	}

	records := make([]SymbolOccurrence, 0)
	bySymbol := map[string]*roaring.Bitmap{}
	definitions := map[string]*roaring.Bitmap{}
	references := map[string]*roaring.Bitmap{}
	symbols := map[string]struct{}{}
	summary := ImportSummary{Documents: len(index.GetDocuments())}

	for _, document := range index.GetDocuments() {
		if err := ctx.Err(); err != nil {
			return summary, err
		}
		relPath := filepath.ToSlash(document.GetRelativePath())
		for _, occurrence := range document.GetOccurrences() {
			symbol := occurrence.GetSymbol()
			if symbol == "" {
				continue
			}
			record, ok := occurrenceRecord(relPath, occurrence)
			if !ok {
				continue
			}
			record.Symbol = symbol
			index := uint32(len(records))
			records = append(records, record)
			addBitmap(bySymbol, symbol, index)
			if record.Definition {
				addBitmap(definitions, symbol, index)
			} else {
				addBitmap(references, symbol, index)
			}
			symbols[symbol] = struct{}{}
		}
	}
	summary.Occurrences = len(records)
	summary.Symbols = len(symbols)

	if err := os.MkdirAll(b.cacheDir, 0o755); err != nil {
		return summary, err
	}
	if err := writeManifest(ctx, filepath.Join(b.cacheDir, "manifest.json"), summary); err != nil {
		return summary, err
	}

	b.mu.Lock()
	b.records = records
	b.bySymbol = bySymbol
	b.definitions = definitions
	b.references = references
	b.indexed = true
	b.lastImportError = ""
	b.mu.Unlock()

	return summary, nil
}

func (b *SCIPBackend) Definitions(symbol string) ([]SymbolOccurrence, error) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return collectOccurrences(b.records, b.definitions[symbol]), nil
}

func (b *SCIPBackend) References(symbol string) ([]SymbolOccurrence, error) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return collectOccurrences(b.records, b.references[symbol]), nil
}

func occurrenceRecord(path string, occurrence *scip.Occurrence) (SymbolOccurrence, bool) {
	rng := occurrence.GetRange()
	if len(rng) != 3 && len(rng) != 4 {
		return SymbolOccurrence{}, false
	}
	line := int(rng[0])
	character := int(rng[1])
	endLine := line
	endChar := int(rng[2])
	if len(rng) == 4 {
		endLine = int(rng[2])
		endChar = int(rng[3])
	}
	roles := occurrence.GetSymbolRoles()
	return SymbolOccurrence{
		Path:       path,
		Line:       line,
		Character:  character,
		EndLine:    endLine,
		EndChar:    endChar,
		Definition: hasRole(roles, scip.SymbolRole_Definition),
		Read:       hasRole(roles, scip.SymbolRole_ReadAccess),
		Write:      hasRole(roles, scip.SymbolRole_WriteAccess),
	}, true
}

func hasRole(roles int32, role scip.SymbolRole) bool {
	return roles&int32(role) != 0
}

func addBitmap(index map[string]*roaring.Bitmap, symbol string, id uint32) {
	bitmap := index[symbol]
	if bitmap == nil {
		bitmap = roaring.New()
		index[symbol] = bitmap
	}
	bitmap.Add(id)
}

func collectOccurrences(records []SymbolOccurrence, bitmap *roaring.Bitmap) []SymbolOccurrence {
	if bitmap == nil || bitmap.IsEmpty() {
		return nil
	}
	result := make([]SymbolOccurrence, 0, int(bitmap.GetCardinality()))
	bitmap.Iterate(func(id uint32) bool {
		if int(id) < len(records) {
			result = append(result, records[id])
		}
		return true
	})
	sortRecords(result)
	return result
}

func sortRecords(records []SymbolOccurrence) {
	sort.Slice(records, func(i, j int) bool {
		if records[i].Path != records[j].Path {
			return records[i].Path < records[j].Path
		}
		if records[i].Line != records[j].Line {
			return records[i].Line < records[j].Line
		}
		return records[i].Character < records[j].Character
	})
}

func writeManifest(ctx context.Context, path string, summary ImportSummary) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	payload := struct {
		Backend    string        `json:"backend"`
		ImportedAt time.Time     `json:"importedAt"`
		Summary    ImportSummary `json:"summary"`
	}{
		Backend:    backendNameSCIP,
		ImportedAt: time.Now().UTC(),
		Summary:    summary,
	}
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

package predictive

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoader_LoadDir(t *testing.T) {
	// Create temp directory with test patterns
	tmpDir, err := os.MkdirTemp("", "predictive-test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create patterns subdirectory
	patternsDir := filepath.Join(tmpDir, "patterns")
	if err := os.MkdirAll(patternsDir, 0755); err != nil {
		t.Fatalf("Failed to create patterns dir: %v", err)
	}

	// Create a test pattern file
	patternJSON := `{
		"name": "Test Patterns",
		"version": "1.0.0",
		"description": "Test patterns for unit testing",
		"language": "php",
		"patterns": [
			{
				"id": "test-pattern",
				"description": "A test pattern for unit testing",
				"template": "// ${className} code here\nfunction test() {\n    \n}",
				"priority": 50,
				"context": {
					"languages": ["php", "javascript"],
					"fileTypes": ["service"],
					"positions": ["class_body", "method_body"]
				},
				"trigger": {
					"type": "keyword",
					"value": "testfn"
				}
			}
		]
	}`

	patternFile := filepath.Join(patternsDir, "test-pattern.json")
	if err := os.WriteFile(patternFile, []byte(patternJSON), 0644); err != nil {
		t.Fatalf("Failed to write pattern file: %v", err)
	}

	// Load patterns
	loader := NewLoader()
	patterns, err := loader.LoadDir(patternsDir)
	if err != nil {
		t.Fatalf("LoadDir error: %v", err)
	}

	if len(patterns) != 1 {
		t.Errorf("Expected 1 pattern, got %d", len(patterns))
	}

	if len(patterns) > 0 {
		p := patterns[0]
		if p.ID != "test-pattern" {
			t.Errorf("ID = %q, want %q", p.ID, "test-pattern")
		}
		if p.Description != "A test pattern for unit testing" {
			t.Errorf("Description = %q, want %q", p.Description, "A test pattern for unit testing")
		}
		if p.Priority != 50 {
			t.Errorf("Priority = %d, want %d", p.Priority, 50)
		}
		if len(p.Context.Languages) != 2 {
			t.Errorf("Languages count = %d, want 2", len(p.Context.Languages))
		}
	}
}

func TestLoader_LoadFile(t *testing.T) {
	// Create temp file with pattern
	tmpFile, err := os.CreateTemp("", "pattern-*.json")
	if err != nil {
		t.Fatalf("Failed to create temp file: %v", err)
	}
	defer os.Remove(tmpFile.Name())

	patternJSON := `{
		"name": "Single Pattern",
		"version": "1.0.0",
		"patterns": [
			{
				"id": "single-pattern",
				"description": "A single pattern",
				"template": "// code",
				"priority": 30,
				"context": {},
				"trigger": {"type": "empty"}
			}
		]
	}`

	if _, err := tmpFile.WriteString(patternJSON); err != nil {
		t.Fatalf("Failed to write: %v", err)
	}
	tmpFile.Close()

	loader := NewLoader()
	patterns, err := loader.LoadFile(tmpFile.Name())
	if err != nil {
		t.Fatalf("LoadFile error: %v", err)
	}

	if len(patterns) != 1 {
		t.Errorf("Expected 1 pattern, got %d", len(patterns))
	}
}

func TestLoader_InvalidJSON(t *testing.T) {
	// Create temp file with invalid JSON
	tmpFile, err := os.CreateTemp("", "invalid-pattern-*.json")
	if err != nil {
		t.Fatalf("Failed to create temp file: %v", err)
	}
	defer os.Remove(tmpFile.Name())

	if _, err := tmpFile.WriteString("{ invalid json }"); err != nil {
		t.Fatalf("Failed to write: %v", err)
	}
	tmpFile.Close()

	loader := NewLoader()
	_, err = loader.LoadFile(tmpFile.Name())

	if err == nil {
		t.Error("Expected error for invalid JSON, got nil")
	}
}

func TestLoader_NonExistentDir(t *testing.T) {
	loader := NewLoader()
	_, err := loader.LoadDir("/nonexistent/path/to/patterns")

	// Should return error for nonexistent dir
	if err == nil {
		t.Error("Expected error for nonexistent dir, got nil")
	}
}

func TestLoader_EmptyDir(t *testing.T) {
	// Create temp empty directory
	tmpDir, err := os.MkdirTemp("", "empty-patterns")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	loader := NewLoader()
	patterns, err := loader.LoadDir(tmpDir)

	if err != nil {
		t.Errorf("Expected no error for empty dir, got: %v", err)
	}

	if len(patterns) != 0 {
		t.Errorf("Expected 0 patterns, got %d", len(patterns))
	}
}

func TestLoader_FileTypeNormalization(t *testing.T) {
	// Create temp file with various file types
	tmpFile, err := os.CreateTemp("", "filetype-*.json")
	if err != nil {
		t.Fatalf("Failed to create temp file: %v", err)
	}
	defer os.Remove(tmpFile.Name())

	patternJSON := `{
		"name": "FileType Test",
		"version": "1.0.0",
		"patterns": [
			{
				"id": "filetype-test",
				"description": "Test file types",
				"template": "// code",
				"priority": 10,
				"context": {
					"fileTypes": ["controller", "MODEL", "Service"]
				},
				"trigger": {"type": "empty"}
			}
		]
	}`

	if _, err := tmpFile.WriteString(patternJSON); err != nil {
		t.Fatalf("Failed to write: %v", err)
	}
	tmpFile.Close()

	loader := NewLoader()
	patterns, err := loader.LoadFile(tmpFile.Name())
	if err != nil {
		t.Fatalf("LoadFile error: %v", err)
	}

	if len(patterns) != 1 {
		t.Fatalf("Expected 1 pattern, got %d", len(patterns))
	}

	// Check that file types are normalized
	fileTypes := patterns[0].Context.FileTypes
	if len(fileTypes) != 3 {
		t.Errorf("FileTypes count = %d, want 3", len(fileTypes))
	}
}

func TestLoader_TriggerTypeParsing(t *testing.T) {
	// Create temp file with different trigger types
	tmpFile, err := os.CreateTemp("", "trigger-*.json")
	if err != nil {
		t.Fatalf("Failed to create temp file: %v", err)
	}
	defer os.Remove(tmpFile.Name())

	patternJSON := `{
		"name": "Trigger Test",
		"version": "1.0.0",
		"patterns": [
			{
				"id": "empty-trigger",
				"description": "Empty trigger",
				"template": "// code",
				"priority": 10,
				"context": {},
				"trigger": {"type": "empty"}
			},
			{
				"id": "text-trigger",
				"description": "Text trigger",
				"template": "// code",
				"priority": 10,
				"context": {},
				"trigger": {"type": "text", "value": "func"}
			}
		]
	}`

	if _, err := tmpFile.WriteString(patternJSON); err != nil {
		t.Fatalf("Failed to write: %v", err)
	}
	tmpFile.Close()

	loader := NewLoader()
	patterns, err := loader.LoadFile(tmpFile.Name())
	if err != nil {
		t.Fatalf("LoadFile error: %v", err)
	}

	if len(patterns) != 2 {
		t.Errorf("Expected 2 patterns, got %d", len(patterns))
	}

	// Check trigger types
	if patterns[0].Trigger.Type != TriggerTypeEmpty {
		t.Errorf("First pattern trigger type = %v, want %v", patterns[0].Trigger.Type, TriggerTypeEmpty)
	}
	if patterns[1].Trigger.Type != TriggerTypeText {
		t.Errorf("Second pattern trigger type = %v, want %v", patterns[1].Trigger.Type, TriggerTypeText)
	}
}

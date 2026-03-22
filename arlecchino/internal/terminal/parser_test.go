package terminal

import (
	"testing"
)

func TestParseSimpleCommand(t *testing.T) {
	tests := []struct {
		name       string
		input      string
		wantBinary string
		wantArgs   []string
	}{
		{
			name:       "git status",
			input:      "git status",
			wantBinary: "git",
			wantArgs:   []string{"status"},
		},
		{
			name:       "ls -la",
			input:      "ls -la",
			wantBinary: "ls",
			wantArgs:   []string{},
		},
		{
			name:       "echo hello world",
			input:      "echo hello world",
			wantBinary: "echo",
			wantArgs:   []string{"hello", "world"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := ParseShellInput(tt.input)
			if err != nil {
				t.Fatalf("ParseShellInput() error = %v", err)
			}

			if result.Binary != tt.wantBinary {
				t.Errorf("Binary = %v, want %v", result.Binary, tt.wantBinary)
			}

			if len(result.Args) != len(tt.wantArgs) {
				t.Errorf("Args length = %v, want %v", len(result.Args), len(tt.wantArgs))
			}

			for i, arg := range result.Args {
				if i >= len(tt.wantArgs) {
					break
				}
				if arg != tt.wantArgs[i] {
					t.Errorf("Args[%d] = %v, want %v", i, arg, tt.wantArgs[i])
				}
			}
		})
	}
}

func TestParseCommandWithFlags(t *testing.T) {
	tests := []struct {
		name       string
		input      string
		wantBinary string
		wantFlags  map[string]string
	}{
		{
			name:       "go build with flags",
			input:      "go build --race -v",
			wantBinary: "go",
			wantFlags:  map[string]string{"race": "", "v": ""},
		},
		{
			name:       "docker run with key-value",
			input:      "docker run --name=myapp --port=8080",
			wantBinary: "docker",
			wantFlags:  map[string]string{"name": "myapp", "port": "8080"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := ParseShellInput(tt.input)
			if err != nil {
				t.Fatalf("ParseShellInput() error = %v", err)
			}

			if result.Binary != tt.wantBinary {
				t.Errorf("Binary = %v, want %v", result.Binary, tt.wantBinary)
			}

			for key, wantVal := range tt.wantFlags {
				gotVal, exists := result.Flags[key]
				if !exists {
					t.Errorf("Flag %q not found", key)
					continue
				}
				if gotVal != wantVal {
					t.Errorf("Flags[%q] = %v, want %v", key, gotVal, wantVal)
				}
			}
		})
	}
}

func TestParsePipe(t *testing.T) {
	input := "cat file.txt | grep pattern"
	result, err := ParseShellInput(input)
	if err != nil {
		t.Fatalf("ParseShellInput() error = %v", err)
	}

	if !result.IsPipe {
		t.Error("Expected IsPipe = true")
	}

	if result.Binary != "cat" {
		t.Errorf("Binary = %v, want cat", result.Binary)
	}
}

func TestParseRedirect(t *testing.T) {
	input := "echo hello > output.txt"
	result, err := ParseShellInput(input)
	if err != nil {
		t.Fatalf("ParseShellInput() error = %v", err)
	}

	if !result.IsRedirect {
		t.Error("Expected IsRedirect = true")
	}

	if result.Binary != "echo" {
		t.Errorf("Binary = %v, want echo", result.Binary)
	}
}

func TestParseIncomplete(t *testing.T) {
	tests := []struct {
		name  string
		input string
	}{
		{
			name:  "empty input",
			input: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := ParseShellInput(tt.input)
			if err != nil {
				t.Fatalf("ParseShellInput() error = %v", err)
			}

			if !result.IsIncomplete {
				t.Error("Expected IsIncomplete = true")
			}
		})
	}
}

func TestParseArtisanCommand(t *testing.T) {
	input := "php artisan make:model User -m"
	result, err := ParseShellInput(input)
	if err != nil {
		t.Fatalf("ParseShellInput() error = %v", err)
	}

	if result.Binary != "php" {
		t.Errorf("Binary = %v, want php", result.Binary)
	}

	if len(result.Args) < 2 {
		t.Fatalf("Not enough args, got %v", result.Args)
	}

	if result.Args[0] != "artisan" {
		t.Errorf("Args[0] = %v, want artisan", result.Args[0])
	}

	if result.Args[1] != "make:model" {
		t.Errorf("Args[1] = %v, want make:model", result.Args[1])
	}
}

func TestParseNpmCommand(t *testing.T) {
	input := "npm run dev --watch"
	result, err := ParseShellInput(input)
	if err != nil {
		t.Fatalf("ParseShellInput() error = %v", err)
	}

	if result.Binary != "npm" {
		t.Errorf("Binary = %v, want npm", result.Binary)
	}

	if len(result.Args) < 2 {
		t.Fatalf("Not enough args, got %v", result.Args)
	}

	if result.Args[0] != "run" {
		t.Errorf("Args[0] = %v, want run", result.Args[0])
	}

	if result.Args[1] != "dev" {
		t.Errorf("Args[1] = %v, want dev", result.Args[1])
	}

	if _, exists := result.Flags["watch"]; !exists {
		t.Error("Expected --watch flag")
	}
}

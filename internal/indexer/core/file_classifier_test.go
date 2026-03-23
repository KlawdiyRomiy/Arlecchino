package core

import "testing"

func TestClassifyFileKind(t *testing.T) {
	tests := []struct {
		name     string
		path     string
		language string
		want     FileKind
	}{
		{name: "supported source", path: "/tmp/main.go", language: "go", want: FileKindSource},
		{name: "config file", path: "/tmp/config/app.yaml", want: FileKindConfig},
		{name: "text file", path: "/tmp/README.md", want: FileKindText},
		{name: "asset file", path: "/tmp/assets/logo.png", want: FileKindAsset},
		{name: "binary file", path: "/tmp/bin/app.wasm", want: FileKindBinary},
		{name: "unknown file", path: "/tmp/data/custom.foo", want: FileKindUnknown},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := classifyFileKind(tt.path, tt.language)
			if got != tt.want {
				t.Fatalf("classifyFileKind(%q, %q) = %q, want %q", tt.path, tt.language, got, tt.want)
			}
		})
	}
}

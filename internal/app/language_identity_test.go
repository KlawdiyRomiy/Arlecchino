package app

import "testing"

func TestDetectLanguageUsesAutocompleteResolver(t *testing.T) {
	tests := []struct {
		filePath string
		want     string
	}{
		{filePath: "/tmp/resources/views/welcome.blade.php", want: "blade"},
		{filePath: "/tmp/src/App.tsx", want: "typescriptreact"},
		{filePath: "/tmp/src/App.jsx", want: "javascriptreact"},
		{filePath: "/tmp/scripts/deploy.zsh", want: "bash"},
		{filePath: "/tmp/Dockerfile", want: "dockerfile"},
		{filePath: "/tmp/Makefile", want: "makefile"},
		{filePath: "/tmp/file.unknown", want: ""},
	}

	for _, tt := range tests {
		if got := detectLanguage(tt.filePath); got != tt.want {
			t.Fatalf("detectLanguage(%q)=%q want %q", tt.filePath, got, tt.want)
		}
	}
}

func TestDetectLanguageFromFileReturnsCanonicalIDs(t *testing.T) {
	app := &App{}
	tests := []struct {
		filePath string
		want     string
	}{
		{filePath: "/tmp/resources/views/welcome.blade.php", want: "blade"},
		{filePath: "/tmp/src/App.tsx", want: "typescriptreact"},
		{filePath: "/tmp/src/App.jsx", want: "javascriptreact"},
		{filePath: "/tmp/.env.local", want: "env"},
		{filePath: "/tmp/scripts/deploy.sh", want: "bash"},
		{filePath: "/tmp/file.unknown", want: "unknown"},
	}

	for _, tt := range tests {
		if got := app.DetectLanguageFromFile(tt.filePath, ""); got != tt.want {
			t.Fatalf("DetectLanguageFromFile(%q)=%q want %q", tt.filePath, got, tt.want)
		}
	}
}

func TestGetLanguageForFileUsesCanonicalResolver(t *testing.T) {
	app := &App{}
	tests := []struct {
		filePath string
		wantID   string
		wantLSP  string
	}{
		{filePath: "/tmp/resources/views/welcome.blade.php", wantID: "blade", wantLSP: "vscode-html-language-server"},
		{filePath: "/tmp/src/App.tsx", wantID: "typescriptreact", wantLSP: "typescript-language-server"},
		{filePath: "/tmp/src/App.jsx", wantID: "javascriptreact", wantLSP: "typescript-language-server"},
		{filePath: "/tmp/scripts/deploy.bash", wantID: "bash", wantLSP: "bash-language-server"},
	}

	for _, tt := range tests {
		got := app.GetLanguageForFile(tt.filePath)
		if got == nil {
			t.Fatalf("GetLanguageForFile(%q)=nil", tt.filePath)
		}
		if got.ID != tt.wantID || got.LSPServerID != tt.wantLSP {
			t.Fatalf("GetLanguageForFile(%q)=%+v want id=%q lsp=%q", tt.filePath, got, tt.wantID, tt.wantLSP)
		}
	}

	if got := app.GetLanguageForFile("/tmp/file.unknown"); got != nil {
		t.Fatalf("GetLanguageForFile(unknown)=%+v want nil", got)
	}
}

func TestResolveLanguageInfoForFileUsesCanonicalLSPServer(t *testing.T) {
	tests := []struct {
		filePath string
		wantID   string
		wantLSP  string
	}{
		{filePath: "/tmp/resources/views/welcome.blade.php", wantID: "blade", wantLSP: "vscode-html-language-server"},
		{filePath: "/tmp/src/App.tsx", wantID: "typescriptreact", wantLSP: "typescript-language-server"},
		{filePath: "/tmp/src/App.jsx", wantID: "javascriptreact", wantLSP: "typescript-language-server"},
	}

	for _, tt := range tests {
		info, resolution := resolveLanguageInfoForFile(tt.filePath)
		if info == nil {
			t.Fatalf("resolveLanguageInfoForFile(%q)=nil", tt.filePath)
		}
		if info.ID != tt.wantID || info.LSPServerID != tt.wantLSP || resolution.LSPID != tt.wantID {
			t.Fatalf("resolveLanguageInfoForFile(%q) info=%+v resolution=%+v", tt.filePath, info, resolution)
		}
	}
}

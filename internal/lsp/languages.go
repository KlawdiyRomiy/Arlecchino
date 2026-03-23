package lsp

import (
	"path/filepath"
	"strings"
)

type LanguageInfo struct {
	ID            string
	Name          string
	Extensions    []string
	LSPServerID   string
	CodeMirrorID  string
	TreeSitterID  string
	ARLESupported bool
}

var Languages = map[string]*LanguageInfo{
	// TIER 1: 14 languages (>15% developers)
	"javascript":      {ID: "javascript", Name: "JavaScript", Extensions: []string{".js", ".mjs", ".cjs"}, LSPServerID: "typescript-language-server", CodeMirrorID: "javascript", TreeSitterID: "javascript", ARLESupported: true},
	"typescript":      {ID: "typescript", Name: "TypeScript", Extensions: []string{".ts", ".mts", ".cts"}, LSPServerID: "typescript-language-server", CodeMirrorID: "typescript", TreeSitterID: "typescript", ARLESupported: true},
	"typescriptreact": {ID: "typescriptreact", Name: "TypeScript React", Extensions: []string{".tsx"}, LSPServerID: "typescript-language-server", CodeMirrorID: "tsx", TreeSitterID: "tsx", ARLESupported: true},
	"javascriptreact": {ID: "javascriptreact", Name: "JavaScript React", Extensions: []string{".jsx"}, LSPServerID: "typescript-language-server", CodeMirrorID: "jsx", TreeSitterID: "javascript", ARLESupported: true},
	"html":            {ID: "html", Name: "HTML", Extensions: []string{".html", ".htm", ".xhtml"}, LSPServerID: "vscode-html-language-server", CodeMirrorID: "html", TreeSitterID: "html", ARLESupported: true},
	"blade":           {ID: "blade", Name: "Blade", Extensions: []string{".blade.php"}, LSPServerID: "vscode-html-language-server", CodeMirrorID: "blade", TreeSitterID: "html", ARLESupported: true},
	"css":             {ID: "css", Name: "CSS", Extensions: []string{".css"}, LSPServerID: "vscode-css-language-server", CodeMirrorID: "css", TreeSitterID: "css", ARLESupported: true},
	"sql":             {ID: "sql", Name: "SQL", Extensions: []string{".sql"}, LSPServerID: "sql-language-server", CodeMirrorID: "sql", TreeSitterID: "sql", ARLESupported: true},
	"python":          {ID: "python", Name: "Python", Extensions: []string{".py", ".pyi", ".pyw", ".pyx"}, LSPServerID: "pyright", CodeMirrorID: "python", TreeSitterID: "python", ARLESupported: true},
	"bash":            {ID: "bash", Name: "Bash/Shell", Extensions: []string{".sh", ".bash", ".zsh", ".fish"}, LSPServerID: "bash-language-server", CodeMirrorID: "shell", TreeSitterID: "bash", ARLESupported: true},
	"java":            {ID: "java", Name: "Java", Extensions: []string{".java"}, LSPServerID: "jdtls", CodeMirrorID: "java", TreeSitterID: "java", ARLESupported: true},
	"csharp":          {ID: "csharp", Name: "C#", Extensions: []string{".cs", ".csx"}, LSPServerID: "omnisharp", CodeMirrorID: "csharp", TreeSitterID: "c_sharp", ARLESupported: true},
	"cpp":             {ID: "cpp", Name: "C++", Extensions: []string{".cpp", ".hpp", ".cc", ".cxx", ".hxx", ".hh"}, LSPServerID: "clangd", CodeMirrorID: "cpp", TreeSitterID: "cpp", ARLESupported: true},
	"powershell":      {ID: "powershell", Name: "PowerShell", Extensions: []string{".ps1", ".psm1", ".psd1"}, LSPServerID: "powershell-editor-services", CodeMirrorID: "powershell", TreeSitterID: "powershell", ARLESupported: true},
	"c":               {ID: "c", Name: "C", Extensions: []string{".c", ".h"}, LSPServerID: "clangd", CodeMirrorID: "c", TreeSitterID: "c", ARLESupported: true},
	"php":             {ID: "php", Name: "PHP", Extensions: []string{".php", ".phtml", ".php3", ".php4", ".php5", ".phps"}, LSPServerID: "phpactor", CodeMirrorID: "php", TreeSitterID: "php", ARLESupported: true},
	"go":              {ID: "go", Name: "Go", Extensions: []string{".go", ".mod", ".sum", ".work"}, LSPServerID: "gopls", CodeMirrorID: "go", TreeSitterID: "go", ARLESupported: true},
	"rust":            {ID: "rust", Name: "Rust", Extensions: []string{".rs"}, LSPServerID: "rust-analyzer", CodeMirrorID: "rust", TreeSitterID: "rust", ARLESupported: true},

	// TIER 2: 13 languages (5-15% developers)
	"kotlin":   {ID: "kotlin", Name: "Kotlin", Extensions: []string{".kt", ".kts"}, LSPServerID: "kotlin-language-server", CodeMirrorID: "kotlin", TreeSitterID: "kotlin", ARLESupported: true},
	"lua":      {ID: "lua", Name: "Lua", Extensions: []string{".lua"}, LSPServerID: "lua-language-server", CodeMirrorID: "lua", TreeSitterID: "lua", ARLESupported: true},
	"assembly": {ID: "assembly", Name: "Assembly", Extensions: []string{".asm", ".s", ".S"}, LSPServerID: "", CodeMirrorID: "gas", TreeSitterID: "asm", ARLESupported: true},
	"ruby":     {ID: "ruby", Name: "Ruby", Extensions: []string{".rb", ".rake", ".gemspec", ".ru", ".erb"}, LSPServerID: "solargraph", CodeMirrorID: "ruby", TreeSitterID: "ruby", ARLESupported: true},
	"dart":     {ID: "dart", Name: "Dart", Extensions: []string{".dart"}, LSPServerID: "dart-lsp", CodeMirrorID: "dart", TreeSitterID: "dart", ARLESupported: true},
	"swift":    {ID: "swift", Name: "Swift", Extensions: []string{".swift"}, LSPServerID: "sourcekit-lsp", CodeMirrorID: "swift", TreeSitterID: "swift", ARLESupported: true},
	"r":        {ID: "r", Name: "R", Extensions: []string{".r", ".R", ".rmd", ".Rmd"}, LSPServerID: "r-languageserver", CodeMirrorID: "r", TreeSitterID: "r", ARLESupported: true},
	"groovy":   {ID: "groovy", Name: "Groovy", Extensions: []string{".groovy", ".gradle"}, LSPServerID: "groovy-language-server", CodeMirrorID: "groovy", TreeSitterID: "groovy", ARLESupported: true},
	"vb":       {ID: "vb", Name: "Visual Basic", Extensions: []string{".vb", ".vbs"}, LSPServerID: "", CodeMirrorID: "vb", TreeSitterID: "vb", ARLESupported: true},
	"vba":      {ID: "vba", Name: "VBA", Extensions: []string{".bas", ".cls", ".frm"}, LSPServerID: "", CodeMirrorID: "vb", TreeSitterID: "vba", ARLESupported: true},
	"matlab":   {ID: "matlab", Name: "MATLAB", Extensions: []string{".mat"}, LSPServerID: "", CodeMirrorID: "octave", TreeSitterID: "matlab", ARLESupported: true},
	"perl":     {ID: "perl", Name: "Perl", Extensions: []string{".pl", ".pm", ".pod", ".t"}, LSPServerID: "perlnavigator", CodeMirrorID: "perl", TreeSitterID: "perl", ARLESupported: true},
	"gdscript": {ID: "gdscript", Name: "GDScript", Extensions: []string{".gd"}, LSPServerID: "godot-lsp", CodeMirrorID: "gdscript", TreeSitterID: "gdscript", ARLESupported: true},

	// TIER 3: 17 languages (1-5% developers)
	"elixir":     {ID: "elixir", Name: "Elixir", Extensions: []string{".ex", ".exs"}, LSPServerID: "elixir-ls", CodeMirrorID: "elixir", TreeSitterID: "elixir", ARLESupported: true},
	"scala":      {ID: "scala", Name: "Scala", Extensions: []string{".scala", ".sc"}, LSPServerID: "metals", CodeMirrorID: "scala", TreeSitterID: "scala", ARLESupported: true},
	"delphi":     {ID: "delphi", Name: "Delphi/Pascal", Extensions: []string{".pas", ".pp", ".inc", ".dpr"}, LSPServerID: "", CodeMirrorID: "pascal", TreeSitterID: "pascal", ARLESupported: true},
	"lisp":       {ID: "lisp", Name: "Lisp", Extensions: []string{".lisp", ".lsp", ".cl", ".el"}, LSPServerID: "", CodeMirrorID: "commonlisp", TreeSitterID: "commonlisp", ARLESupported: true},
	"zig":        {ID: "zig", Name: "Zig", Extensions: []string{".zig"}, LSPServerID: "zls", CodeMirrorID: "zig", TreeSitterID: "zig", ARLESupported: true},
	"erlang":     {ID: "erlang", Name: "Erlang", Extensions: []string{".erl", ".hrl"}, LSPServerID: "erlang-ls", CodeMirrorID: "erlang", TreeSitterID: "erlang", ARLESupported: true},
	"fortran":    {ID: "fortran", Name: "Fortran", Extensions: []string{".f", ".for", ".f90", ".f95", ".f03"}, LSPServerID: "fortls", CodeMirrorID: "fortran", TreeSitterID: "fortran", ARLESupported: true},
	"ada":        {ID: "ada", Name: "Ada", Extensions: []string{".adb", ".ads"}, LSPServerID: "ada-language-server", CodeMirrorID: "ada", TreeSitterID: "ada", ARLESupported: true},
	"fsharp":     {ID: "fsharp", Name: "F#", Extensions: []string{".fs", ".fsi", ".fsx"}, LSPServerID: "fsautocomplete", CodeMirrorID: "fsharp", TreeSitterID: "fsharp", ARLESupported: true},
	"ocaml":      {ID: "ocaml", Name: "OCaml", Extensions: []string{".ml", ".mli"}, LSPServerID: "ocamllsp", CodeMirrorID: "ocaml", TreeSitterID: "ocaml", ARLESupported: true},
	"gleam":      {ID: "gleam", Name: "Gleam", Extensions: []string{".gleam"}, LSPServerID: "gleam-lsp", CodeMirrorID: "gleam", TreeSitterID: "gleam", ARLESupported: true},
	"prolog":     {ID: "prolog", Name: "Prolog", Extensions: []string{".pl", ".pro", ".P"}, LSPServerID: "", CodeMirrorID: "prolog", TreeSitterID: "prolog", ARLESupported: true},
	"cobol":      {ID: "cobol", Name: "COBOL", Extensions: []string{".cob", ".cbl", ".cpy"}, LSPServerID: "cobol-language-support", CodeMirrorID: "cobol", TreeSitterID: "cobol", ARLESupported: true},
	"haskell":    {ID: "haskell", Name: "Haskell", Extensions: []string{".hs", ".lhs"}, LSPServerID: "haskell-language-server", CodeMirrorID: "haskell", TreeSitterID: "haskell", ARLESupported: true},
	"julia":      {ID: "julia", Name: "Julia", Extensions: []string{".jl"}, LSPServerID: "julia-lsp", CodeMirrorID: "julia", TreeSitterID: "julia", ARLESupported: true},
	"clojure":    {ID: "clojure", Name: "Clojure", Extensions: []string{".clj", ".cljs", ".cljc", ".edn"}, LSPServerID: "clojure-lsp", CodeMirrorID: "clojure", TreeSitterID: "clojure", ARLESupported: true},
	"objectivec": {ID: "objectivec", Name: "Objective-C", Extensions: []string{".m", ".mm"}, LSPServerID: "clangd", CodeMirrorID: "objectivec", TreeSitterID: "objc", ARLESupported: true},

	// DATA/CONFIG: 9 languages
	"json":       {ID: "json", Name: "JSON", Extensions: []string{".json", ".jsonc", ".json5"}, LSPServerID: "vscode-json-language-server", CodeMirrorID: "json", TreeSitterID: "json", ARLESupported: true},
	"yaml":       {ID: "yaml", Name: "YAML", Extensions: []string{".yaml", ".yml"}, LSPServerID: "yaml-language-server", CodeMirrorID: "yaml", TreeSitterID: "yaml", ARLESupported: true},
	"xml":        {ID: "xml", Name: "XML", Extensions: []string{".xml", ".xsl", ".xsd", ".svg", ".wsdl"}, LSPServerID: "lemminx", CodeMirrorID: "xml", TreeSitterID: "xml", ARLESupported: true},
	"toml":       {ID: "toml", Name: "TOML", Extensions: []string{".toml"}, LSPServerID: "taplo", CodeMirrorID: "toml", TreeSitterID: "toml", ARLESupported: true},
	"ini":        {ID: "ini", Name: "INI", Extensions: []string{".ini", ".cfg", ".conf"}, LSPServerID: "", CodeMirrorID: "ini", TreeSitterID: "ini", ARLESupported: true},
	"nginx":      {ID: "nginx", Name: "Nginx", Extensions: []string{".nginx", "nginx.conf"}, LSPServerID: "", CodeMirrorID: "nginx", TreeSitterID: "nginx", ARLESupported: true},
	"diff":       {ID: "diff", Name: "Diff/Patch", Extensions: []string{".diff", ".patch"}, LSPServerID: "", CodeMirrorID: "diff", TreeSitterID: "diff", ARLESupported: true},
	"dockerfile": {ID: "dockerfile", Name: "Dockerfile", Extensions: []string{"Dockerfile", ".dockerfile"}, LSPServerID: "dockerfile-language-server", CodeMirrorID: "dockerfile", TreeSitterID: "dockerfile", ARLESupported: true},
	"markdown":   {ID: "markdown", Name: "Markdown", Extensions: []string{".md", ".markdown", ".mdx"}, LSPServerID: "marksman", CodeMirrorID: "markdown", TreeSitterID: "markdown", ARLESupported: true},

	// ADDITIONAL WEB (CSS variants, frameworks)
	"scss":   {ID: "scss", Name: "SCSS", Extensions: []string{".scss"}, LSPServerID: "vscode-css-language-server", CodeMirrorID: "scss", TreeSitterID: "scss", ARLESupported: true},
	"sass":   {ID: "sass", Name: "Sass", Extensions: []string{".sass"}, LSPServerID: "vscode-css-language-server", CodeMirrorID: "sass", TreeSitterID: "scss", ARLESupported: true},
	"less":   {ID: "less", Name: "Less", Extensions: []string{".less"}, LSPServerID: "vscode-css-language-server", CodeMirrorID: "less", TreeSitterID: "css", ARLESupported: true},
	"vue":    {ID: "vue", Name: "Vue", Extensions: []string{".vue"}, LSPServerID: "vue-language-server", CodeMirrorID: "vue", TreeSitterID: "vue", ARLESupported: true},
	"svelte": {ID: "svelte", Name: "Svelte", Extensions: []string{".svelte"}, LSPServerID: "svelte-language-server", CodeMirrorID: "svelte", TreeSitterID: "svelte", ARLESupported: true},
	"astro":  {ID: "astro", Name: "Astro", Extensions: []string{".astro"}, LSPServerID: "astro-ls", CodeMirrorID: "astro", TreeSitterID: "astro", ARLESupported: true},

	// ADDITIONAL USEFUL
	"graphql":   {ID: "graphql", Name: "GraphQL", Extensions: []string{".graphql", ".gql"}, LSPServerID: "graphql-lsp", CodeMirrorID: "graphql", TreeSitterID: "graphql", ARLESupported: true},
	"protobuf":  {ID: "protobuf", Name: "Protocol Buffers", Extensions: []string{".proto"}, LSPServerID: "bufls", CodeMirrorID: "protobuf", TreeSitterID: "proto", ARLESupported: true},
	"terraform": {ID: "terraform", Name: "Terraform/HCL", Extensions: []string{".tf", ".tfvars", ".hcl"}, LSPServerID: "terraform-ls", CodeMirrorID: "hcl", TreeSitterID: "hcl", ARLESupported: true},
	"makefile":  {ID: "makefile", Name: "Makefile", Extensions: []string{"Makefile", ".mk", "GNUmakefile"}, LSPServerID: "", CodeMirrorID: "makefile", TreeSitterID: "make", ARLESupported: true},
	"cmake":     {ID: "cmake", Name: "CMake", Extensions: []string{"CMakeLists.txt", ".cmake"}, LSPServerID: "cmake-language-server", CodeMirrorID: "cmake", TreeSitterID: "cmake", ARLESupported: true},
	"latex":     {ID: "latex", Name: "LaTeX", Extensions: []string{".tex", ".ltx", ".sty", ".cls"}, LSPServerID: "texlab", CodeMirrorID: "latex", TreeSitterID: "latex", ARLESupported: true},
	"solidity":  {ID: "solidity", Name: "Solidity", Extensions: []string{".sol"}, LSPServerID: "solidity-ls", CodeMirrorID: "solidity", TreeSitterID: "solidity", ARLESupported: true},
	"wgsl":      {ID: "wgsl", Name: "WGSL", Extensions: []string{".wgsl"}, LSPServerID: "wgsl-analyzer", CodeMirrorID: "wgsl", TreeSitterID: "wgsl", ARLESupported: true},
	"glsl":      {ID: "glsl", Name: "GLSL", Extensions: []string{".glsl", ".vert", ".frag", ".geom"}, LSPServerID: "glsl-analyzer", CodeMirrorID: "glsl", TreeSitterID: "glsl", ARLESupported: true},
	"env":       {ID: "env", Name: "Environment", Extensions: []string{".env", ".env.local", ".env.example"}, LSPServerID: "", CodeMirrorID: "properties", TreeSitterID: "dotenv", ARLESupported: true},
}

var extensionToLanguage = make(map[string]string)

func init() {
	for langID, info := range Languages {
		for _, ext := range info.Extensions {
			extensionToLanguage[strings.ToLower(ext)] = langID
		}
	}
}

func GetLanguageByExtension(ext string) *LanguageInfo {
	ext = strings.ToLower(ext)
	if !strings.HasPrefix(ext, ".") {
		ext = "." + ext
	}

	if langID, ok := extensionToLanguage[ext]; ok {
		return Languages[langID]
	}
	return nil
}

func GetLanguageByFilename(filename string) *LanguageInfo {
	if strings.HasSuffix(filename, ".C") || strings.HasSuffix(filename, ".H") {
		return Languages["cpp"]
	}

	filenameLower := strings.ToLower(filename)
	baseLower := strings.ToLower(filepath.Base(filename))

	for _, info := range Languages {
		for _, ext := range info.Extensions {
			if !strings.HasPrefix(ext, ".") && strings.EqualFold(ext, baseLower) {
				return info
			}
		}
	}

	filename = filenameLower

	for _, info := range Languages {
		for _, ext := range info.Extensions {
			if strings.HasPrefix(ext, ".") && strings.HasSuffix(filename, strings.ToLower(ext)) {
				return info
			}
		}
	}

	idx := strings.LastIndex(filename, ".")
	if idx == -1 {
		return nil
	}
	return GetLanguageByExtension(filename[idx:])
}

func GetLanguageByID(id string) *LanguageInfo {
	return Languages[id]
}

func GetAllLanguages() []*LanguageInfo {
	result := make([]*LanguageInfo, 0, len(Languages))
	for _, info := range Languages {
		result = append(result, info)
	}
	return result
}

func GetLanguagesWithLSP() []*LanguageInfo {
	result := make([]*LanguageInfo, 0)
	for _, info := range Languages {
		if info.LSPServerID != "" {
			result = append(result, info)
		}
	}
	return result
}

func GetARLESupportedLanguages() []*LanguageInfo {
	result := make([]*LanguageInfo, 0)
	for _, info := range Languages {
		if info.ARLESupported {
			result = append(result, info)
		}
	}
	return result
}

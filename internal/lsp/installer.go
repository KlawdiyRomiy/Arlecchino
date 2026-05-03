package lsp

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

type LSPInfo struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Languages    []string `json:"languages"`
	Extensions   []string `json:"extensions"`
	Installed    bool     `json:"installed"`
	Version      string   `json:"version"`
	CanInstall   bool     `json:"canInstall"`
	InstallCmd   string   `json:"installCmd"`
	DownloadURL  string   `json:"-"`
	InstallType  string   `json:"-"`
	BinaryName   string   `json:"-"`
	Dependencies []string `json:"-"`
}

type InstallProgress struct {
	LSPID      string  `json:"lspId"`
	Stage      string  `json:"stage"`
	Percent    float64 `json:"percent"`
	Message    string  `json:"message"`
	Error      string  `json:"error"`
	BytesTotal int64   `json:"bytesTotal"`
	BytesDone  int64   `json:"bytesDone"`
}

type InstallState struct {
	LSPID      string    `json:"lspId"`
	Stage      string    `json:"stage"`
	Percent    float64   `json:"percent"`
	Message    string    `json:"message"`
	Error      string    `json:"error"`
	Running    bool      `json:"running"`
	StartedAt  time.Time `json:"startedAt"`
	FinishedAt time.Time `json:"finishedAt,omitempty"`
	BytesTotal int64     `json:"bytesTotal"`
	BytesDone  int64     `json:"bytesDone"`
}

type Installer struct {
	mu             sync.RWMutex
	lspDir         string
	servers        map[string]*LSPInfo
	installing     map[string]bool
	installStates  map[string]InstallState
	installTimeout time.Duration
	onProgress     func(progress InstallProgress)
	httpClient     *http.Client
}

func NewInstaller(onProgress func(InstallProgress)) (*Installer, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("failed to get home dir: %w", err)
	}

	lspDir := DefaultLSPDir()
	if lspDir == "" {
		lspDir = filepath.Join(home, ".arlecchino", "lsp")
	}
	if err := os.MkdirAll(lspDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create lsp dir: %w", err)
	}

	i := &Installer{
		lspDir:         lspDir,
		servers:        make(map[string]*LSPInfo),
		installing:     make(map[string]bool),
		installStates:  make(map[string]InstallState),
		installTimeout: 10 * time.Minute,
		onProgress:     onProgress,
		httpClient:     &http.Client{Timeout: 5 * time.Minute},
	}

	i.registerServers()
	return i, nil
}

func (i *Installer) registerServers() {
	servers := []*LSPInfo{
		{ID: "gopls", Name: "Go Language Server", Languages: []string{"go"}, Extensions: []string{".go", ".mod", ".sum"}, InstallType: "go", InstallCmd: "go install golang.org/x/tools/gopls@latest", BinaryName: "gopls", CanInstall: true, Dependencies: []string{"go"}},
		{ID: "typescript-language-server", Name: "TypeScript/JavaScript", Languages: []string{"typescript", "javascript", "typescriptreact", "javascriptreact"}, Extensions: []string{".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"}, InstallType: "npm", InstallCmd: "npm install -g typescript-language-server typescript", BinaryName: "typescript-language-server", CanInstall: true, Dependencies: []string{"node", "npm"}},
		{ID: "pyright", Name: "Python (Pyright)", Languages: []string{"python"}, Extensions: []string{".py", ".pyi", ".pyw"}, InstallType: "npm", InstallCmd: "npm install -g pyright", BinaryName: "pyright-langserver", CanInstall: true, Dependencies: []string{"node", "npm"}},
		{ID: "phpactor", Name: "PHP Language Server", Languages: []string{"php"}, Extensions: []string{".php", ".phtml"}, InstallType: "composer", InstallCmd: "composer global require phpactor/phpactor", BinaryName: "phpactor", CanInstall: true, Dependencies: []string{"php", "composer"}},
		{ID: "rust-analyzer", Name: "Rust Language Server", Languages: []string{"rust"}, Extensions: []string{".rs"}, InstallType: "rustup", InstallCmd: "rustup component add rust-analyzer", BinaryName: "rust-analyzer", CanInstall: true, Dependencies: []string{"rustup"}},
		{ID: "vscode-css-language-server", Name: "CSS/SCSS/Less", Languages: []string{"css", "scss", "sass", "less"}, Extensions: []string{".css", ".scss", ".sass", ".less"}, InstallType: "npm", InstallCmd: "npm install -g vscode-langservers-extracted", BinaryName: "vscode-css-language-server", CanInstall: true, Dependencies: []string{"node", "npm"}},
		{ID: "vscode-html-language-server", Name: "HTML Language Server", Languages: []string{"html", "blade"}, Extensions: []string{".html", ".htm", ".blade.php"}, InstallType: "npm", InstallCmd: "npm install -g vscode-langservers-extracted", BinaryName: "vscode-html-language-server", CanInstall: true, Dependencies: []string{"node", "npm"}},
		{ID: "vscode-json-language-server", Name: "JSON Language Server", Languages: []string{"json", "jsonc"}, Extensions: []string{".json", ".jsonc", ".json5"}, InstallType: "npm", InstallCmd: "npm install -g vscode-langservers-extracted", BinaryName: "vscode-json-language-server", CanInstall: true, Dependencies: []string{"node", "npm"}},
		{ID: "vue-language-server", Name: "Vue Language Server", Languages: []string{"vue"}, Extensions: []string{".vue"}, InstallType: "npm", InstallCmd: "npm install -g @vue/language-server", BinaryName: "vue-language-server", CanInstall: true, Dependencies: []string{"node", "npm"}},
		{ID: "svelte-language-server", Name: "Svelte Language Server", Languages: []string{"svelte"}, Extensions: []string{".svelte"}, InstallType: "npm", InstallCmd: "npm install -g svelte-language-server", BinaryName: "svelteserver", CanInstall: true, Dependencies: []string{"node", "npm"}},
		{ID: "astro-ls", Name: "Astro Language Server", Languages: []string{"astro"}, Extensions: []string{".astro"}, InstallType: "npm", InstallCmd: "npm install -g @astrojs/language-server", BinaryName: "astro-ls", CanInstall: true, Dependencies: []string{"node", "npm"}},
		{ID: "clangd", Name: "C/C++ Language Server", Languages: []string{"c", "cpp", "objc", "objcpp"}, Extensions: []string{".c", ".h", ".cpp", ".hpp", ".cc", ".cxx", ".m", ".mm"}, InstallType: "system", InstallCmd: getClangdInstallCmd(), BinaryName: "clangd", CanInstall: false},
		brewInstallableServer("zls", "Zig Language Server", []string{"zig"}, []string{".zig"}, "zls", "zls"),
		{ID: "yaml-language-server", Name: "YAML Language Server", Languages: []string{"yaml"}, Extensions: []string{".yaml", ".yml"}, InstallType: "npm", InstallCmd: "npm install -g yaml-language-server", BinaryName: "yaml-language-server", CanInstall: true, Dependencies: []string{"node", "npm"}},
		{ID: "taplo", Name: "TOML Language Server", Languages: []string{"toml"}, Extensions: []string{".toml"}, InstallType: "cargo", InstallCmd: "cargo install taplo-cli --locked", BinaryName: "taplo", CanInstall: true, Dependencies: []string{"cargo"}},
		brewInstallableServer("marksman", "Markdown Language Server", []string{"markdown"}, []string{".md", ".markdown"}, "marksman", "marksman"),
		{ID: "bash-language-server", Name: "Bash Language Server", Languages: []string{"bash", "sh", "shell"}, Extensions: []string{".sh", ".bash", ".zsh", ".fish"}, InstallType: "npm", InstallCmd: "npm install -g bash-language-server", BinaryName: "bash-language-server", CanInstall: true, Dependencies: []string{"node", "npm"}},
		{ID: "dockerfile-language-server", Name: "Dockerfile Language Server", Languages: []string{"dockerfile"}, Extensions: []string{"Dockerfile"}, InstallType: "npm", InstallCmd: "npm install -g dockerfile-language-server-nodejs", BinaryName: "docker-langserver", CanInstall: true, Dependencies: []string{"node", "npm"}},
		{ID: "solargraph", Name: "Ruby Language Server", Languages: []string{"ruby"}, Extensions: []string{".rb", ".rake", ".gemspec"}, InstallType: "gem", InstallCmd: "gem install solargraph", BinaryName: "solargraph", CanInstall: true, Dependencies: []string{"ruby", "gem"}},
		brewInstallableServer("lua-language-server", "Lua Language Server", []string{"lua"}, []string{".lua"}, "lua-language-server", "lua-language-server"),
		{ID: "kotlin-language-server", Name: "Kotlin Language Server", Languages: []string{"kotlin"}, Extensions: []string{".kt", ".kts"}, InstallType: "binary", InstallCmd: "Download from https://github.com/fwcd/kotlin-language-server/releases", BinaryName: "kotlin-language-server", CanInstall: false},
		{ID: "graphql-lsp", Name: "GraphQL Language Server", Languages: []string{"graphql"}, Extensions: []string{".graphql", ".gql"}, InstallType: "npm", InstallCmd: "npm install -g graphql-language-service-cli", BinaryName: "graphql-lsp", CanInstall: true, Dependencies: []string{"node", "npm"}},
		{ID: "terraform-ls", Name: "Terraform Language Server", Languages: []string{"terraform", "hcl"}, Extensions: []string{".tf", ".tfvars", ".hcl"}, InstallType: "binary", InstallCmd: "Download from https://releases.hashicorp.com/terraform-ls/", BinaryName: "terraform-ls", CanInstall: false},
		{ID: "sql-language-server", Name: "SQL Language Server", Languages: []string{"sql"}, Extensions: []string{".sql"}, InstallType: "npm", InstallCmd: "npm install -g sql-language-server", BinaryName: "sql-language-server", CanInstall: true, Dependencies: []string{"node", "npm"}},
		{ID: "jdtls", Name: "Java Language Server", Languages: []string{"java"}, Extensions: []string{".java"}, InstallType: "binary", InstallCmd: "Download from https://download.eclipse.org/jdtls/", BinaryName: "jdtls", CanInstall: false},
		{ID: "omnisharp", Name: "C# Language Server", Languages: []string{"csharp"}, Extensions: []string{".cs", ".csx"}, InstallType: "binary", InstallCmd: "Download from https://github.com/OmniSharp/omnisharp-roslyn/releases", BinaryName: "omnisharp", CanInstall: false},
		{ID: "metals", Name: "Scala Language Server", Languages: []string{"scala"}, Extensions: []string{".scala", ".sc"}, InstallType: "binary", InstallCmd: "cs install metals", BinaryName: "metals", CanInstall: false},
		{ID: "sourcekit-lsp", Name: "Swift Language Server", Languages: []string{"swift"}, Extensions: []string{".swift"}, InstallType: "system", InstallCmd: "Included with Xcode", BinaryName: "sourcekit-lsp", CanInstall: false},
		{ID: "dart-lsp", Name: "Dart Language Server", Languages: []string{"dart"}, Extensions: []string{".dart"}, InstallType: "system", InstallCmd: "Included with Dart SDK", BinaryName: "dart", CanInstall: false},
		{ID: "elixir-ls", Name: "Elixir Language Server", Languages: []string{"elixir"}, Extensions: []string{".ex", ".exs"}, InstallType: "binary", InstallCmd: "Download from https://github.com/elixir-lsp/elixir-ls/releases", BinaryName: "elixir-ls", CanInstall: false},
		{ID: "haskell-language-server", Name: "Haskell Language Server", Languages: []string{"haskell"}, Extensions: []string{".hs", ".lhs"}, InstallType: "binary", InstallCmd: "ghcup install hls", BinaryName: "haskell-language-server-wrapper", CanInstall: false},
		{ID: "ocamllsp", Name: "OCaml Language Server", Languages: []string{"ocaml"}, Extensions: []string{".ml", ".mli"}, InstallType: "opam", InstallCmd: "opam install ocaml-lsp-server", BinaryName: "ocamllsp", CanInstall: false},
		{ID: "clojure-lsp", Name: "Clojure Language Server", Languages: []string{"clojure"}, Extensions: []string{".clj", ".cljs", ".cljc", ".edn"}, InstallType: "binary", InstallCmd: "brew install clojure-lsp/brew/clojure-lsp-native", BinaryName: "clojure-lsp", CanInstall: false},
		{ID: "lemminx", Name: "XML Language Server", Languages: []string{"xml"}, Extensions: []string{".xml", ".xsl", ".xsd", ".svg", ".wsdl"}, InstallType: "binary", InstallCmd: "Download from https://github.com/eclipse/lemminx/releases", BinaryName: "lemminx", CanInstall: false},
		{ID: "texlab", Name: "LaTeX Language Server", Languages: []string{"latex", "bibtex"}, Extensions: []string{".tex", ".ltx", ".sty", ".cls", ".bib"}, InstallType: "cargo", InstallCmd: "cargo install texlab", BinaryName: "texlab", CanInstall: true, Dependencies: []string{"cargo"}},
		{ID: "cmake-language-server", Name: "CMake Language Server", Languages: []string{"cmake"}, Extensions: []string{"CMakeLists.txt", ".cmake"}, InstallType: "pip", InstallCmd: "pip install cmake-language-server", BinaryName: "cmake-language-server", CanInstall: true, Dependencies: []string{"pip"}},
		{ID: "fortls", Name: "Fortran Language Server", Languages: []string{"fortran"}, Extensions: []string{".f", ".for", ".f90", ".f95"}, InstallType: "pip", InstallCmd: "pip install fortran-language-server", BinaryName: "fortls", CanInstall: true, Dependencies: []string{"pip"}},
		{ID: "erlang-ls", Name: "Erlang Language Server", Languages: []string{"erlang"}, Extensions: []string{".erl", ".hrl"}, InstallType: "binary", InstallCmd: "Download from https://github.com/erlang-ls/erlang_ls/releases", BinaryName: "erlang_ls", CanInstall: false},
		{ID: "groovy-language-server", Name: "Groovy Language Server", Languages: []string{"groovy"}, Extensions: []string{".groovy", ".gradle"}, InstallType: "binary", InstallCmd: "Download from https://github.com/GroovyLanguageServer/groovy-language-server/releases", BinaryName: "groovy-language-server", CanInstall: false},
		{ID: "nimlsp", Name: "Nim Language Server", Languages: []string{"nim"}, Extensions: []string{".nim", ".nims"}, InstallType: "nimble", InstallCmd: "nimble install nimlsp", BinaryName: "nimlsp", CanInstall: false},
		{ID: "crystalline", Name: "Crystal Language Server", Languages: []string{"crystal"}, Extensions: []string{".cr"}, InstallType: "binary", InstallCmd: "Download from https://github.com/elbywan/crystalline/releases", BinaryName: "crystalline", CanInstall: false},
		{ID: "solidity-ls", Name: "Solidity Language Server", Languages: []string{"solidity"}, Extensions: []string{".sol"}, InstallType: "npm", InstallCmd: "npm install -g @nomicfoundation/solidity-language-server", BinaryName: "nomicfoundation-solidity-language-server", CanInstall: true, Dependencies: []string{"node", "npm"}},
		{ID: "wgsl-analyzer", Name: "WGSL Language Server", Languages: []string{"wgsl"}, Extensions: []string{".wgsl"}, InstallType: "cargo", InstallCmd: "cargo install wgsl-analyzer", BinaryName: "wgsl-analyzer", CanInstall: true, Dependencies: []string{"cargo"}},
		{ID: "glsl-analyzer", Name: "GLSL Language Server", Languages: []string{"glsl"}, Extensions: []string{".glsl", ".vert", ".frag", ".geom"}, InstallType: "cargo", InstallCmd: "cargo install glsl-analyzer", BinaryName: "glsl-analyzer", CanInstall: true, Dependencies: []string{"cargo"}},
		{ID: "bufls", Name: "Protocol Buffers Server", Languages: []string{"protobuf"}, Extensions: []string{".proto"}, InstallType: "go", InstallCmd: "go install github.com/bufbuild/buf-language-server/cmd/bufls@latest", BinaryName: "bufls", CanInstall: true, Dependencies: []string{"go"}},
		{ID: "r-languageserver", Name: "R Language Server", Languages: []string{"r"}, Extensions: []string{".r", ".R", ".rmd", ".Rmd"}, InstallType: "r", InstallCmd: "R -e 'install.packages(\"languageserver\")'", BinaryName: "R", CanInstall: false},
		{ID: "julia-lsp", Name: "Julia Language Server", Languages: []string{"julia"}, Extensions: []string{".jl"}, InstallType: "julia", InstallCmd: "Julia pkg> add LanguageServer", BinaryName: "julia", CanInstall: false},
		{ID: "vls", Name: "V Language Server", Languages: []string{"v"}, Extensions: []string{".v", ".vsh"}, InstallType: "v", InstallCmd: "v install vls", BinaryName: "vls", CanInstall: false},
		{ID: "ols", Name: "Odin Language Server", Languages: []string{"odin"}, Extensions: []string{".odin"}, InstallType: "binary", InstallCmd: "Download from https://github.com/DanielGaworworski/ols/releases", BinaryName: "ols", CanInstall: false},
		{ID: "ada-language-server", Name: "Ada Language Server", Languages: []string{"ada"}, Extensions: []string{".adb", ".ads"}, InstallType: "binary", InstallCmd: "Download from https://github.com/AdaCore/ada_language_server/releases", BinaryName: "ada_language_server", CanInstall: false},
		{ID: "pasls", Name: "Pascal Language Server", Languages: []string{"pascal"}, Extensions: []string{".pas", ".pp", ".inc"}, InstallType: "binary", InstallCmd: "Download from https://github.com/genericptr/pascal-language-server/releases", BinaryName: "pasls", CanInstall: false},
		{ID: "perlnavigator", Name: "Perl Language Server", Languages: []string{"perl"}, Extensions: []string{".pl", ".pm", ".pod", ".t"}, InstallType: "npm", InstallCmd: "npm install -g perlnavigator-server", BinaryName: "perlnavigator", CanInstall: true, Dependencies: []string{"node", "npm"}},
		{ID: "powershell-editor-services", Name: "PowerShell Server", Languages: []string{"powershell"}, Extensions: []string{".ps1", ".psm1", ".psd1"}, InstallType: "binary", InstallCmd: "Install PowerShell extension", BinaryName: "pwsh", CanInstall: false},
		{ID: "move-analyzer", Name: "Move Language Server", Languages: []string{"move"}, Extensions: []string{".move"}, InstallType: "cargo", InstallCmd: "cargo install move-analyzer", BinaryName: "move-analyzer", CanInstall: true, Dependencies: []string{"cargo"}},
		{ID: "fsautocomplete", Name: "F# Language Server", Languages: []string{"fsharp"}, Extensions: []string{".fs", ".fsi", ".fsx"}, InstallType: "dotnet", InstallCmd: "dotnet tool install -g fsautocomplete", BinaryName: "fsautocomplete", CanInstall: false},
	}

	for _, s := range servers {
		i.servers[s.ID] = s
	}
}

func brewInstallableServer(id, name string, languages, extensions []string, formula, binaryName string) *LSPInfo {
	info := &LSPInfo{
		ID:         id,
		Name:       name,
		Languages:  languages,
		Extensions: extensions,
		InstallCmd: "brew install " + formula,
		BinaryName: binaryName,
	}

	if runtime.GOOS == "darwin" {
		info.InstallType = "brew"
		info.CanInstall = true
		info.Dependencies = []string{"brew"}
		return info
	}

	info.InstallType = "system"
	info.CanInstall = false
	return info
}

func (i *Installer) GetLSPDir() string {
	return i.lspDir
}

func DefaultLSPDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".arlecchino", "lsp")
}

func FindBinaryPath(rootPath, lspDir, serverID, binaryName string) string {
	binaryName = strings.TrimSpace(binaryName)
	if binaryName == "" {
		return ""
	}

	for _, candidate := range binaryPathCandidates(rootPath, lspDir, serverID, binaryName) {
		if executableFileExists(candidate) {
			return candidate
		}
	}
	return ""
}

func binaryPathCandidates(rootPath, lspDir, serverID, binaryName string) []string {
	var candidates []string
	add := func(parts ...string) {
		path := filepath.Join(parts...)
		if strings.TrimSpace(path) != "" {
			candidates = append(candidates, path)
		}
	}
	addRaw := func(path string) {
		if strings.TrimSpace(path) != "" {
			candidates = append(candidates, path)
		}
	}
	addGlob := func(pattern string) {
		matches, _ := filepath.Glob(pattern)
		for i := len(matches) - 1; i >= 0; i-- {
			addRaw(matches[i])
		}
	}

	if rootPath != "" {
		add(rootPath, "vendor", "bin", binaryName)
		add(rootPath, "node_modules", ".bin", binaryName)
		add(rootPath, ".venv", "bin", binaryName)
		add(rootPath, "venv", "bin", binaryName)
	}
	if lspDir == "" {
		lspDir = DefaultLSPDir()
	}
	if lspDir != "" && serverID != "" {
		add(lspDir, serverID, binaryName)
	}
	if path, err := exec.LookPath(binaryName); err == nil {
		addRaw(path)
	}

	home, _ := os.UserHomeDir()
	if home != "" {
		if composerHome := os.Getenv("COMPOSER_HOME"); composerHome != "" {
			add(composerHome, "vendor", "bin", binaryName)
		}
		add(home, ".composer", "vendor", "bin", binaryName)
		add(home, ".config", "composer", "vendor", "bin", binaryName)
		add(home, "Library", "Application Support", "Composer", "vendor", "bin", binaryName)
		add(home, ".local", "bin", binaryName)
		add(home, "go", "bin", binaryName)
		add(home, ".cargo", "bin", binaryName)
		add(home, ".npm-global", "bin", binaryName)
		addGlob(filepath.Join(home, ".gem", "ruby", "*", "bin", binaryName))
		addGlob(filepath.Join(home, "Library", "Python", "*", "bin", binaryName))
	}
	if npmPrefix := os.Getenv("NPM_CONFIG_PREFIX"); npmPrefix != "" {
		add(npmPrefix, "bin", binaryName)
	}
	add("/opt/homebrew", "bin", binaryName)
	add("/usr/local", "bin", binaryName)
	addGlob(filepath.Join("/Library", "Ruby", "Gems", "*", "bin", binaryName))

	return uniqueStrings(candidates)
}

func executableFileExists(path string) bool {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return false
	}
	if runtime.GOOS == "windows" {
		return true
	}
	return info.Mode()&0111 != 0
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]bool, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func (i *Installer) GetAllServers() []*LSPInfo {
	i.mu.RLock()
	defer i.mu.RUnlock()

	result := make([]*LSPInfo, 0, len(i.servers))
	for _, s := range i.servers {
		info := *s
		info.Installed, info.Version = i.checkInstalled(s)
		result = append(result, &info)
	}
	return result
}

func (i *Installer) GetServerForExtension(ext string) *LSPInfo {
	i.mu.RLock()
	defer i.mu.RUnlock()

	ext = strings.ToLower(ext)
	if !strings.HasPrefix(ext, ".") {
		ext = "." + ext
	}

	for _, s := range i.servers {
		for _, e := range s.Extensions {
			if strings.EqualFold(e, ext) {
				info := *s
				info.Installed, info.Version = i.checkInstalled(s)
				return &info
			}
		}
	}
	return nil
}

func (i *Installer) GetServerByID(id string) *LSPInfo {
	i.mu.RLock()
	defer i.mu.RUnlock()

	if s, ok := i.servers[id]; ok {
		info := *s
		info.Installed, info.Version = i.checkInstalled(s)
		return &info
	}
	return nil
}

func (i *Installer) IsInstalling(id string) bool {
	i.mu.RLock()
	defer i.mu.RUnlock()
	return i.installing[id]
}

func (i *Installer) GetInstallState(id string) InstallState {
	i.mu.RLock()
	defer i.mu.RUnlock()
	return i.installStates[id]
}

func (i *Installer) InstallAsync(ctx context.Context, id string, onDone func(error)) error {
	server, already, err := i.beginInstall(id)
	if err != nil {
		return err
	}
	if already {
		return nil
	}

	go func() {
		err := i.runInstall(ctx, server)
		if onDone != nil {
			onDone(err)
		}
	}()
	return nil
}

func (i *Installer) Install(ctx context.Context, id string) error {
	server, already, err := i.beginInstall(id)
	if err != nil {
		return err
	}
	if already {
		return fmt.Errorf("already installing: %s", id)
	}
	return i.runInstall(ctx, server)
}

func (i *Installer) beginInstall(id string) (*LSPInfo, bool, error) {
	i.mu.Lock()
	server, ok := i.servers[id]
	if !ok {
		i.mu.Unlock()
		return nil, false, fmt.Errorf("unknown LSP server: %s", id)
	}
	if i.installing[id] {
		i.mu.Unlock()
		return nil, true, nil
	}
	serverCopy := *server
	i.installing[id] = true
	i.installStates[id] = InstallState{
		LSPID:     id,
		Stage:     "queued",
		Percent:   0,
		Message:   "Queued installation...",
		Running:   true,
		StartedAt: time.Now(),
	}
	i.mu.Unlock()

	i.emitProgress(id, "queued", 0, "Queued installation...", "")
	return &serverCopy, false, nil
}

func (i *Installer) runInstall(ctx context.Context, server *LSPInfo) error {
	if ctx == nil {
		ctx = context.Background()
	}
	if i.installTimeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, i.installTimeout)
		defer cancel()
	}

	id := server.ID

	for _, dep := range server.Dependencies {
		if _, err := exec.LookPath(dep); err != nil {
			i.emitProgress(id, "error", 0, "", fmt.Sprintf("missing dependency: %s", dep))
			return fmt.Errorf("missing dependency %s: install it first", dep)
		}
	}

	i.emitProgress(id, "installing", 0, "Starting installation...", "")

	var err error
	switch server.InstallType {
	case "npm":
		err = i.installNPM(ctx, server)
	case "go":
		err = i.installGo(ctx, server)
	case "pip":
		err = i.installPip(ctx, server)
	case "composer":
		err = i.installComposer(ctx, server)
	case "cargo":
		err = i.installCargo(ctx, server)
	case "rustup":
		err = i.installRustup(ctx, server)
	case "gem":
		err = i.installGem(ctx, server)
	case "brew":
		err = i.installBrew(ctx, server)
	case "binary":
		err = i.installBinary(ctx, server)
	default:
		err = fmt.Errorf("unsupported install type: %s", server.InstallType)
	}

	if err != nil {
		i.emitProgress(id, "error", 0, "", err.Error())
		return err
	}

	if installed, _ := i.checkInstalled(server); !installed {
		err := fmt.Errorf("%s finished but %s was not found", server.Name, server.BinaryName)
		i.emitProgress(id, "error", 0, "", err.Error())
		return err
	}

	i.emitProgress(id, "done", 100, "Installation complete!", "")
	return nil
}

func (i *Installer) installNPM(ctx context.Context, server *LSPInfo) error {
	i.emitProgress(server.ID, "installing", 20, "Running npm install...", "")

	parts := strings.Fields(server.InstallCmd)
	if len(parts) < 3 {
		return fmt.Errorf("invalid npm install command")
	}

	if err := runInstallCommand(ctx, "npm install failed", parts); err != nil {
		return err
	}

	i.emitProgress(server.ID, "installing", 90, "Verifying installation...", "")
	return nil
}

func (i *Installer) installGo(ctx context.Context, server *LSPInfo) error {
	i.emitProgress(server.ID, "installing", 20, "Running go install...", "")

	parts := strings.Fields(server.InstallCmd)
	if err := runInstallCommand(ctx, "go install failed", parts); err != nil {
		return err
	}

	i.emitProgress(server.ID, "installing", 90, "Verifying installation...", "")
	return nil
}

func (i *Installer) installPip(ctx context.Context, server *LSPInfo) error {
	i.emitProgress(server.ID, "installing", 20, "Running pip install...", "")

	pipCmd := "pip3"
	if _, err := exec.LookPath("pip3"); err != nil {
		pipCmd = "pip"
	}

	parts := strings.Fields(server.InstallCmd)
	parts[0] = pipCmd
	if err := runInstallCommand(ctx, "pip install failed", parts); err != nil {
		return err
	}

	i.emitProgress(server.ID, "installing", 90, "Verifying installation...", "")
	return nil
}

func (i *Installer) installComposer(ctx context.Context, server *LSPInfo) error {
	i.emitProgress(server.ID, "installing", 20, "Running composer global require...", "")

	parts := strings.Fields(server.InstallCmd)
	if err := runInstallCommand(ctx, "composer install failed", parts); err != nil {
		return err
	}

	i.emitProgress(server.ID, "installing", 90, "Verifying installation...", "")
	return nil
}

func (i *Installer) installCargo(ctx context.Context, server *LSPInfo) error {
	i.emitProgress(server.ID, "installing", 20, "Running cargo install...", "")

	parts := strings.Fields(server.InstallCmd)
	if err := runInstallCommand(ctx, "cargo install failed", parts); err != nil {
		return err
	}

	i.emitProgress(server.ID, "installing", 90, "Verifying installation...", "")
	return nil
}

func (i *Installer) installRustup(ctx context.Context, server *LSPInfo) error {
	i.emitProgress(server.ID, "installing", 20, "Running rustup component add...", "")

	parts := strings.Fields(server.InstallCmd)
	if err := runInstallCommand(ctx, "rustup failed", parts); err != nil {
		return err
	}

	i.emitProgress(server.ID, "installing", 90, "Verifying installation...", "")
	return nil
}

func (i *Installer) installGem(ctx context.Context, server *LSPInfo) error {
	i.emitProgress(server.ID, "installing", 20, "Running gem install...", "")

	parts := strings.Fields(server.InstallCmd)
	if !hasCommandArg(parts, "--user-install") && !hasCommandArg(parts, "-n") {
		parts = append(parts, "--user-install")
	}
	if err := runInstallCommand(ctx, "gem install failed", parts); err != nil {
		return err
	}

	i.emitProgress(server.ID, "installing", 90, "Verifying installation...", "")
	return nil
}

func hasCommandArg(parts []string, arg string) bool {
	for _, part := range parts {
		if part == arg {
			return true
		}
	}
	return false
}

func (i *Installer) installBrew(ctx context.Context, server *LSPInfo) error {
	i.emitProgress(server.ID, "installing", 20, "Running brew install...", "")

	parts := strings.Fields(server.InstallCmd)
	if len(parts) < 3 || parts[0] != "brew" || parts[1] != "install" {
		return fmt.Errorf("invalid brew install command")
	}

	if err := runInstallCommand(ctx, "brew install failed", parts); err != nil {
		return err
	}

	i.emitProgress(server.ID, "installing", 90, "Verifying installation...", "")
	return nil
}

func runInstallCommand(ctx context.Context, label string, parts []string) error {
	if len(parts) == 0 {
		return fmt.Errorf("%s: empty command", label)
	}
	cmd := exec.CommandContext(ctx, parts[0], parts[1:]...)
	output, err := cmd.CombinedOutput()
	if err == nil {
		return nil
	}
	outputText := trimCommandOutput(string(output), 2000)
	if ctxErr := ctx.Err(); ctxErr != nil {
		if outputText != "" {
			return fmt.Errorf("%s: %w\n%s", label, ctxErr, outputText)
		}
		return fmt.Errorf("%s: %w", label, ctxErr)
	}
	if outputText != "" {
		return fmt.Errorf("%s: %w\n%s", label, err, outputText)
	}
	return fmt.Errorf("%s: %w", label, err)
}

func trimCommandOutput(output string, max int) string {
	output = strings.TrimSpace(output)
	if max <= 0 || len(output) <= max {
		return output
	}
	return output[len(output)-max:]
}

func (i *Installer) installBinary(ctx context.Context, server *LSPInfo) error {
	if server.DownloadURL == "" {
		return fmt.Errorf("no download URL for %s", server.ID)
	}

	i.emitProgress(server.ID, "downloading", 0, "Downloading...", "")

	tmpFile, err := os.CreateTemp("", server.ID+"-*")
	if err != nil {
		return fmt.Errorf("failed to create temp file: %w", err)
	}
	defer os.Remove(tmpFile.Name())
	defer tmpFile.Close()

	req, err := http.NewRequestWithContext(ctx, "GET", server.DownloadURL, nil)
	if err != nil {
		return err
	}

	resp, err := i.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("download failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download failed: HTTP %d", resp.StatusCode)
	}

	total := resp.ContentLength
	var downloaded int64
	buf := make([]byte, 32*1024)

	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			_, writeErr := tmpFile.Write(buf[:n])
			if writeErr != nil {
				return writeErr
			}
			downloaded += int64(n)
			if total > 0 {
				percent := float64(downloaded) / float64(total) * 60
				i.emitProgressWithBytes(server.ID, "downloading", percent, "Downloading...", "", total, downloaded)
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
	}

	tmpFile.Close()

	i.emitProgress(server.ID, "extracting", 70, "Extracting...", "")

	destDir := filepath.Join(i.lspDir, server.ID)
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return err
	}

	if strings.HasSuffix(server.DownloadURL, ".zip") {
		if err := i.extractZip(tmpFile.Name(), destDir); err != nil {
			return err
		}
	} else if strings.HasSuffix(server.DownloadURL, ".tar.gz") || strings.HasSuffix(server.DownloadURL, ".tgz") {
		if err := i.extractTarGz(tmpFile.Name(), destDir); err != nil {
			return err
		}
	} else {
		destPath := filepath.Join(destDir, server.BinaryName)
		if err := os.Rename(tmpFile.Name(), destPath); err != nil {
			if err := copyFile(tmpFile.Name(), destPath); err != nil {
				return err
			}
		}
		os.Chmod(destPath, 0755)
	}

	i.emitProgress(server.ID, "installing", 90, "Finalizing...", "")

	return nil
}

func (i *Installer) extractZip(src, dest string) error {
	r, err := zip.OpenReader(src)
	if err != nil {
		return err
	}
	defer r.Close()

	for _, f := range r.File {
		path, err := safeExtractPath(dest, f.Name)
		if err != nil {
			return err
		}

		if f.FileInfo().IsDir() {
			os.MkdirAll(path, f.Mode())
			continue
		}

		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			return err
		}

		outFile, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, f.Mode())
		if err != nil {
			return err
		}

		rc, err := f.Open()
		if err != nil {
			outFile.Close()
			return err
		}

		_, err = io.Copy(outFile, rc)
		outFile.Close()
		rc.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

func (i *Installer) extractTarGz(src, dest string) error {
	f, err := os.Open(src)
	if err != nil {
		return err
	}
	defer f.Close()

	gzr, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gzr.Close()

	tr := tar.NewReader(gzr)
	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}

		path, err := safeExtractPath(dest, header.Name)
		if err != nil {
			return err
		}

		switch header.Typeflag {
		case tar.TypeDir:
			os.MkdirAll(path, 0755)
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
				return err
			}
			outFile, err := os.Create(path)
			if err != nil {
				return err
			}
			if _, err := io.Copy(outFile, tr); err != nil {
				outFile.Close()
				return err
			}
			outFile.Close()
			os.Chmod(path, os.FileMode(header.Mode))
		}
	}
	return nil
}

func (i *Installer) checkInstalled(server *LSPInfo) (bool, string) {
	path := i.findBinaryPath(server, "")
	if path == "" {
		return false, ""
	}
	version := i.getVersion(path, server.ID)
	return true, version
}

func (i *Installer) getVersion(path, id string) string {
	var cmd *exec.Cmd
	switch id {
	case "gopls":
		cmd = exec.Command(path, "version")
	default:
		cmd = exec.Command(path, "--version")
	}

	output, err := cmd.Output()
	if err != nil {
		return ""
	}

	version := strings.TrimSpace(string(output))
	if idx := strings.Index(version, "\n"); idx > 0 {
		version = version[:idx]
	}
	return version
}

func (i *Installer) GetBinaryPath(id string) string {
	return i.GetBinaryPathForRoot(id, "")
}

func (i *Installer) GetBinaryPathForRoot(id, rootPath string) string {
	server := i.GetServerByID(id)
	if server == nil {
		return ""
	}
	return i.findBinaryPath(server, rootPath)
}

func (i *Installer) findBinaryPath(server *LSPInfo, rootPath string) string {
	if server == nil {
		return ""
	}
	return FindBinaryPath(rootPath, i.lspDir, server.ID, server.BinaryName)
}

func (i *Installer) emitProgress(id, stage string, percent float64, message, errMsg string) {
	i.emitProgressWithBytes(id, stage, percent, message, errMsg, 0, 0)
}

func (i *Installer) emitProgressWithBytes(id, stage string, percent float64, message, errMsg string, total, done int64) {
	progress := InstallProgress{
		LSPID:      id,
		Stage:      stage,
		Percent:    percent,
		Message:    message,
		Error:      errMsg,
		BytesTotal: total,
		BytesDone:  done,
	}

	i.mu.Lock()
	state := i.installStates[id]
	if state.LSPID == "" {
		state.LSPID = id
	}
	if state.StartedAt.IsZero() {
		state.StartedAt = time.Now()
	}
	state.Stage = stage
	state.Percent = percent
	state.Message = message
	state.Error = errMsg
	state.BytesTotal = total
	state.BytesDone = done
	switch normalizedInstallStage(stage) {
	case "done", "complete", "completed", "error", "failed", "failure":
		state.Running = false
		state.FinishedAt = time.Now()
		delete(i.installing, id)
	default:
		state.Running = true
		i.installing[id] = true
	}
	i.installStates[id] = state
	i.mu.Unlock()

	if i.onProgress != nil {
		i.onProgress(progress)
	}
}

func normalizedInstallStage(stage string) string {
	return strings.ToLower(strings.TrimSpace(stage))
}

func safeExtractPath(dest, archivePath string) (string, error) {
	normalized := strings.TrimSpace(strings.ReplaceAll(archivePath, "\\", "/"))
	if normalized == "" {
		return "", fmt.Errorf("archive path is empty")
	}

	cleaned := path.Clean(normalized)
	if cleaned == "." || path.IsAbs(cleaned) || cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return "", fmt.Errorf("archive path escapes destination: %s", archivePath)
	}

	destAbs, err := filepath.Abs(dest)
	if err != nil {
		return "", err
	}
	targetAbs, err := filepath.Abs(filepath.Join(destAbs, filepath.FromSlash(cleaned)))
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(destAbs, targetAbs)
	if err != nil {
		return "", err
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return "", fmt.Errorf("archive path escapes destination: %s", archivePath)
	}

	return targetAbs, nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, in)
	return err
}

func getClangdInstallCmd() string {
	switch runtime.GOOS {
	case "darwin":
		return "brew install llvm"
	case "linux":
		return "apt install clangd"
	default:
		return "choco install llvm"
	}
}

func getZLSDownloadURL() string {
	base := "https://github.com/zigtools/zls/releases/latest/download/"
	switch runtime.GOOS {
	case "darwin":
		if runtime.GOARCH == "arm64" {
			return base + "zls-aarch64-macos.tar.gz"
		}
		return base + "zls-x86_64-macos.tar.gz"
	case "linux":
		return base + "zls-x86_64-linux.tar.gz"
	case "windows":
		return base + "zls-x86_64-windows.zip"
	}
	return ""
}

func getMarksmanDownloadURL() string {
	base := "https://github.com/artempyanykh/marksman/releases/latest/download/"
	switch runtime.GOOS {
	case "darwin":
		if runtime.GOARCH == "arm64" {
			return base + "marksman-macos-arm64"
		}
		return base + "marksman-macos"
	case "linux":
		return base + "marksman-linux-x64"
	case "windows":
		return base + "marksman-windows.exe"
	}
	return ""
}

func getLuaLSDownloadURL() string {
	base := "https://github.com/LuaLS/lua-language-server/releases/latest/download/"
	switch runtime.GOOS {
	case "darwin":
		if runtime.GOARCH == "arm64" {
			return base + "lua-language-server-darwin-arm64.tar.gz"
		}
		return base + "lua-language-server-darwin-x64.tar.gz"
	case "linux":
		return base + "lua-language-server-linux-x64.tar.gz"
	case "windows":
		return base + "lua-language-server-win32-x64.zip"
	}
	return ""
}

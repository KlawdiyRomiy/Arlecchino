package lsp

import (
	"log"
	"os"
	"path/filepath"
	"strings"

	lspregistry "arlecchino/internal/lsp"
)

func findExecutable(rootPath, name string) string {
	return lspregistry.FindBinaryPath(rootPath, "", "", name)
}

func findServerExecutable(rootPath, language, binaryName string) string {
	serverID := ""
	if info := lspregistry.GetLanguageByID(language); info != nil {
		serverID = info.LSPServerID
	}
	return lspregistry.FindServerBinaryPath(rootPath, "", serverID, binaryName)
}

var serverArgsByID = map[string][]string{
	"typescript-language-server":  {"--stdio"},
	"pyright":                     {"--stdio"},
	"phpactor":                    {"language-server"},
	"solargraph":                  {"stdio"},
	"vue-language-server":         {"--stdio"},
	"svelte-language-server":      {"--stdio"},
	"astro-ls":                    {"--stdio"},
	"vscode-css-language-server":  {"--stdio"},
	"vscode-html-language-server": {"--stdio"},
	"vscode-json-language-server": {"--stdio"},
	"yaml-language-server":        {"--stdio"},
	"bash-language-server":        {"start"},
	"dockerfile-language-server":  {"--stdio"},
	"sql-language-server":         {"up", "--method", "stdio"},
	"marksman":                    {"server"},
	"taplo":                       {"lsp", "stdio"},
	"graphql-lsp":                 {"server", "-m", "stream"},
	"terraform-ls":                {"serve"},
	"dart-lsp":                    {"language-server", "--protocol=lsp"},
	"omnisharp":                   {"-lsp"},
	"haskell-language-server":     {"--lsp"},
	"julia-lsp":                   {"--startup-file=no", "-e", "using LanguageServer; runserver()"},
	"r-languageserver":            {"--slave", "-e", "languageserver::run()"},
	"clojure-lsp":                 {"--stdio"},
	"erlang-ls":                   {"--transport", "stdio"},
	"erlang_ls":                   {"--transport", "stdio"},
	"groovy-language-server":      {"--stdio"},
	"perlnavigator":               {"--stdio"},
	"bufls":                       {"serve"},
	"cmake-language-server":       {"--stdio"},
	"texlab":                      {"--stdio"},
	"solidity-ls":                 {"--stdio"},
	"wgsl-analyzer":               {"--stdio"},
	"glsl-analyzer":               {"--stdio"},
	"powershell-editor-services":  {"-NoLogo", "-NoProfile", "-Command", "Import-Module PowerShellEditorServices; Start-EditorServices -Stdio -HostName Arlecchino -HostProfileId Arlecchino -HostVersion 1.0.0"},
}

func argsForServer(serverID string) []string {
	if args, ok := serverArgsByID[serverID]; ok {
		return args
	}
	return nil
}

func NormalizeServerConfig(cfg ServerConfig) ServerConfig {
	cfg.Language = lspregistry.NormalizeLanguageToken(cfg.Language)
	serverID := ""
	if info := lspregistry.GetLanguageByID(cfg.Language); info != nil {
		serverID = info.LSPServerID
	}
	if strings.TrimSpace(cfg.ServerGroup) == "" {
		cfg.ServerGroup = serverGroupForServer(cfg.Language, serverID, cfg.Command)
	}
	return cfg
}

func serverGroupForServer(language string, serverID string, command string) string {
	serverID = strings.ToLower(strings.TrimSpace(serverID))
	command = strings.ToLower(filepath.Base(strings.TrimSpace(command)))
	language = lspregistry.NormalizeLanguageToken(language)
	switch {
	case serverID == "typescript-language-server" || command == "typescript-language-server":
		return "tsserver"
	case serverID == "clangd" || command == "clangd":
		return "clangd"
	case serverID == "vscode-css-language-server" || command == "vscode-css-language-server":
		return "vscode-css"
	case serverID == "vscode-html-language-server" || command == "vscode-html-language-server":
		return "vscode-html"
	default:
		return ""
	}
}

func initParamsForServer(rootPath, serverID string) map[string]any {
	switch serverID {
	case "astro-ls":
		if tsdk := findTypeScriptSDK(rootPath); tsdk != "" {
			return map[string]any{
				"typescript": map[string]any{
					"tsdk": tsdk,
				},
			}
		}
	}
	return nil
}

func findTypeScriptSDK(rootPath string) string {
	var candidates []string
	add := func(parts ...string) {
		candidates = append(candidates, filepath.Join(parts...))
	}

	if rootPath != "" {
		add(rootPath, "node_modules", "typescript", "lib")
		add(rootPath, "frontend", "node_modules", "typescript", "lib")
	}
	if cwd, err := os.Getwd(); err == nil && cwd != "" {
		add(cwd, "node_modules", "typescript", "lib")
		add(cwd, "frontend", "node_modules", "typescript", "lib")
	}
	if npmPrefix := os.Getenv("NPM_CONFIG_PREFIX"); npmPrefix != "" {
		add(npmPrefix, "lib", "node_modules", "typescript", "lib")
		add(npmPrefix, "lib", "node_modules", "@astrojs", "language-server", "node_modules", "typescript", "lib")
	}
	add("/opt/homebrew", "lib", "node_modules", "typescript", "lib")
	add("/opt/homebrew", "lib", "node_modules", "@astrojs", "language-server", "node_modules", "typescript", "lib")
	add("/usr/local", "lib", "node_modules", "typescript", "lib")
	add("/usr/local", "lib", "node_modules", "@astrojs", "language-server", "node_modules", "typescript", "lib")

	for _, candidate := range uniqueConfigStrings(candidates) {
		if fileExists(filepath.Join(candidate, "typescript.js")) ||
			fileExists(filepath.Join(candidate, "tsserverlibrary.js")) {
			return candidate
		}
	}
	return ""
}

func uniqueConfigStrings(values []string) []string {
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

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func DefaultConfigs(rootPath string) []ServerConfig {
	rootURI := "file://" + rootPath

	// InitializationOptions for specific LSP servers
	goplsInit := map[string]any{
		"settings": map[string]any{
			"completeUnimported":             true, // Enable auto-import completions
			"usePlaceholders":                true, // Use placeholders in completions
			"completionDocumentation":        true, // Include documentation
			"deepCompletion":                 true, // Enable deep completions
			"experimentalPostfixCompletions": true,
		},
	}

	phpactorInit := map[string]any{
		"completion": map[string]any{
			"dedupe_match_strict": true,
			"limit":               50,
		},
		"indexer": map[string]any{
			"enabled_watchers": []string{"inotify", "watchman", "find"},
		},
	}

	pyrightInit := map[string]any{
		"python": map[string]any{
			"analysis": map[string]any{
				"autoSearchPaths":        true,
				"useLibraryCodeForTypes": true,
			},
		},
	}

	allConfigs := []struct {
		lang        string
		cmd         string
		args        []string
		finder      func() string
		initParams  map[string]any
		serverGroup string // Languages sharing same server process
	}{
		{"go", "gopls", []string{}, nil, goplsInit, ""},
		{"typescript", "typescript-language-server", []string{"--stdio"}, nil, nil, "tsserver"},
		{"javascript", "typescript-language-server", []string{"--stdio"}, nil, nil, "tsserver"},
		{"typescriptreact", "typescript-language-server", []string{"--stdio"}, nil, nil, "tsserver"},
		{"javascriptreact", "typescript-language-server", []string{"--stdio"}, nil, nil, "tsserver"},
		{"astro", "astro-ls", []string{"--stdio"}, nil, initParamsForServer(rootPath, "astro-ls"), ""},
		{"python", "pyright-langserver", []string{"--stdio"}, nil, pyrightInit, ""},
		{"php", "phpactor", []string{"language-server"}, nil, phpactorInit, ""},
		{"blade", "vscode-html-language-server", []string{"--stdio"}, nil, nil, "vscode-html"},
		{"ruby", "solargraph", []string{"stdio"}, nil, nil, ""},
		{"vue", "vue-language-server", []string{"--stdio"}, nil, nil, ""},
		{"svelte", "svelteserver", []string{"--stdio"}, nil, nil, ""},
		{"rust", "rust-analyzer", []string{}, nil, nil, ""},
		{"c", "clangd", []string{}, nil, nil, "clangd"},
		{"cpp", "clangd", []string{}, nil, nil, "clangd"},
		{"objectivec", "clangd", []string{}, nil, nil, "clangd"},
		{"css", "vscode-css-language-server", []string{"--stdio"}, nil, nil, "vscode-css"},
		{"scss", "vscode-css-language-server", []string{"--stdio"}, nil, nil, "vscode-css"},
		{"less", "vscode-css-language-server", []string{"--stdio"}, nil, nil, "vscode-css"},
		{"sass", "vscode-css-language-server", []string{"--stdio"}, nil, nil, "vscode-css"},
		{"html", "vscode-html-language-server", []string{"--stdio"}, nil, nil, "vscode-html"},
		{"json", "vscode-json-language-server", []string{"--stdio"}, nil, nil, ""},
		{"yaml", "yaml-language-server", []string{"--stdio"}, nil, nil, ""},
		{"kotlin", "kotlin-language-server", []string{}, nil, nil, ""},
		{"java", "jdtls", []string{}, nil, nil, ""},
		{"swift", "sourcekit-lsp", []string{}, nil, nil, ""},
		{"dart", "dart", []string{"language-server", "--protocol=lsp"}, nil, nil, ""},
		{"csharp", "omnisharp", []string{"-lsp"}, nil, nil, ""},
		{"lua", "lua-language-server", []string{}, nil, nil, ""},
		{"elixir", "elixir-ls", []string{}, nil, nil, ""},
		{"haskell", "haskell-language-server-wrapper", []string{"--lsp"}, nil, nil, ""},
		{"ocaml", "ocamllsp", []string{}, nil, nil, ""},
		{"scala", "metals", []string{}, nil, nil, ""},
		{"julia", "julia", []string{"--startup-file=no", "-e", "using LanguageServer; runserver()"}, nil, nil, ""},
		{"r", "r", []string{"--slave", "-e", "languageserver::run()"}, nil, nil, ""},
		{"dockerfile", "docker-langserver", []string{"--stdio"}, nil, nil, ""},
		{"bash", "bash-language-server", []string{"start"}, nil, nil, ""},
		{"sql", "sql-language-server", []string{"up", "--method", "stdio"}, nil, nil, ""},
		{"markdown", "marksman", []string{"server"}, nil, nil, ""},
		{"xml", "lemminx", []string{}, nil, nil, ""},
		{"toml", "taplo", []string{"lsp", "stdio"}, nil, nil, ""},
		{"graphql", "graphql-lsp", []string{"server", "-m", "stream"}, nil, nil, ""},
		{"terraform", "terraform-ls", []string{"serve"}, nil, nil, ""},
		{"zig", "zls", []string{}, nil, nil, ""},
		{"clojure", "clojure-lsp", []string{"--stdio"}, nil, nil, ""},
		{"erlang", "erlang_ls", []string{"--transport", "stdio"}, nil, nil, ""},
		{"groovy", "groovy-language-server", []string{"--stdio"}, nil, nil, ""},
		{"perl", "perlnavigator", []string{"--stdio"}, nil, nil, ""},
		{"protobuf", "bufls", []string{"serve"}, nil, nil, ""},
		{"cmake", "cmake-language-server", []string{"--stdio"}, nil, nil, ""},
		{"latex", "texlab", []string{"--stdio"}, nil, nil, ""},
		{"solidity", "nomicfoundation-solidity-language-server", []string{"--stdio"}, nil, nil, ""},
		{"wgsl", "wgsl-analyzer", []string{"--stdio"}, nil, nil, ""},
		{"glsl", "glsl-analyzer", []string{"--stdio"}, nil, nil, ""},
		{"powershell", "pwsh", serverArgsByID["powershell-editor-services"], nil, nil, ""},
	}

	var configs []ServerConfig
	var found, notFound []string

	for _, c := range allConfigs {
		var cmd string
		if c.finder != nil {
			cmd = c.finder()
		} else {
			cmd = findServerExecutable(rootPath, c.lang, c.cmd)
		}

		if cmd == "" {
			notFound = append(notFound, c.lang+"("+c.cmd+")")
			continue
		}

		found = append(found, c.lang)
		configs = append(configs, ServerConfig{
			Language:    c.lang,
			Command:     cmd,
			Args:        c.args,
			RootURI:     rootURI,
			InitParams:  c.initParams,
			ServerGroup: c.serverGroup,
		})
	}

	log.Printf("[LSP-CONFIG] Found LSP servers: %v", found)
	if len(notFound) > 0 {
		log.Printf("[LSP-CONFIG] NOT found: %v", notFound)
	}

	return configs
}

func ConfigsFromInstaller(rootPath string, installer *lspregistry.Installer) []ServerConfig {
	return ConfigsFromInstallerWithWorkDirs(rootPath, nil, installer)
}

func ConfigsFromInstallerWithWorkDirs(rootPath string, workDirs []string, installer *lspregistry.Installer) []ServerConfig {
	if installer == nil {
		return nil
	}

	rootURI := "file://" + rootPath
	languages := lspregistry.GetAllLanguages()
	configs := make([]ServerConfig, 0, len(languages))
	roots := append([]string{rootPath}, workDirs...)

	for _, lang := range languages {
		if lang == nil || lang.LSPServerID == "" {
			continue
		}
		cmd := installer.GetBinaryPathForRoots(lang.LSPServerID, roots)
		if cmd == "" {
			continue
		}
		configs = append(configs, NormalizeServerConfig(ServerConfig{
			Language: lang.ID,
			Command:  cmd,
			Args:     argsForServer(lang.LSPServerID),
			RootURI:  rootURI,
			InitParams: initParamsForServer(
				rootPath,
				lang.LSPServerID,
			),
		}))
	}

	if len(configs) > 0 {
		log.Printf("[LSP-CONFIG] Installer configs: %d", len(configs))
	}
	return configs
}

func MergeConfigs(base, extra []ServerConfig) []ServerConfig {
	if len(extra) == 0 {
		return base
	}

	byLang := make(map[string]ServerConfig, len(base)+len(extra))
	for _, cfg := range base {
		cfg = NormalizeServerConfig(cfg)
		byLang[cfg.Language] = cfg
	}
	for _, cfg := range extra {
		cfg = NormalizeServerConfig(cfg)
		byLang[cfg.Language] = cfg
	}

	merged := make([]ServerConfig, 0, len(byLang))
	seen := make(map[string]bool, len(byLang))
	for _, cfg := range base {
		if mergedCfg, ok := byLang[cfg.Language]; ok {
			merged = append(merged, mergedCfg)
			seen[cfg.Language] = true
		}
	}
	for _, cfg := range extra {
		normalized := NormalizeServerConfig(cfg)
		if !seen[normalized.Language] {
			merged = append(merged, normalized)
			seen[normalized.Language] = true
		}
	}

	return merged
}

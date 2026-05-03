package lsp

import (
	"log"

	lspregistry "arlecchino/internal/lsp"
)

func findExecutable(rootPath, name string) string {
	return lspregistry.FindBinaryPath(rootPath, "", "", name)
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
	"bufls":                       {"--stdio"},
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
		{"astro", "astro-ls", []string{"--stdio"}, nil, nil, ""},
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
		{"protobuf", "bufls", []string{"--stdio"}, nil, nil, ""},
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
			cmd = findExecutable(rootPath, c.cmd)
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
	if installer == nil {
		return nil
	}

	rootURI := "file://" + rootPath
	languages := lspregistry.GetAllLanguages()
	configs := make([]ServerConfig, 0, len(languages))

	for _, lang := range languages {
		if lang == nil || lang.LSPServerID == "" {
			continue
		}
		cmd := installer.GetBinaryPathForRoot(lang.LSPServerID, rootPath)
		if cmd == "" {
			continue
		}
		configs = append(configs, ServerConfig{
			Language: lang.ID,
			Command:  cmd,
			Args:     argsForServer(lang.LSPServerID),
			RootURI:  rootURI,
		})
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
		byLang[cfg.Language] = cfg
	}
	for _, cfg := range extra {
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
		if !seen[cfg.Language] {
			merged = append(merged, cfg)
			seen[cfg.Language] = true
		}
	}

	return merged
}

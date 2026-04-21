package execution

import (
	"encoding/json"
	"fmt"
	"os"
	osExec "os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"arlecchino/internal/plugins"
)

type Service struct {
	plugins  *plugins.Registry
	readFile func(string) ([]byte, error)
	lookPath func(string) (string, error)
	stat     func(string) (os.FileInfo, error)
}

func NewService(pluginRegistry *plugins.Registry) *Service {
	return &Service{
		plugins:  pluginRegistry,
		readFile: os.ReadFile,
		lookPath: osExec.LookPath,
		stat:     os.Stat,
	}
}

func (s *Service) ResolveProfiles(req ResolveRequest) ProfileSet {
	ctx := s.normalizeRequest(req)
	framework := s.detectFramework(ctx.ProjectPath)

	runProfiles := make([]Profile, 0, 12)
	debugProfiles := make([]Profile, 0, 12)

	runProfiles, debugProfiles = s.appendProfileSet(runProfiles, debugProfiles, s.fromArlecchinoConfig(ctx, framework))
	runProfiles, debugProfiles = s.appendProfileSet(runProfiles, debugProfiles, s.fromVSCodeLaunch(ctx, framework))
	runProfiles, debugProfiles = s.appendProfileSet(runProfiles, debugProfiles, s.fromFrameworkProfiles(ctx, framework))
	runProfiles, debugProfiles = s.appendProfileSet(runProfiles, debugProfiles, s.fromProjectAndFile(ctx, framework))

	return ProfileSet{
		RunProfiles:   s.dedupeAndFinalize(runProfiles, ctx, framework),
		DebugProfiles: s.dedupeAndFinalize(debugProfiles, ctx, framework),
	}
}

func (s *Service) appendProfileSet(runProfiles []Profile, debugProfiles []Profile, set ProfileSet) ([]Profile, []Profile) {
	runProfiles = append(runProfiles, set.RunProfiles...)
	debugProfiles = append(debugProfiles, set.DebugProfiles...)
	return runProfiles, debugProfiles
}

func (s *Service) dedupeAndFinalize(profiles []Profile, ctx ResolveRequest, framework string) []Profile {
	if len(profiles) == 0 {
		return []Profile{}
	}

	seen := make(map[string]struct{}, len(profiles))
	unique := make([]Profile, 0, len(profiles))

	for _, profile := range profiles {
		normalized := s.normalizeProfile(profile, ctx, framework)
		if normalized.ID == "" || normalized.Command == "" && normalized.Kind != ProfileKindPreview {
			continue
		}

		key := s.profileDedupeKey(normalized)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		unique = append(unique, normalized)
	}

	sort.SliceStable(unique, func(i, j int) bool {
		if unique[i].Confidence == unique[j].Confidence {
			if unique[i].Origin == unique[j].Origin {
				return unique[i].Label < unique[j].Label
			}
			return s.originWeight(unique[i].Origin) > s.originWeight(unique[j].Origin)
		}
		return unique[i].Confidence > unique[j].Confidence
	})

	return unique
}

func (s *Service) profileDedupeKey(profile Profile) string {
	return strings.Join([]string{
		string(profile.Mode),
		string(profile.Kind),
		strings.TrimSpace(profile.Command),
		normalizePath(profile.WorkingDirectory),
		strings.TrimSpace(profile.Label),
	}, "|")
}

func (s *Service) normalizeProfile(profile Profile, ctx ResolveRequest, framework string) Profile {
	mode := strings.TrimSpace(string(profile.Mode))
	if mode == "" {
		profile.Mode = ProfileModeRun
	}

	if profile.Kind == "" {
		profile.Kind = ProfileKindTerminal
	}

	profile.Command = strings.TrimSpace(profile.Command)

	if profile.Label == "" {
		profile.Label = fallbackProfileLabel(profile)
	}

	if profile.Description == "" {
		profile.Description = fallbackProfileDescription(profile)
	}

	if profile.WorkingDirectory == "" {
		profile.WorkingDirectory = defaultWorkingDirectory(ctx)
	}

	profile.WorkingDirectory = normalizePath(profile.WorkingDirectory)

	if profile.Framework == "" {
		profile.Framework = framework
	}

	if profile.Origin == "" {
		profile.Origin = ProfileOriginAuto
	}

	if profile.Confidence <= 0 {
		profile.Confidence = 0.5
	}

	profile.RequiredTools = uniqueStrings(profile.RequiredTools)
	if len(profile.RequiredTools) == 0 {
		if tool := firstCommandToken(profile.Command); tool != "" {
			profile.RequiredTools = []string{tool}
		}
	}

	profile.MissingTools = s.computeMissingTools(profile.RequiredTools)

	if profile.ID == "" {
		profile.ID = profileID(profile)
	}

	if profile.Env == nil {
		profile.Env = map[string]string{}
	}

	return profile
}

func (s *Service) computeMissingTools(required []string) []string {
	if len(required) == 0 {
		return nil
	}

	missing := make([]string, 0, len(required))
	for _, tool := range required {
		trimmed := strings.TrimSpace(tool)
		if trimmed == "" {
			continue
		}
		if s.lookPath == nil {
			continue
		}
		if _, err := s.lookPath(trimmed); err != nil {
			missing = append(missing, trimmed)
		}
	}

	return uniqueStrings(missing)
}

func (s *Service) originWeight(origin ProfileOrigin) int {
	switch origin {
	case ProfileOriginUser:
		return 4
	case ProfileOriginImported:
		return 3
	case ProfileOriginPlugin:
		return 2
	default:
		return 1
	}
}

func (s *Service) normalizeRequest(req ResolveRequest) ResolveRequest {
	projectPath := normalizePath(strings.TrimSpace(req.ProjectPath))
	activeFilePath := normalizePath(strings.TrimSpace(req.ActiveFilePath))
	activeFileName := strings.TrimSpace(req.ActiveFileName)
	activeFileContent := req.ActiveFileContent
	activeFileLanguage := strings.TrimSpace(strings.ToLower(req.ActiveFileLanguage))

	if activeFileName == "" && activeFilePath != "" {
		activeFileName = filepath.Base(activeFilePath)
	}

	return ResolveRequest{
		ProjectPath:        projectPath,
		ActiveFilePath:     activeFilePath,
		ActiveFileName:     activeFileName,
		ActiveFileContent:  activeFileContent,
		ActiveFileLanguage: activeFileLanguage,
	}
}

func (s *Service) detectFramework(projectPath string) string {
	if s.plugins == nil || projectPath == "" {
		return ""
	}
	return strings.TrimSpace(s.plugins.DetectFramework(projectPath))
}

func (s *Service) fromArlecchinoConfig(ctx ResolveRequest, framework string) ProfileSet {
	if ctx.ProjectPath == "" || s.readFile == nil {
		return ProfileSet{}
	}

	configPath := filepath.Join(ctx.ProjectPath, ".arlecchino", "execution.json")
	data, err := s.readFile(configPath)
	if err != nil || len(data) == 0 {
		return ProfileSet{}
	}

	type configFile struct {
		Profiles      []Profile `json:"profiles"`
		RunProfiles   []Profile `json:"runProfiles"`
		DebugProfiles []Profile `json:"debugProfiles"`
	}

	parsed := configFile{}
	if err := json.Unmarshal(data, &parsed); err != nil {
		return ProfileSet{}
	}

	runProfiles := make([]Profile, 0, len(parsed.Profiles)+len(parsed.RunProfiles))
	debugProfiles := make([]Profile, 0, len(parsed.Profiles)+len(parsed.DebugProfiles))

	for _, profile := range parsed.Profiles {
		mode := strings.TrimSpace(string(profile.Mode))
		switch mode {
		case string(ProfileModeDebug):
			debugProfiles = append(debugProfiles, withProfileDefaults(profile, ProfileModeDebug, ProfileOriginUser, framework, 1.0))
		default:
			runProfiles = append(runProfiles, withProfileDefaults(profile, ProfileModeRun, ProfileOriginUser, framework, 1.0))
		}
	}

	for _, profile := range parsed.RunProfiles {
		runProfiles = append(runProfiles, withProfileDefaults(profile, ProfileModeRun, ProfileOriginUser, framework, 1.0))
	}

	for _, profile := range parsed.DebugProfiles {
		debugProfiles = append(debugProfiles, withProfileDefaults(profile, ProfileModeDebug, ProfileOriginUser, framework, 1.0))
	}

	return ProfileSet{RunProfiles: runProfiles, DebugProfiles: debugProfiles}
}

func (s *Service) fromVSCodeLaunch(ctx ResolveRequest, framework string) ProfileSet {
	if ctx.ProjectPath == "" || s.readFile == nil {
		return ProfileSet{}
	}

	launchPath := filepath.Join(ctx.ProjectPath, ".vscode", "launch.json")
	data, err := s.readFile(launchPath)
	if err != nil || len(data) == 0 {
		return ProfileSet{}
	}

	type launchConfiguration struct {
		Name    string                 `json:"name"`
		Type    string                 `json:"type"`
		Request string                 `json:"request"`
		Program string                 `json:"program"`
		Cwd     string                 `json:"cwd"`
		Args    []string               `json:"args"`
		Env     map[string]interface{} `json:"env"`
	}

	type launchFile struct {
		Configurations []launchConfiguration `json:"configurations"`
	}

	parsed := launchFile{}
	if err := json.Unmarshal(data, &parsed); err != nil {
		return ProfileSet{}
	}

	debugProfiles := make([]Profile, 0, len(parsed.Configurations))
	for _, cfg := range parsed.Configurations {
		profile := s.profileFromLaunchConfiguration(ctx, framework, cfg)
		if profile.ID == "" {
			continue
		}
		debugProfiles = append(debugProfiles, profile)
	}

	return ProfileSet{DebugProfiles: debugProfiles}
}

func (s *Service) profileFromLaunchConfiguration(ctx ResolveRequest, framework string, cfg struct {
	Name    string                 `json:"name"`
	Type    string                 `json:"type"`
	Request string                 `json:"request"`
	Program string                 `json:"program"`
	Cwd     string                 `json:"cwd"`
	Args    []string               `json:"args"`
	Env     map[string]interface{} `json:"env"`
}) Profile {
	requestType := strings.ToLower(strings.TrimSpace(cfg.Request))
	if requestType != "" && requestType != "launch" && requestType != "attach" {
		return Profile{}
	}

	resolvedProgram := s.resolveVariables(ctx, cfg.Program)
	if resolvedProgram == "" {
		resolvedProgram = ctx.ActiveFilePath
	}

	resolvedCWD := s.resolveVariables(ctx, cfg.Cwd)
	if resolvedCWD == "" {
		resolvedCWD = defaultWorkingDirectory(ctx)
	}

	resolvedArgs := make([]string, 0, len(cfg.Args))
	for _, arg := range cfg.Args {
		resolvedArgs = append(resolvedArgs, s.resolveVariables(ctx, arg))
	}

	mode := ProfileModeDebug
	command, requiredTools := launchCommandForType(strings.ToLower(strings.TrimSpace(cfg.Type)), resolvedProgram, resolvedArgs)
	if command == "" {
		return Profile{}
	}

	label := strings.TrimSpace(cfg.Name)
	if label == "" {
		label = fmt.Sprintf("Debug (%s)", strings.TrimSpace(cfg.Type))
	}

	env := mapStringInterfaceToString(cfg.Env)

	return Profile{
		ID:               fmt.Sprintf("vscode:%s:%s", strings.ToLower(strings.TrimSpace(cfg.Type)), sanitizeID(label)),
		Label:            label,
		Description:      "Imported from .vscode/launch.json",
		Kind:             ProfileKindTerminal,
		Mode:             mode,
		Command:          command,
		WorkingDirectory: resolvedCWD,
		Framework:        framework,
		Origin:           ProfileOriginImported,
		Confidence:       0.92,
		RequiredTools:    requiredTools,
		Env:              env,
	}
}

func (s *Service) resolveVariables(ctx ResolveRequest, input string) string {
	trimmed := strings.TrimSpace(input)
	if trimmed == "" {
		return ""
	}

	workspace := ctx.ProjectPath
	filePath := ctx.ActiveFilePath
	fileName := ctx.ActiveFileName
	fileDir := ""
	if filePath != "" {
		fileDir = filepath.Dir(filePath)
	}

	relativeFile := ""
	if workspace != "" && filePath != "" {
		if rel, err := filepath.Rel(workspace, filePath); err == nil {
			relativeFile = normalizePath(rel)
		}
	}

	replacer := strings.NewReplacer(
		"${workspaceFolder}", workspace,
		"${file}", filePath,
		"${fileBasename}", fileName,
		"${fileDirname}", fileDir,
		"${relativeFile}", relativeFile,
	)

	return strings.TrimSpace(replacer.Replace(trimmed))
}

func (s *Service) fromFrameworkProfiles(ctx ResolveRequest, framework string) ProfileSet {
	if ctx.ProjectPath == "" {
		return ProfileSet{}
	}

	framework = strings.ToLower(strings.TrimSpace(framework))
	switch framework {
	case "laravel":
		if !s.fileExists(filepath.Join(ctx.ProjectPath, "artisan")) {
			return ProfileSet{}
		}
		return ProfileSet{
			RunProfiles: []Profile{withProfileDefaults(Profile{
				ID:               "laravel:serve",
				Label:            "Laravel Serve",
				Description:      "Serve Laravel application",
				Kind:             ProfileKindTerminal,
				Command:          "php artisan serve",
				WorkingDirectory: ctx.ProjectPath,
				RequiredTools:    []string{"php"},
			}, ProfileModeRun, ProfileOriginPlugin, framework, 0.94)},
			DebugProfiles: []Profile{withProfileDefaults(Profile{
				ID:               "laravel:debug:serve",
				Label:            "Laravel Debug Serve",
				Description:      "Serve Laravel with Xdebug enabled",
				Kind:             ProfileKindTerminal,
				Command:          "XDEBUG_MODE=debug php artisan serve",
				WorkingDirectory: ctx.ProjectPath,
				RequiredTools:    []string{"php"},
			}, ProfileModeDebug, ProfileOriginPlugin, framework, 0.9)},
		}
	case "django":
		if !s.fileExists(filepath.Join(ctx.ProjectPath, "manage.py")) {
			return ProfileSet{}
		}
		return ProfileSet{
			RunProfiles: []Profile{withProfileDefaults(Profile{
				ID:               "django:runserver",
				Label:            "Django Runserver",
				Description:      "Run Django development server",
				Kind:             ProfileKindTerminal,
				Command:          "python manage.py runserver",
				WorkingDirectory: ctx.ProjectPath,
				RequiredTools:    []string{"python"},
			}, ProfileModeRun, ProfileOriginPlugin, framework, 0.94)},
			DebugProfiles: []Profile{withProfileDefaults(Profile{
				ID:               "django:debug:runserver",
				Label:            "Django Debug Runserver",
				Description:      "Run Django server with debugpy",
				Kind:             ProfileKindTerminal,
				Command:          "python -m debugpy --listen 5678 --wait-for-client manage.py runserver",
				WorkingDirectory: ctx.ProjectPath,
				RequiredTools:    []string{"python"},
			}, ProfileModeDebug, ProfileOriginPlugin, framework, 0.9)},
		}
	case "rails":
		railsBinary := filepath.Join("bin", "rails")
		if !s.fileExists(filepath.Join(ctx.ProjectPath, railsBinary)) {
			return ProfileSet{}
		}
		return ProfileSet{
			RunProfiles: []Profile{withProfileDefaults(Profile{
				ID:               "rails:server",
				Label:            "Rails Server",
				Description:      "Run Rails development server",
				Kind:             ProfileKindTerminal,
				Command:          "bin/rails server",
				WorkingDirectory: ctx.ProjectPath,
				RequiredTools:    []string{"ruby"},
			}, ProfileModeRun, ProfileOriginPlugin, framework, 0.94)},
			DebugProfiles: []Profile{withProfileDefaults(Profile{
				ID:               "rails:debug:server",
				Label:            "Rails Debug Server",
				Description:      "Run Rails server under Ruby debugger",
				Kind:             ProfileKindTerminal,
				Command:          "rdbg -c -- bin/rails server",
				WorkingDirectory: ctx.ProjectPath,
				RequiredTools:    []string{"rdbg"},
			}, ProfileModeDebug, ProfileOriginPlugin, framework, 0.9)},
		}
	default:
		return ProfileSet{}
	}
}

func (s *Service) fromProjectAndFile(ctx ResolveRequest, framework string) ProfileSet {
	if profileSet := s.fromActiveFile(ctx, framework); len(profileSet.RunProfiles)+len(profileSet.DebugProfiles) > 0 {
		return profileSet
	}

	return s.fromProjectContext(ctx, framework)
}

func (s *Service) fromActiveFile(ctx ResolveRequest, framework string) ProfileSet {
	if ctx.ActiveFilePath == "" {
		return ProfileSet{}
	}

	filePath := normalizePath(ctx.ActiveFilePath)
	fileName := ctx.ActiveFileName
	if fileName == "" {
		fileName = filepath.Base(filePath)
	}

	workingDirectory := filepath.Dir(filePath)

	if isHTMLFile(filePath) {
		return ProfileSet{
			RunProfiles: []Profile{withProfileDefaults(Profile{
				ID:               fmt.Sprintf("preview:%s", sanitizeID(filePath)),
				Label:            fmt.Sprintf("Preview %s", fileName),
				Description:      "Open the current file in browser preview",
				Kind:             ProfileKindPreview,
				Command:          "",
				WorkingDirectory: defaultWorkingDirectory(ctx),
				Language:         "html",
			}, ProfileModeRun, ProfileOriginAuto, framework, 0.98)},
		}
	}

	content := ctx.ActiveFileContent
	if content == "" && s.readFile != nil {
		if data, err := s.readFile(filePath); err == nil {
			content = string(data)
		}
	}

	if isGoMainFile(filePath, content) {
		goRunCommand := fmt.Sprintf("go run %s", shellQuote(filePath))
		dlvCommand := fmt.Sprintf("dlv debug %s", shellQuote(workingDirectory))
		return ProfileSet{
			RunProfiles: []Profile{withProfileDefaults(Profile{
				ID:               fmt.Sprintf("go:run:%s", sanitizeID(filePath)),
				Label:            fmt.Sprintf("Run %s", fileName),
				Description:      "Run the current Go entrypoint",
				Kind:             ProfileKindTerminal,
				Command:          goRunCommand,
				WorkingDirectory: workingDirectory,
				Language:         "go",
				RequiredTools:    []string{"go"},
			}, ProfileModeRun, ProfileOriginAuto, framework, 0.99)},
			DebugProfiles: []Profile{withProfileDefaults(Profile{
				ID:               fmt.Sprintf("go:debug:%s", sanitizeID(workingDirectory)),
				Label:            fmt.Sprintf("Debug %s", fileName),
				Description:      "Start Delve for the current Go entrypoint",
				Kind:             ProfileKindTerminal,
				Command:          dlvCommand,
				WorkingDirectory: workingDirectory,
				Language:         "go",
				RequiredTools:    []string{"dlv"},
			}, ProfileModeDebug, ProfileOriginAuto, framework, 0.94)},
		}
	}

	language := strings.ToLower(strings.TrimSpace(ctx.ActiveFileLanguage))
	ext := strings.ToLower(filepath.Ext(filePath))
	if language == "" {
		language = strings.TrimPrefix(ext, ".")
	}

	switch {
	case ext == ".py" || language == "python":
		return ProfileSet{
			RunProfiles: []Profile{withProfileDefaults(Profile{
				ID:               fmt.Sprintf("python:run:%s", sanitizeID(filePath)),
				Label:            fmt.Sprintf("Run %s", fileName),
				Description:      "Run the current Python file",
				Kind:             ProfileKindTerminal,
				Command:          fmt.Sprintf("python %s", shellQuote(filePath)),
				WorkingDirectory: workingDirectory,
				Language:         "python",
				RequiredTools:    []string{"python"},
			}, ProfileModeRun, ProfileOriginAuto, framework, 0.86)},
			DebugProfiles: []Profile{withProfileDefaults(Profile{
				ID:               fmt.Sprintf("python:debug:%s", sanitizeID(filePath)),
				Label:            fmt.Sprintf("Debug %s", fileName),
				Description:      "Run the current Python file with debugpy",
				Kind:             ProfileKindTerminal,
				Command:          fmt.Sprintf("python -m debugpy --listen 5678 --wait-for-client %s", shellQuote(filePath)),
				WorkingDirectory: workingDirectory,
				Language:         "python",
				RequiredTools:    []string{"python"},
			}, ProfileModeDebug, ProfileOriginAuto, framework, 0.83)},
		}
	case ext == ".php" || language == "php":
		return ProfileSet{
			RunProfiles: []Profile{withProfileDefaults(Profile{
				ID:               fmt.Sprintf("php:run:%s", sanitizeID(filePath)),
				Label:            fmt.Sprintf("Run %s", fileName),
				Description:      "Run the current PHP file",
				Kind:             ProfileKindTerminal,
				Command:          fmt.Sprintf("php %s", shellQuote(filePath)),
				WorkingDirectory: workingDirectory,
				Language:         "php",
				RequiredTools:    []string{"php"},
			}, ProfileModeRun, ProfileOriginAuto, framework, 0.84)},
			DebugProfiles: []Profile{withProfileDefaults(Profile{
				ID:               fmt.Sprintf("php:debug:%s", sanitizeID(filePath)),
				Label:            fmt.Sprintf("Debug %s", fileName),
				Description:      "Run the current PHP file with Xdebug",
				Kind:             ProfileKindTerminal,
				Command:          fmt.Sprintf("php -d xdebug.mode=debug %s", shellQuote(filePath)),
				WorkingDirectory: workingDirectory,
				Language:         "php",
				RequiredTools:    []string{"php"},
			}, ProfileModeDebug, ProfileOriginAuto, framework, 0.8)},
		}
	case ext == ".js" || ext == ".mjs" || ext == ".cjs" || language == "javascript":
		return ProfileSet{
			RunProfiles: []Profile{withProfileDefaults(Profile{
				ID:               fmt.Sprintf("node:run:%s", sanitizeID(filePath)),
				Label:            fmt.Sprintf("Run %s", fileName),
				Description:      "Run the current JavaScript file",
				Kind:             ProfileKindTerminal,
				Command:          fmt.Sprintf("node %s", shellQuote(filePath)),
				WorkingDirectory: workingDirectory,
				Language:         "javascript",
				RequiredTools:    []string{"node"},
			}, ProfileModeRun, ProfileOriginAuto, framework, 0.84)},
			DebugProfiles: []Profile{withProfileDefaults(Profile{
				ID:               fmt.Sprintf("node:debug:%s", sanitizeID(filePath)),
				Label:            fmt.Sprintf("Debug %s", fileName),
				Description:      "Run the current JavaScript file with inspector",
				Kind:             ProfileKindTerminal,
				Command:          fmt.Sprintf("node --inspect %s", shellQuote(filePath)),
				WorkingDirectory: workingDirectory,
				Language:         "javascript",
				RequiredTools:    []string{"node"},
			}, ProfileModeDebug, ProfileOriginAuto, framework, 0.8)},
		}
	default:
		return ProfileSet{}
	}
}

func (s *Service) fromProjectContext(ctx ResolveRequest, framework string) ProfileSet {
	if ctx.ProjectPath == "" {
		return ProfileSet{}
	}

	runProfiles := make([]Profile, 0, 4)
	debugProfiles := make([]Profile, 0, 4)

	if nodeProfiles := s.projectNodeProfiles(ctx.ProjectPath, framework); len(nodeProfiles.RunProfiles)+len(nodeProfiles.DebugProfiles) > 0 {
		runProfiles = append(runProfiles, nodeProfiles.RunProfiles...)
		debugProfiles = append(debugProfiles, nodeProfiles.DebugProfiles...)
	}

	if s.fileExists(filepath.Join(ctx.ProjectPath, "go.mod")) {
		runProfiles = append(runProfiles, withProfileDefaults(Profile{
			ID:               "go:run:project",
			Label:            "Run Go Project",
			Description:      "Run the current Go module",
			Kind:             ProfileKindTerminal,
			Command:          "go run .",
			WorkingDirectory: ctx.ProjectPath,
			Language:         "go",
			RequiredTools:    []string{"go"},
		}, ProfileModeRun, ProfileOriginAuto, framework, 0.78))

		debugProfiles = append(debugProfiles, withProfileDefaults(Profile{
			ID:               "go:debug:project",
			Label:            "Debug Go Project",
			Description:      "Debug the current Go module with Delve",
			Kind:             ProfileKindTerminal,
			Command:          "dlv debug .",
			WorkingDirectory: ctx.ProjectPath,
			Language:         "go",
			RequiredTools:    []string{"dlv"},
		}, ProfileModeDebug, ProfileOriginAuto, framework, 0.72))
	}

	if s.fileExists(filepath.Join(ctx.ProjectPath, "Cargo.toml")) {
		runProfiles = append(runProfiles, withProfileDefaults(Profile{
			ID:               "rust:run:project",
			Label:            "Run Rust Project",
			Description:      "Run project via cargo",
			Kind:             ProfileKindTerminal,
			Command:          "cargo run",
			WorkingDirectory: ctx.ProjectPath,
			Language:         "rust",
			RequiredTools:    []string{"cargo"},
		}, ProfileModeRun, ProfileOriginAuto, framework, 0.76))
	}

	return ProfileSet{RunProfiles: runProfiles, DebugProfiles: debugProfiles}
}

func (s *Service) projectNodeProfiles(projectPath string, framework string) ProfileSet {
	if projectPath == "" || s.readFile == nil {
		return ProfileSet{}
	}

	packageJSONPath := filepath.Join(projectPath, "package.json")
	data, err := s.readFile(packageJSONPath)
	if err != nil || len(data) == 0 {
		return ProfileSet{}
	}

	type nodePackage struct {
		Name    string            `json:"name"`
		Scripts map[string]string `json:"scripts"`
	}

	parsed := nodePackage{}
	if err := json.Unmarshal(data, &parsed); err != nil {
		return ProfileSet{}
	}

	if len(parsed.Scripts) == 0 {
		return ProfileSet{}
	}

	runProfiles := make([]Profile, 0, 3)
	debugProfiles := make([]Profile, 0, 2)

	for _, scriptName := range []string{"start", "dev", "serve"} {
		if _, ok := parsed.Scripts[scriptName]; !ok {
			continue
		}
		runProfiles = append(runProfiles, withProfileDefaults(Profile{
			ID:               fmt.Sprintf("node:%s", scriptName),
			Label:            fmt.Sprintf("npm run %s", scriptName),
			Description:      "Run project npm script",
			Kind:             ProfileKindTerminal,
			Command:          fmt.Sprintf("npm run %s", scriptName),
			WorkingDirectory: projectPath,
			Language:         "javascript",
			RequiredTools:    []string{"npm"},
		}, ProfileModeRun, ProfileOriginAuto, framework, 0.88))
	}

	if _, ok := parsed.Scripts["debug"]; ok {
		debugProfiles = append(debugProfiles, withProfileDefaults(Profile{
			ID:               "node:debug",
			Label:            "npm run debug",
			Description:      "Run project debug script",
			Kind:             ProfileKindTerminal,
			Command:          "npm run debug",
			WorkingDirectory: projectPath,
			Language:         "javascript",
			RequiredTools:    []string{"npm"},
		}, ProfileModeDebug, ProfileOriginAuto, framework, 0.84))
	}

	return ProfileSet{RunProfiles: runProfiles, DebugProfiles: debugProfiles}
}

func (s *Service) fileExists(path string) bool {
	if path == "" || s.stat == nil {
		return false
	}
	_, err := s.stat(path)
	return err == nil
}

func withProfileDefaults(profile Profile, mode ProfileMode, origin ProfileOrigin, framework string, confidence float64) Profile {
	profile.Mode = mode
	if profile.Origin == "" {
		profile.Origin = origin
	}
	if profile.Framework == "" {
		profile.Framework = framework
	}
	if profile.Confidence <= 0 {
		profile.Confidence = confidence
	}
	if profile.Kind == "" {
		profile.Kind = ProfileKindTerminal
	}
	return profile
}

func defaultWorkingDirectory(ctx ResolveRequest) string {
	if ctx.ProjectPath != "" {
		return normalizePath(ctx.ProjectPath)
	}
	if ctx.ActiveFilePath != "" {
		return normalizePath(filepath.Dir(ctx.ActiveFilePath))
	}
	return ""
}

func fallbackProfileLabel(profile Profile) string {
	if profile.Mode == ProfileModeDebug {
		return "Debug"
	}
	if profile.Kind == ProfileKindPreview {
		return "Preview"
	}
	return "Run"
}

func fallbackProfileDescription(profile Profile) string {
	if profile.Kind == ProfileKindPreview {
		return "Open browser preview"
	}
	if profile.Mode == ProfileModeDebug {
		return "Debug profile"
	}
	return "Run profile"
}

func profileID(profile Profile) string {
	base := fmt.Sprintf("%s:%s:%s:%s", profile.Mode, profile.Kind, profile.WorkingDirectory, profile.Command)
	return sanitizeID(base)
}

func normalizePath(path string) string {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return ""
	}
	return strings.ReplaceAll(trimmed, "\\", "/")
}

func sanitizeID(input string) string {
	trimmed := strings.TrimSpace(strings.ToLower(input))
	if trimmed == "" {
		return "profile"
	}
	re := regexp.MustCompile(`[^a-z0-9._:-]+`)
	cleaned := re.ReplaceAllString(trimmed, "-")
	cleaned = strings.Trim(cleaned, "-")
	if cleaned == "" {
		return "profile"
	}
	if len(cleaned) > 120 {
		cleaned = cleaned[:120]
	}
	return cleaned
}

func shellQuote(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "''"
	}
	replacer := strings.NewReplacer("'", `'"'"'`)
	return "'" + replacer.Replace(trimmed) + "'"
}

func firstCommandToken(command string) string {
	trimmed := strings.TrimSpace(command)
	if trimmed == "" {
		return ""
	}
	parts := strings.Fields(trimmed)
	if len(parts) == 0 {
		return ""
	}
	first := strings.TrimSpace(parts[0])
	if strings.Contains(first, "=") || first == "cd" {
		if len(parts) > 1 {
			return strings.TrimSpace(parts[1])
		}
		return ""
	}
	return first
}

func uniqueStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, exists := seen[trimmed]; exists {
			continue
		}
		seen[trimmed] = struct{}{}
		result = append(result, trimmed)
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func isHTMLFile(filePath string) bool {
	path := strings.ToLower(strings.TrimSpace(filePath))
	return strings.HasSuffix(path, ".html") || strings.HasSuffix(path, ".htm") || strings.HasSuffix(path, ".xhtml")
}

func isGoMainFile(filePath string, content string) bool {
	normalized := normalizePath(filePath)
	if !strings.HasSuffix(strings.ToLower(normalized), "/main.go") {
		return false
	}

	if content == "" {
		return false
	}

	hasPackageMain := regexp.MustCompile(`(?m)(^|\n)package\s+main\b`).MatchString(content)
	hasMainFunc := regexp.MustCompile(`(?m)(^|\n)func\s+main\s*\(`).MatchString(content)
	return hasPackageMain && hasMainFunc
}

func launchCommandForType(launchType string, program string, args []string) (string, []string) {
	program = strings.TrimSpace(program)
	if program == "" {
		return "", nil
	}

	joinedArgs := joinShellArgs(args)
	appendArgs := func(base string) string {
		if joinedArgs == "" {
			return base
		}
		return base + " " + joinedArgs
	}

	switch {
	case launchType == "go" || launchType == "delve":
		return appendArgs("dlv debug " + shellQuote(program)), []string{"dlv"}
	case strings.Contains(launchType, "node") || strings.Contains(launchType, "javascript"):
		return appendArgs("node --inspect " + shellQuote(program)), []string{"node"}
	case strings.Contains(launchType, "python") || strings.Contains(launchType, "debugpy"):
		return appendArgs("python -m debugpy --listen 5678 --wait-for-client " + shellQuote(program)), []string{"python"}
	case strings.Contains(launchType, "php") || strings.Contains(launchType, "xdebug"):
		return appendArgs("php -d xdebug.mode=debug " + shellQuote(program)), []string{"php"}
	default:
		return appendArgs(shellQuote(program)), []string{firstCommandToken(program)}
	}
}

func joinShellArgs(args []string) string {
	if len(args) == 0 {
		return ""
	}
	builder := strings.Builder{}
	for i, arg := range args {
		trimmed := strings.TrimSpace(arg)
		if trimmed == "" {
			continue
		}
		if builder.Len() > 0 || i > 0 {
			builder.WriteByte(' ')
		}
		builder.WriteString(shellQuote(trimmed))
	}
	return strings.TrimSpace(builder.String())
}

func mapStringInterfaceToString(input map[string]interface{}) map[string]string {
	if len(input) == 0 {
		return map[string]string{}
	}
	result := make(map[string]string, len(input))
	for key, value := range input {
		switch typed := value.(type) {
		case string:
			result[key] = typed
		case fmt.Stringer:
			result[key] = typed.String()
		case nil:
			result[key] = ""
		default:
			result[key] = fmt.Sprint(typed)
		}
	}
	return result
}

package terminal

import (
	"path/filepath"
	"strings"
)

var agentLaunchBinaries = map[string]struct{}{
	"codex": {},
}

var previewCandidateScripts = map[string]struct{}{
	"dev":     {},
	"preview": {},
	"serve":   {},
	"start":   {},
}

func IsAgentLaunchCommand(input string) bool {
	trimmedInput := strings.TrimSpace(input)
	if trimmedInput == "" {
		return false
	}

	parsed, err := ParseShellInput(trimmedInput)
	if err != nil || parsed == nil || parsed.IsIncomplete {
		return false
	}

	binary := resolveAgentLaunchBinary(parsed)
	if binary == "" {
		return false
	}

	_, exists := agentLaunchBinaries[binary]
	return exists
}

func IsPreviewCandidateCommand(input string) bool {
	trimmedInput := strings.TrimSpace(input)
	if trimmedInput == "" {
		return false
	}

	parsed, err := ParseShellInput(trimmedInput)
	if err != nil || parsed == nil || parsed.IsIncomplete {
		return false
	}

	binary, args := resolveExecutableWithArgs(parsed)
	if binary == "" {
		return false
	}

	switch binary {
	case "npm", "pnpm":
		return matchesNodeScriptCommand(args)
	case "yarn", "bun":
		return matchesYarnLikeScriptCommand(args)
	case "npx":
		return matchesNPXPreviewCommand(args)
	case "vite":
		return matchesViteCommand(args)
	case "next":
		return len(args) > 0 && args[0] == "dev"
	case "php":
		return len(args) > 1 && args[0] == "artisan" && args[1] == "serve"
	case "python", "python3":
		_, hasModuleFlag := parsed.Flags["m"]
		return hasModuleFlag && len(args) > 0 && args[0] == "http.server"
	default:
		return false
	}
}

func resolveAgentLaunchBinary(parsed *ParsedCommand) string {
	binary := normalizeBinaryName(parsed.Binary)
	if binary == "" {
		return ""
	}

	switch binary {
	case "env":
		return firstExecutableArg(parsed.Args, true)
	case "command", "nohup":
		return firstExecutableArg(parsed.Args, false)
	default:
		return binary
	}
}

func resolveExecutableWithArgs(parsed *ParsedCommand) (string, []string) {
	binary := normalizeBinaryName(parsed.Binary)
	if binary == "" {
		return "", nil
	}

	switch binary {
	case "env":
		index, resolved := firstExecutableArgIndex(parsed.Args, true)
		if resolved == "" {
			return "", nil
		}
		return resolved, parsed.Args[index+1:]
	case "command", "nohup":
		index, resolved := firstExecutableArgIndex(parsed.Args, false)
		if resolved == "" {
			return "", nil
		}
		return resolved, parsed.Args[index+1:]
	default:
		return binary, parsed.Args
	}
}

func firstExecutableArg(args []string, skipAssignments bool) string {
	_, binary := firstExecutableArgIndex(args, skipAssignments)
	return binary
}

func firstExecutableArgIndex(args []string, skipAssignments bool) (int, string) {
	return firstExecutableArgFrom(args, skipAssignments)
}

func firstExecutableArgFrom(args []string, skipAssignments bool) (int, string) {
	for index, arg := range args {
		normalizedArg := strings.TrimSpace(arg)
		if normalizedArg == "" {
			continue
		}
		if strings.HasPrefix(normalizedArg, "-") {
			continue
		}
		if skipAssignments && isEnvAssignment(normalizedArg) {
			continue
		}
		return index, normalizeBinaryName(normalizedArg)
	}

	return -1, ""
}

func matchesNodeScriptCommand(args []string) bool {
	if len(args) == 0 {
		return false
	}

	if args[0] == "run" {
		return len(args) > 1 && isPreviewScript(args[1])
	}

	return isPreviewScript(args[0])
}

func matchesYarnLikeScriptCommand(args []string) bool {
	if len(args) == 0 {
		return false
	}

	if args[0] == "run" {
		return len(args) > 1 && isPreviewScript(args[1])
	}

	return isPreviewScript(args[0])
}

func matchesNPXPreviewCommand(args []string) bool {
	if len(args) == 0 {
		return false
	}

	binary := normalizeBinaryName(args[0])
	if binary == "vite" {
		return matchesViteCommand(args[1:])
	}

	return binary == "next" && len(args) > 1 && args[1] == "dev"
}

func matchesViteCommand(args []string) bool {
	if len(args) == 0 {
		return true
	}

	for _, arg := range args {
		normalizedArg := strings.TrimSpace(arg)
		if normalizedArg == "" || strings.HasPrefix(normalizedArg, "-") {
			continue
		}
		return normalizedArg != "build"
	}

	return true
}

func isPreviewScript(script string) bool {
	_, ok := previewCandidateScripts[strings.ToLower(strings.TrimSpace(script))]
	return ok
}

func isEnvAssignment(token string) bool {
	if strings.HasPrefix(token, "=") {
		return false
	}

	separatorIndex := strings.IndexByte(token, '=')
	return separatorIndex > 0
}

func normalizeBinaryName(binary string) string {
	trimmed := strings.TrimSpace(binary)
	if trimmed == "" {
		return ""
	}

	base := strings.ToLower(filepath.Base(trimmed))
	base = strings.TrimSuffix(base, ".exe")
	base = strings.TrimSuffix(base, ".cmd")
	base = strings.TrimSuffix(base, ".bat")
	return base
}

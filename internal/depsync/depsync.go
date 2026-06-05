package depsync

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"arlecchino/internal/toolchain"
)

type Mode string

const (
	ModeManual   Mode = "manual"
	ModeSafeAuto Mode = "safe-auto"
	ModeFullAuto Mode = "full-auto"
)

type Command struct {
	Label        string               `json:"label"`
	Executable   string               `json:"executable"`
	Args         string               `json:"args"`
	Safe         bool                 `json:"safe"`
	Capability   DependencyCapability `json:"capability,omitempty"`
	MutationRisk MutationRisk         `json:"mutationRisk,omitempty"`
}

type Manager struct {
	Ecosystem string    `json:"ecosystem"`
	Tool      string    `json:"tool"`
	Manifest  string    `json:"manifest"`
	Commands  []Command `json:"commands"`
}

type Plan struct {
	ProjectPath string    `json:"projectPath"`
	Mode        Mode      `json:"mode"`
	Managers    []Manager `json:"managers"`
}

type Executor struct {
	runner func(command resolvedCommand) ([]byte, error)
}

func NewExecutor() *Executor {
	return &Executor{runner: defaultRunner}
}

type resolvedCommand struct {
	dir        string
	executable string
	args       []string
	env        []string
}

func defaultRunner(command resolvedCommand) ([]byte, error) {
	cmd := exec.Command(command.executable, command.args...)
	cmd.Dir = command.dir
	if len(command.env) > 0 {
		cmd.Env = command.env
	}
	return cmd.CombinedOutput()
}

func (e *Executor) BuildPlan(projectPath string, mode Mode) (Plan, error) {
	if strings.TrimSpace(projectPath) == "" {
		return Plan{}, fmt.Errorf("project path is required")
	}
	managers, err := detectManagers(projectPath, mode)
	if err != nil {
		return Plan{}, err
	}
	return Plan{ProjectPath: projectPath, Mode: mode, Managers: managers}, nil
}

func (e *Executor) Execute(projectPath string, mode Mode) (map[string]string, error) {
	plan, err := e.BuildPlan(projectPath, mode)
	if err != nil {
		return nil, err
	}
	results := make(map[string]string, len(plan.Managers))
	failedUpdateGroups := make(map[string]bool)
	for _, manager := range plan.Managers {
		workDir, workDirErr := manifestWorkDir(projectPath, manager.Manifest)
		for _, cmd := range manager.Commands {
			if mode == ModeManual {
				continue
			}
			if mode == ModeSafeAuto && !cmd.Safe {
				continue
			}
			key := buildActionID(manager, cmd)
			groupKey := followUpActionGroup(manager.Ecosystem, manager.Manifest, cmd.Executable)
			if shouldSkipAfterFailedUpdate(manager.Ecosystem, cmd.Label, failedUpdateGroups[groupKey]) {
				results[key] = "skipped: previous update failed"
				continue
			}
			if workDirErr != nil {
				results[key] = fmt.Sprintf("skipped: %v", workDirErr)
				continue
			}
			resolution := commandResolution(projectPath, workDir, cmd.Executable)
			if !resolution.Available() {
				results[key] = "skipped: " + resolution.Reason
				continue
			}
			args := splitArgs(cmd.Args)
			out, runErr := e.runner(resolvedCommand{
				dir:        workDir,
				executable: resolution.Path,
				args:       args,
				env:        toolchain.CommandEnv(resolution),
			})
			results[key] = strings.TrimSpace(string(out))
			if runErr != nil {
				message := fmt.Sprintf("failed: %v", runErr)
				if trimmed := strings.TrimSpace(string(out)); trimmed != "" {
					message += "\n" + trimmed
				}
				results[key] = message
				if isUpdatePrerequisiteAction(manager.Ecosystem, cmd.Label) {
					failedUpdateGroups[groupKey] = true
				}
				continue
			}
		}
	}
	return results, nil
}

func splitArgs(args string) []string {
	trimmed := strings.TrimSpace(args)
	if trimmed == "" {
		return nil
	}

	parts := make([]string, 0, 8)
	var current strings.Builder
	inSingle := false
	inDouble := false
	escaped := false

	flush := func() {
		if current.Len() == 0 {
			return
		}
		parts = append(parts, current.String())
		current.Reset()
	}

	for _, r := range trimmed {
		if escaped {
			current.WriteRune(r)
			escaped = false
			continue
		}

		if inSingle {
			if r == '\'' {
				inSingle = false
			} else {
				current.WriteRune(r)
			}
			continue
		}

		if inDouble {
			if r == '"' {
				inDouble = false
			} else if r == '\\' {
				escaped = true
			} else {
				current.WriteRune(r)
			}
			continue
		}

		switch r {
		case '\\':
			escaped = true
		case '\'':
			inSingle = true
		case '"':
			inDouble = true
		case ' ', '\t', '\n', '\r':
			flush()
		default:
			current.WriteRune(r)
		}
	}

	if escaped {
		current.WriteRune('\\')
	}
	flush()
	return parts
}

func commandAvailable(projectPath, workDir, executable string) bool {
	return commandAvailability(projectPath, workDir, executable) == ""
}

func commandAvailability(projectPath, workDir, executable string) string {
	return commandResolution(projectPath, workDir, executable).Reason
}

func commandResolution(projectPath, workDir, executable string) toolchain.Resolution {
	return toolchain.ResolveExecutable(projectPath, workDir, executable)
}

func followUpActionGroup(ecosystem, manifest, executable string) string {
	return strings.Join([]string{
		strings.TrimSpace(ecosystem),
		strings.TrimSpace(manifest),
		strings.TrimSpace(executable),
	}, "\x00")
}

func isUpdatePrerequisiteAction(ecosystem, label string) bool {
	return strings.TrimSpace(ecosystem) == "go" && strings.TrimSpace(label) == "update"
}

func shouldSkipAfterFailedUpdate(ecosystem, label string, previousFailed bool) bool {
	return previousFailed && strings.TrimSpace(ecosystem) == "go" && strings.TrimSpace(label) == "tidy-after-update"
}

func relativeCommandAvailable(projectPath, workDir, executable string) bool {
	return relativeCommandAvailability(projectPath, workDir, executable) == ""
}

func relativeCommandAvailability(projectPath, workDir, executable string) string {
	rootAbs, err := filepath.Abs(filepath.Clean(strings.TrimSpace(projectPath)))
	if err != nil || rootAbs == "" {
		return "project path is required"
	}
	workAbs, err := filepath.Abs(filepath.Clean(strings.TrimSpace(workDir)))
	if err != nil || workAbs == "" || !pathWithinRoot(rootAbs, workAbs) {
		return "work directory is outside project"
	}
	candidate := filepath.Clean(filepath.Join(workAbs, filepath.FromSlash(executable)))
	if !pathWithinRoot(rootAbs, candidate) {
		return fmt.Sprintf("executable escapes project: %s", executable)
	}
	info, err := os.Stat(candidate)
	if err != nil {
		return fmt.Sprintf("missing executable %s", executable)
	}
	if !resolvedPathWithinRoot(rootAbs, candidate) {
		return fmt.Sprintf("executable escapes project: %s", executable)
	}
	if info.IsDir() {
		return fmt.Sprintf("executable is a directory: %s", executable)
	}
	if runtime.GOOS != "windows" && info.Mode()&0o111 == 0 {
		return fmt.Sprintf("executable is not runnable: %s", executable)
	}
	return ""
}

func detectManagers(projectPath string, mode Mode) ([]Manager, error) {
	return defaultRegistry().Detect(projectPath, mode)
}

func detectManagersWithReport(projectPath string, mode Mode) ([]Manager, manifestDiscoveryReport, error) {
	return defaultRegistry().DetectWithReport(projectPath, mode)
}

func commandsForMode(commands []Command, mode Mode) []Command {
	if mode == ModeManual {
		return commands
	}
	filtered := make([]Command, 0, len(commands))
	for _, cmd := range commands {
		if mode == ModeSafeAuto && !cmd.Safe {
			continue
		}
		filtered = append(filtered, cmd)
	}
	return filtered
}

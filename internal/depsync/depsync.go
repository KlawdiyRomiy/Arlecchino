package depsync

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
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
	runner func(dir, name string, args ...string) ([]byte, error)
}

func NewExecutor() *Executor {
	return &Executor{runner: defaultRunner}
}

func defaultRunner(dir, name string, args ...string) ([]byte, error) {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
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
			if workDirErr != nil {
				results[key] = fmt.Sprintf("skipped: %v", workDirErr)
				continue
			}
			if !commandAvailable(projectPath, workDir, cmd.Executable) {
				results[key] = fmt.Sprintf("skipped: missing executable %s", cmd.Executable)
				continue
			}
			args := splitArgs(cmd.Args)
			out, runErr := e.runner(workDir, cmd.Executable, args...)
			results[key] = strings.TrimSpace(string(out))
			if runErr != nil {
				message := fmt.Sprintf("failed: %v", runErr)
				if trimmed := strings.TrimSpace(string(out)); trimmed != "" {
					message += "\n" + trimmed
				}
				results[key] = message
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
	executable = strings.TrimSpace(executable)
	if executable == "" {
		return false
	}
	if strings.HasPrefix(executable, "./") || strings.HasPrefix(executable, "../") {
		return relativeCommandAvailable(projectPath, workDir, executable)
	}
	_, err := exec.LookPath(executable)
	return err == nil
}

func relativeCommandAvailable(projectPath, workDir, executable string) bool {
	rootAbs, err := filepath.Abs(filepath.Clean(strings.TrimSpace(projectPath)))
	if err != nil || rootAbs == "" {
		return false
	}
	workAbs, err := filepath.Abs(filepath.Clean(strings.TrimSpace(workDir)))
	if err != nil || workAbs == "" || !pathWithinRoot(rootAbs, workAbs) {
		return false
	}
	candidate := filepath.Clean(filepath.Join(workAbs, filepath.FromSlash(executable)))
	if !pathWithinRoot(rootAbs, candidate) || !resolvedPathWithinRoot(rootAbs, candidate) {
		return false
	}
	info, err := os.Stat(candidate)
	return err == nil && !info.IsDir()
}

func detectManagers(projectPath string, mode Mode) ([]Manager, error) {
	return defaultRegistry().Detect(projectPath, mode)
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

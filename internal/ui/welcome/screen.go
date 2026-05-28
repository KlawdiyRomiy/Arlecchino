package welcome

import (
	"os/exec"
	"runtime"
	"strings"

	"arlecchino/internal/project"
)

type WelcomeScreen struct {
	projectManager *project.ProjectManager
}

func NewWelcomeScreen(pm *project.ProjectManager) *WelcomeScreen {
	return &WelcomeScreen{
		projectManager: pm,
	}
}

type ToolStatus struct {
	Name       string `json:"name"`
	Available  bool   `json:"available"`
	Version    string `json:"version"`
	InstallCmd string `json:"installCmd"`
}

func (ws *WelcomeScreen) ValidateEnvironment() map[string]bool {
	phpAvailable := exec.Command("php", "--version").Run() == nil
	composerAvailable := exec.Command("composer", "--version").Run() == nil

	return map[string]bool{
		"php":      phpAvailable,
		"composer": composerAvailable,
	}
}

func (ws *WelcomeScreen) GetToolsStatus() []ToolStatus {
	tools := []ToolStatus{
		{Name: "PHP", InstallCmd: getInstallCmd("php")},
		{Name: "Composer", InstallCmd: getInstallCmd("composer")},
		{Name: "Go", InstallCmd: getInstallCmd("go")},
		{Name: "Node.js", InstallCmd: getInstallCmd("node")},
		{Name: "Python", InstallCmd: getInstallCmd("python")},
		{Name: "Rust", InstallCmd: getInstallCmd("rust")},
	}

	for i := range tools {
		tools[i].Available, tools[i].Version = checkTool(tools[i].Name)
	}

	return tools
}

func checkTool(name string) (bool, string) {
	var cmd *exec.Cmd

	switch strings.ToLower(name) {
	case "php":
		cmd = exec.Command("php", "--version")
	case "composer":
		cmd = exec.Command("composer", "--version")
	case "go":
		cmd = exec.Command("go", "version")
	case "node.js", "node":
		cmd = exec.Command("node", "--version")
	case "python":
		cmd = exec.Command("python3", "--version")
		if cmd.Run() != nil {
			cmd = exec.Command("python", "--version")
		}
	case "rust":
		cmd = exec.Command("rustc", "--version")
	default:
		return false, ""
	}

	output, err := cmd.Output()
	if err != nil {
		return false, ""
	}

	version := strings.TrimSpace(string(output))
	if idx := strings.Index(version, "\n"); idx > 0 {
		version = version[:idx]
	}

	return true, version
}

func getInstallCmd(tool string) string {
	isMac := runtime.GOOS == "darwin"
	isLinux := runtime.GOOS == "linux"

	switch strings.ToLower(tool) {
	case "php":
		if isMac {
			return "brew install php"
		}
		return "apt install php"
	case "composer":
		return "curl -sS https://getcomposer.org/installer | php"
	case "go":
		if isMac {
			return "brew install go"
		}
		return "apt install golang"
	case "node":
		if isMac {
			return "brew install node"
		}
		return "apt install nodejs npm"
	case "python":
		if isMac {
			return "brew install python"
		}
		return "apt install python3 python3-pip"
	case "rust":
		return "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
	case "clangd":
		if isMac {
			return "brew install llvm"
		}
		if isLinux {
			return "apt install clangd"
		}
		return "choco install llvm"
	default:
		return ""
	}
}

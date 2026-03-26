package laravel

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"arlecchino/internal/plugins"
)

type SimpleExec struct {
	ProjectPath string
	PHPPath     string
}

type ListenerOptions struct {
	Event  string
	Queued bool
}

var phpLookPath = exec.LookPath

func NewSimpleExec(projectPath string) (*SimpleExec, error) {
	phpPath, err := findPHP()
	if err != nil {
		return nil, fmt.Errorf("could not find PHP: %w", err)
	}

	return &SimpleExec{
		ProjectPath: projectPath,
		PHPPath:     phpPath,
	}, nil
}

func findPHP() (string, error) {
	if path, err := phpLookPath("php"); err == nil {
		return path, nil
	}
	return "", fmt.Errorf("php not found in PATH; add it to your shell profile")
}

func (s *SimpleExec) MakeNewLaravelProject(projectName string) error {
	cmd := exec.Command("laravel", "new", projectName)
	cmd.Dir = s.ProjectPath

	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to create new project: %s, %w", string(output), err)
	}

	return nil
}

func (s *SimpleExec) RunArtisan(command string, args ...string) (string, error) {
	fullArgs := append([]string{"artisan", command}, args...)
	cmd := exec.Command(s.PHPPath, fullArgs...)
	cmd.Dir = s.ProjectPath

	output, err := cmd.CombinedOutput()
	if err != nil {
		// Return the output along with error for better debugging
		return string(output), fmt.Errorf("%s: %w", string(output), err)
	}

	return string(output), nil
}

func (s *SimpleExec) RunMigrate() error {
	_, err := s.RunArtisan("migrate")
	return err
}

func (s *SimpleExec) CreateController(name string, opts plugins.ControllerOptions) error {
	args := []string{name}

	if opts.Api {
		args = append(args, "--api")
	}
	if opts.Invokable {
		args = append(args, "--invokable")
	}
	if opts.Model != "" {
		args = append(args, "--model="+opts.Model)
	}
	if opts.Parent != "" {
		args = append(args, "--parent="+opts.Parent)
	}
	if opts.Resource {
		args = append(args, "--resource")
	}
	if opts.Singleton {
		args = append(args, "--singleton")
	}
	if opts.Requests {
		args = append(args, "--requests")
	}

	_, err := s.RunArtisan("make:controller", args...)
	return err
}

func (s *SimpleExec) CreateModel(name string, opts plugins.ModelOptions) error {
	args := []string{name}
	if opts.All {
		args = append(args, "--all")
	}
	if opts.Controller {
		args = append(args, "--controller")
	}
	if opts.Factory {
		args = append(args, "--factory")
	}
	if opts.Migration {
		args = append(args, "--migration")
	}
	if opts.Policy {
		args = append(args, "--policy")
	}
	if opts.Resource {
		args = append(args, "--resource")
	}
	if opts.Seeder {
		args = append(args, "--seeder")
	}
	if opts.Invokable {
		args = append(args, "--invokable")
	}
	_, err := s.RunArtisan("make:model", args...)
	return err
}

func (s *SimpleExec) CreateListener(name string, opts ListenerOptions) error {
	args := []string{name}

	if opts.Event != "" {
		args = append(args, "--event="+opts.Event)
	}
	if opts.Queued {
		args = append(args, "--queued")
	}

	_, err := s.RunArtisan("make:listener", args...)
	return err
}

func (s *SimpleExec) CreateMail(name string, opts plugins.MailOptions) error {
	args := []string{name}
	if opts.Markdown != "" {
		args = append(args, "--markdown="+opts.Markdown)
	}
	_, err := s.RunArtisan("make:mail", args...)
	return err
}

func (s *SimpleExec) CreateNotifications(name string, opts plugins.NotificationOptions) error {
	args := []string{name}

	if opts.Force {
		args = append(args, "--force")
	}

	_, err := s.RunArtisan("make:notification", args...)
	return err
}

func (s *SimpleExec) CreateComponent(name string, opts plugins.ComponentOptions) error {
	args := []string{name}

	if opts.Force {
		args = append(args, "--force")
	}
	if opts.Plain {
		args = append(args, "--plain")
	}
	if opts.Invokable {
		args = append(args, "--invokable")
	}

	_, err := s.RunArtisan("make:component", args...)
	return err
}

func (s *SimpleExec) CreateLivewire(name string, opts plugins.LivewireComponentOptions) error {
	args := []string{name}

	if opts.Force {
		args = append(args, "--force")
	}
	if opts.Inline {
		args = append(args, "--inline")
	}
	if opts.Plain {
		args = append(args, "--plain")
	}
	if opts.Invokable {
		args = append(args, "--invokable")
	}
	if opts.SkipViews {
		args = append(args, "--skip-views")
	}

	_, err := s.RunArtisan("make:livewire", args...)
	return err
}

func (s *SimpleExec) CreateEnum(name string, opts plugins.EnumClassOptions) error {
	args := []string{name}

	if opts.Force {
		args = append(args, "--force")
	}

	_, err := s.RunArtisan("make:enum", args...)
	return err
}

func (s *SimpleExec) CreateEvent(name string, opts plugins.EventClassOptions) error {
	args := []string{name}

	if opts.Force {
		args = append(args, "--force")
	}

	_, err := s.RunArtisan("make:event", args...)
	return err
}

func (s *SimpleExec) CreateJob(name string, opts plugins.JobOptions) error {
	args := []string{name}

	if opts.Sync {
		args = append(args, "--sync")
	}

	_, err := s.RunArtisan("make:job", args...)
	return err
}

func (s *SimpleExec) CreateResource(name string, opts plugins.ResourceClassOptions) error {
	args := []string{name}

	if opts.Collection {
		args = append(args, "--collection")
	}
	if opts.Force {
		args = append(args, "--force")
	}
	if opts.Invokable {
		args = append(args, "--invokable")
	}
	if opts.Model != "" {
		args = append(args, "--model="+opts.Model)
	}

	_, err := s.RunArtisan("make:resource", args...)
	return err
}

func (s *SimpleExec) CreateFactory(name string, opts plugins.FactoryClassOptions) error {
	args := []string{name}

	if opts.Force {
		args = append(args, "--force")
	}
	if opts.Model != "" {
		args = append(args, "--model="+opts.Model)
	}
	if opts.Seeded {
		args = append(args, "--seeded")
	}

	_, err := s.RunArtisan("make:factory", args...)
	return err
}

func (s *SimpleExec) CreateSeeder(name string, opts plugins.SeederClassOptions) error {
	args := []string{name}

	if opts.Force {
		args = append(args, "--force")
	}
	if opts.Class != "" {
		args = append(args, "--class="+opts.Class)
	}

	_, err := s.RunArtisan("make:seeder", args...)
	return err
}

func (s *SimpleExec) CreatePolicy(name string, opts plugins.PolicyClassOptions) error {
	args := []string{name}

	if opts.Force {
		args = append(args, "--force")
	}
	if opts.Model != "" {
		args = append(args, "--model="+opts.Model)
	}
	if opts.Guard != "" {
		args = append(args, "--guard="+opts.Guard)
	}
	if opts.Resource {
		args = append(args, "--resource")
	}

	_, err := s.RunArtisan("make:policy", args...)
	return err
}

func (s *SimpleExec) CreateMigration(name string, opts plugins.MigrationOptions) error {
	args := []string{name}

	if opts.Create != "" {
		args = append(args, "--create="+opts.Create)
	}
	if opts.Table != "" {
		args = append(args, "--table="+opts.Table)
	}
	if opts.Path != "" {
		args = append(args, "--path="+opts.Path)
	}

	_, err := s.RunArtisan("make:migration", args...)
	return err
}

func IsLaravelProject(path string) bool {
	requiredFiles := []string{
		"artisan",
		"composer.json",
	}

	for _, file := range requiredFiles {
		if _, err := os.Stat(filepath.Join(path, file)); err != nil {
			return false
		}
	}

	hasKernel := false
	hasBootstrapApp := false

	if _, err := os.Stat(filepath.Join(path, "app/Http/Kernel.php")); err == nil {
		hasKernel = true
	}

	if _, err := os.Stat(filepath.Join(path, "bootstrap/app.php")); err == nil {
		hasBootstrapApp = true
	}

	if !hasKernel && !hasBootstrapApp {
		return false
	}

	composerData, err := os.ReadFile(filepath.Join(path, "composer.json"))
	if err != nil {
		return false
	}

	return strings.Contains(string(composerData), "laravel/framework")
}

func FindEnv(path string) bool {
	_, err := os.Stat(filepath.Join(path, ".env"))
	return err == nil
}

func GetLaravelVersion(path string) (string, error) {
	composerData, err := os.ReadFile(filepath.Join(path, "composer.json"))
	if err != nil {
		return "", err
	}

	content := string(composerData)

	start := strings.Index(content, `"laravel/framework"`)
	if start == -1 {
		start = strings.Index(content, `"illuminate/framework"`)
		if start == -1 {
			return "", fmt.Errorf("laravel framework not found in composer.json")
		}
	}

	start = strings.Index(content[start:], ":") + start + 1
	if start == -1 {
		return "", fmt.Errorf("version not found in composer.json")
	}

	for start < len(content) && (content[start] == ' ' || content[start] == '\t') {
		start++
	}

	if start < len(content) && content[start] == '"' {
		start++
	}

	end := start
	for end < len(content) && content[end] != '"' && content[end] != ',' && content[end] != '\n' && content[end] != '\r' {
		end++
	}

	version := strings.TrimSpace(content[start:end])
	return version, nil
}

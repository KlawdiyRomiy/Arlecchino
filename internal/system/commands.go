package system

import (
	"fmt"
	"os/exec"
)

var systemLookPath = exec.LookPath

type SystemManager struct {
	ProjectPath string
	PHPPath     string
}

type MigrateOptions struct {
	Force    bool
	Step     int
	Path     string
	Realpath bool
}

type MigrateRollbackOptions struct {
	Step     int
	Paths    []string
	Realpath bool
}

type MigrateRefreshOptions struct {
	Seed     bool
	Step     int
	Path     string
	Realpath bool
}

type MigrateResetOptions struct {
	Path     string
	Realpath bool
}

type CacheOptions struct {
	ExcludeGroups []string
	IncludeGroups []string
}

type ServeOptions struct {
	Host       string
	Port       string
	Env        string
	ForceHttps bool
}

func NewSystemManager(projectPath string) (*SystemManager, error) {
	phpPath, err := findPHP()
	if err != nil {
		return nil, fmt.Errorf("could not find PHP: %w", err)
	}

	return &SystemManager{
		ProjectPath: projectPath,
		PHPPath:     phpPath,
	}, nil
}

func findPHP() (string, error) {
	if path, err := systemLookPath("php"); err == nil {
		return path, nil
	}
	return "", fmt.Errorf("php not found in PATH; add it to your shell profile")
}

func (s *SystemManager) RunArtisan(command string, args ...string) (string, error) {
	fullArgs := append([]string{"artisan", command}, args...)
	cmd := exec.Command(s.PHPPath, fullArgs...)
	cmd.Dir = s.ProjectPath

	output, err := cmd.Output()
	if err != nil {
		return "", err
	}

	return string(output), nil
}

func (s *SystemManager) Migrate(opts MigrateOptions) (string, error) {
	args := []string{}

	if opts.Force {
		args = append(args, "--force")
	}
	if opts.Step > 0 {
		args = append(args, "--step="+fmt.Sprintf("%d", opts.Step))
	}
	if opts.Path != "" {
		if opts.Realpath {
			args = append(args, "--path="+opts.Path, "--realpath")
		} else {
			args = append(args, "--path="+opts.Path)
		}
	}

	return s.RunArtisan("migrate", args...)
}

func (s *SystemManager) MigrateRollback(opts MigrateRollbackOptions) (string, error) {
	args := []string{}

	if opts.Step > 0 {
		args = append(args, "--step="+fmt.Sprintf("%d", opts.Step))
	}

	for _, path := range opts.Paths {
		if opts.Realpath {
			args = append(args, "--path="+path, "--realpath")
		} else {
			args = append(args, "--path="+path)
		}
	}

	return s.RunArtisan("migrate:rollback", args...)
}

func (s *SystemManager) MigrateRefresh(opts MigrateRefreshOptions) (string, error) {
	args := []string{}

	if opts.Seed {
		args = append(args, "--seed")
	}
	if opts.Step > 0 {
		args = append(args, "--step="+fmt.Sprintf("%d", opts.Step))
	}
	if opts.Path != "" {
		if opts.Realpath {
			args = append(args, "--path="+opts.Path, "--realpath")
		} else {
			args = append(args, "--path="+opts.Path)
		}
	}

	return s.RunArtisan("migrate:refresh", args...)
}

func (s *SystemManager) MigrateStatus() (string, error) {
	return s.RunArtisan("migrate:status")
}

func (s *SystemManager) MigrateReset(opts MigrateResetOptions) (string, error) {
	args := []string{}

	if opts.Path != "" {
		if opts.Realpath {
			args = append(args, "--path="+opts.Path, "--realpath")
		} else {
			args = append(args, "--path="+opts.Path)
		}
	}

	return s.RunArtisan("migrate:reset", args...)
}

func (s *SystemManager) MigrateFresh(opts MigrateRefreshOptions) (string, error) {
	args := []string{}

	if opts.Seed {
		args = append(args, "--seed")
	}
	if opts.Path != "" {
		if opts.Realpath {
			args = append(args, "--path="+opts.Path, "--realpath")
		} else {
			args = append(args, "--path="+opts.Path)
		}
	}

	return s.RunArtisan("migrate:fresh", args...)
}

func (s *SystemManager) CacheClear(opts CacheOptions) (string, error) {
	args := []string{}

	for _, group := range opts.ExcludeGroups {
		args = append(args, "--except="+group)
	}

	for _, group := range opts.IncludeGroups {
		args = append(args, "--only="+group)
	}

	return s.RunArtisan("cache:clear", args...)
}

func (s *SystemManager) ConfigCache() (string, error) {
	return s.RunArtisan("config:cache")
}

func (s *SystemManager) RouteCache() (string, error) {
	return s.RunArtisan("route:cache")
}

func (s *SystemManager) ViewCache() (string, error) {
	return s.RunArtisan("view:cache")
}

func (s *SystemManager) ClearCompiled() (string, error) {
	return s.RunArtisan("clear-compiled")
}

func (s *SystemManager) Serve(opts ServeOptions) error {
	args := []string{}

	if opts.Host != "" {
		args = append(args, "--host="+opts.Host)
	}
	if opts.Port != "" {
		args = append(args, "--port="+opts.Port)
	}
	if opts.Env != "" {
		args = append(args, "--env="+opts.Env)
	}
	if opts.ForceHttps {
		args = append(args, "--https")
	}

	// Note: This is a long-running process, typically you'd want to run this in a separate goroutine
	cmd := exec.Command(s.PHPPath, append([]string{"artisan", "serve"}, args...)...)
	cmd.Dir = s.ProjectPath
	return cmd.Run()
}

func (s *SystemManager) QueueWork(connection string, queue string) error {
	args := []string{}

	if connection != "" {
		args = append(args, "--connection="+connection)
	}
	if queue != "" {
		args = append(args, "--queue="+queue)
	}

	_, err := s.RunArtisan("queue:work", args...)
	return err
}

func (s *SystemManager) ScheduleRun() (string, error) {
	return s.RunArtisan("schedule:run")
}

func (s *SystemManager) Tinker() error {
	cmd := exec.Command(s.PHPPath, "artisan", "tinker")
	cmd.Dir = s.ProjectPath
	return cmd.Run()
}

func (s *SystemManager) DBSeed(class string) (string, error) {
	args := []string{}

	if class != "" {
		args = append(args, "--class="+class)
	}

	return s.RunArtisan("db:seed", args...)
}

func (s *SystemManager) MigrateSeed(opts MigrateOptions) (string, error) {
	args := []string{}

	if opts.Force {
		args = append(args, "--force")
	}
	if opts.Path != "" {
		if opts.Realpath {
			args = append(args, "--path="+opts.Path, "--realpath")
		} else {
			args = append(args, "--path="+opts.Path)
		}
	}

	return s.RunArtisan("migrate", append(args, "--seed")...)
}

func (s *SystemManager) StorageLink() (string, error) {
	return s.RunArtisan("storage:link")
}

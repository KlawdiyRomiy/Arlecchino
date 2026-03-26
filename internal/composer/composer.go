package composer

import (
	"fmt"
	"os/exec"
)

var composerLookPath = exec.LookPath

type ComposerManager struct {
	ProjectPath  string
	ComposerPath string
}

type InstallOptions struct {
	Dev                bool
	NoDev              bool
	Optimize           bool
	NoScripts          bool
	Update             bool
	IgnorePlatformReqs bool
}

type RemoveOptions struct {
	NoDev     bool
	NoScripts bool
	Update    bool
}

func NewComposerManager(projectPath string) (*ComposerManager, error) {
	composerPath, err := findComposer()
	if err != nil {
		return nil, fmt.Errorf("could not find Composer: %w", err)
	}

	return &ComposerManager{
		ProjectPath:  projectPath,
		ComposerPath: composerPath,
	}, nil
}

func findComposer() (string, error) {
	if path, err := composerLookPath("composer"); err == nil {
		return path, nil
	}
	return "", fmt.Errorf("composer not found in PATH; add it to your shell profile")
}

func (c *ComposerManager) RunCommand(command string, args ...string) (string, error) {
	fullArgs := append([]string{command}, args...)
	cmd := exec.Command(c.ComposerPath, fullArgs...)
	cmd.Dir = c.ProjectPath

	output, err := cmd.CombinedOutput()
	if err != nil {
		return string(output), fmt.Errorf("%w: %s", err, string(output))
	}

	return string(output), nil
}

func (c *ComposerManager) InstallPackage(name string, opts InstallOptions) error {
	args := []string{name}

	if opts.Dev {
		args = append(args, "--dev")
	}
	if opts.NoDev {
		args = append(args, "--no-dev")
	}
	if opts.Optimize {
		args = append(args, "--optimize-autoloader")
	}
	if opts.NoScripts {
		args = append(args, "--no-scripts")
	}
	if opts.Update {
		args = append(args, "--update")
	}
	if opts.IgnorePlatformReqs {
		args = append(args, "--ignore-platform-reqs")
	}

	_, err := c.RunCommand("require", args...)
	return err
}

func (c *ComposerManager) RemovePackage(name string, opts RemoveOptions) error {
	args := []string{name}

	if opts.NoDev {
		args = append(args, "--no-dev")
	}
	if opts.NoScripts {
		args = append(args, "--no-scripts")
	}
	if opts.Update {
		args = append(args, "--update")
	}

	_, err := c.RunCommand("remove", args...)
	return err
}

func (c *ComposerManager) UpdatePackage(name string) error {
	args := []string{name}
	_, err := c.RunCommand("update", args...)
	return err
}

func (c *ComposerManager) UpdateAll() error {
	_, err := c.RunCommand("update")
	return err
}

func (c *ComposerManager) InstallAll() error {
	_, err := c.RunCommand("install")
	return err
}

func (c *ComposerManager) DumpAutoload() error {
	_, err := c.RunCommand("dump-autoload")
	return err
}

func (c *ComposerManager) PublishAssets(packageName string, tags []string) error {
	args := []string{packageName, "--provider=" + packageName}

	if len(tags) > 0 {
		for _, tag := range tags {
			args = append(args, "--tag="+tag)
		}
	}

	_, err := c.RunCommand("vendor:publish", args...)
	return err
}

func (c *ComposerManager) InstallLivewire() error {
	return c.InstallPackage("livewire/livewire", InstallOptions{Dev: false})
}

func (c *ComposerManager) InstallFortify() error {
	return c.InstallPackage("laravel/fortify", InstallOptions{Dev: false})
}

func (c *ComposerManager) InstallJetstream() error {
	return c.InstallPackage("laravel/jetstream", InstallOptions{Dev: false})
}

func (c *ComposerManager) InstallBreeze() error {
	return c.InstallPackage("laravel/breeze", InstallOptions{Dev: false})
}

func (c *ComposerManager) ListInstalledPackages() (string, error) {
	return c.RunCommand("show")
}

func (c *ComposerManager) ShowPackageInfo(name string) (string, error) {
	return c.RunCommand("show", name)
}

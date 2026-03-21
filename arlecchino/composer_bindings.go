package main

import (
	"fmt"

	"arlecchino/internal/composer"
)

// Composer Commands - Package management

func (a *App) InstallPackage(name string, opts composer.InstallOptions) error {
	if a.cmp == nil {
		return fmt.Errorf("no project opened")
	}
	return a.cmp.InstallPackage(name, opts)
}

func (a *App) RemovePackage(name string, opts composer.RemoveOptions) error {
	if a.cmp == nil {
		return fmt.Errorf("no project opened")
	}
	return a.cmp.RemovePackage(name, opts)
}

func (a *App) UpdatePackage(name string) error {
	if a.cmp == nil {
		return fmt.Errorf("no project opened")
	}
	return a.cmp.UpdatePackage(name)
}

func (a *App) UpdateAll() error {
	if a.cmp == nil {
		return fmt.Errorf("no project opened")
	}
	return a.cmp.UpdateAll()
}

func (a *App) InstallAll() error {
	if a.cmp == nil {
		return fmt.Errorf("no project opened")
	}
	return a.cmp.InstallAll()
}

func (a *App) DumpAutoload() error {
	if a.cmp == nil {
		return fmt.Errorf("no project opened")
	}
	return a.cmp.DumpAutoload()
}

func (a *App) PublishAssets(packageName string, tags []string) error {
	if a.cmp == nil {
		return fmt.Errorf("no project opened")
	}
	return a.cmp.PublishAssets(packageName, tags)
}

func (a *App) InstallLivewire() error {
	if a.cmp == nil {
		return fmt.Errorf("no project opened")
	}
	return a.cmp.InstallLivewire()
}

func (a *App) InstallFortify() error {
	if a.cmp == nil {
		return fmt.Errorf("no project opened")
	}
	return a.cmp.InstallFortify()
}

func (a *App) InstallJetstream() error {
	if a.cmp == nil {
		return fmt.Errorf("no project opened")
	}
	return a.cmp.InstallJetstream()
}

func (a *App) InstallBreeze() error {
	if a.cmp == nil {
		return fmt.Errorf("no project opened")
	}
	return a.cmp.InstallBreeze()
}

func (a *App) ListInstalledPackages() (string, error) {
	if a.cmp == nil {
		return "", fmt.Errorf("no project opened")
	}
	return a.cmp.ListInstalledPackages()
}

func (a *App) ShowPackageInfo(name string) (string, error) {
	if a.cmp == nil {
		return "", fmt.Errorf("no project opened")
	}
	return a.cmp.ShowPackageInfo(name)
}

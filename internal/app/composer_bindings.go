package app

import "arlecchino/internal/composer"

// Composer Commands - Package management

func (a *App) InstallPackage(name string, opts composer.InstallOptions) error {
	cmp, err := a.ensureComposerManager()
	if err != nil {
		return err
	}
	return cmp.InstallPackage(name, opts)
}

func (a *App) RemovePackage(name string, opts composer.RemoveOptions) error {
	cmp, err := a.ensureComposerManager()
	if err != nil {
		return err
	}
	return cmp.RemovePackage(name, opts)
}

func (a *App) UpdatePackage(name string) error {
	cmp, err := a.ensureComposerManager()
	if err != nil {
		return err
	}
	return cmp.UpdatePackage(name)
}

func (a *App) UpdateAll() error {
	cmp, err := a.ensureComposerManager()
	if err != nil {
		return err
	}
	return cmp.UpdateAll()
}

func (a *App) InstallAll() error {
	cmp, err := a.ensureComposerManager()
	if err != nil {
		return err
	}
	return cmp.InstallAll()
}

func (a *App) DumpAutoload() error {
	cmp, err := a.ensureComposerManager()
	if err != nil {
		return err
	}
	return cmp.DumpAutoload()
}

func (a *App) PublishAssets(packageName string, tags []string) error {
	cmp, err := a.ensureComposerManager()
	if err != nil {
		return err
	}
	return cmp.PublishAssets(packageName, tags)
}

func (a *App) InstallLivewire() error {
	cmp, err := a.ensureComposerManager()
	if err != nil {
		return err
	}
	return cmp.InstallLivewire()
}

func (a *App) InstallFortify() error {
	cmp, err := a.ensureComposerManager()
	if err != nil {
		return err
	}
	return cmp.InstallFortify()
}

func (a *App) InstallJetstream() error {
	cmp, err := a.ensureComposerManager()
	if err != nil {
		return err
	}
	return cmp.InstallJetstream()
}

func (a *App) InstallBreeze() error {
	cmp, err := a.ensureComposerManager()
	if err != nil {
		return err
	}
	return cmp.InstallBreeze()
}

func (a *App) ListInstalledPackages() (string, error) {
	cmp, err := a.ensureComposerManager()
	if err != nil {
		return "", err
	}
	return cmp.ListInstalledPackages()
}

func (a *App) ShowPackageInfo(name string) (string, error) {
	cmp, err := a.ensureComposerManager()
	if err != nil {
		return "", err
	}
	return cmp.ShowPackageInfo(name)
}

package main

import "arlecchino/internal/system"

// System Commands - Artisan system operations (migrate, cache, serve, etc.)

func (a *App) Migrate(opts system.MigrateOptions) (string, error) {
	sys, err := a.ensureSystemManager()
	if err != nil {
		return "", err
	}
	return sys.Migrate(opts)
}

func (a *App) MigrateRollback(opts system.MigrateRollbackOptions) (string, error) {
	sys, err := a.ensureSystemManager()
	if err != nil {
		return "", err
	}
	return sys.MigrateRollback(opts)
}

func (a *App) MigrateRefresh(opts system.MigrateRefreshOptions) (string, error) {
	sys, err := a.ensureSystemManager()
	if err != nil {
		return "", err
	}
	return sys.MigrateRefresh(opts)
}

func (a *App) MigrateStatus() (string, error) {
	sys, err := a.ensureSystemManager()
	if err != nil {
		return "", err
	}
	return sys.MigrateStatus()
}

func (a *App) MigrateReset(opts system.MigrateResetOptions) (string, error) {
	sys, err := a.ensureSystemManager()
	if err != nil {
		return "", err
	}
	return sys.MigrateReset(opts)
}

func (a *App) MigrateFresh(opts system.MigrateRefreshOptions) (string, error) {
	sys, err := a.ensureSystemManager()
	if err != nil {
		return "", err
	}
	return sys.MigrateFresh(opts)
}

func (a *App) CacheClear(opts system.CacheOptions) (string, error) {
	sys, err := a.ensureSystemManager()
	if err != nil {
		return "", err
	}
	return sys.CacheClear(opts)
}

func (a *App) ConfigCache() (string, error) {
	sys, err := a.ensureSystemManager()
	if err != nil {
		return "", err
	}
	return sys.ConfigCache()
}

func (a *App) RouteCache() (string, error) {
	sys, err := a.ensureSystemManager()
	if err != nil {
		return "", err
	}
	return sys.RouteCache()
}

func (a *App) ViewCache() (string, error) {
	sys, err := a.ensureSystemManager()
	if err != nil {
		return "", err
	}
	return sys.ViewCache()
}

func (a *App) ClearCompiled() (string, error) {
	sys, err := a.ensureSystemManager()
	if err != nil {
		return "", err
	}
	return sys.ClearCompiled()
}

func (a *App) Serve(opts system.ServeOptions) error {
	sys, err := a.ensureSystemManager()
	if err != nil {
		return err
	}
	return sys.Serve(opts)
}

func (a *App) QueueWork(connection string, queue string) error {
	sys, err := a.ensureSystemManager()
	if err != nil {
		return err
	}
	return sys.QueueWork(connection, queue)
}

func (a *App) ScheduleRun() (string, error) {
	sys, err := a.ensureSystemManager()
	if err != nil {
		return "", err
	}
	return sys.ScheduleRun()
}

func (a *App) Tinker() error {
	sys, err := a.ensureSystemManager()
	if err != nil {
		return err
	}
	return sys.Tinker()
}

func (a *App) DBSeed(class string) (string, error) {
	sys, err := a.ensureSystemManager()
	if err != nil {
		return "", err
	}
	return sys.DBSeed(class)
}

func (a *App) MigrateSeed(opts system.MigrateOptions) (string, error) {
	sys, err := a.ensureSystemManager()
	if err != nil {
		return "", err
	}
	return sys.MigrateSeed(opts)
}

func (a *App) StorageLink() (string, error) {
	sys, err := a.ensureSystemManager()
	if err != nil {
		return "", err
	}
	return sys.StorageLink()
}

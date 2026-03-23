package main

import (
	"fmt"

	"arlecchino/internal/system"
)

// System Commands - Artisan system operations (migrate, cache, serve, etc.)

func (a *App) Migrate(opts system.MigrateOptions) (string, error) {
	if a.sys == nil {
		return "", fmt.Errorf("no project opened")
	}
	return a.sys.Migrate(opts)
}

func (a *App) MigrateRollback(opts system.MigrateRollbackOptions) (string, error) {
	if a.sys == nil {
		return "", fmt.Errorf("no project opened")
	}
	return a.sys.MigrateRollback(opts)
}

func (a *App) MigrateRefresh(opts system.MigrateRefreshOptions) (string, error) {
	if a.sys == nil {
		return "", fmt.Errorf("no project opened")
	}
	return a.sys.MigrateRefresh(opts)
}

func (a *App) MigrateStatus() (string, error) {
	if a.sys == nil {
		return "", fmt.Errorf("no project opened")
	}
	return a.sys.MigrateStatus()
}

func (a *App) MigrateReset(opts system.MigrateResetOptions) (string, error) {
	if a.sys == nil {
		return "", fmt.Errorf("no project opened")
	}
	return a.sys.MigrateReset(opts)
}

func (a *App) MigrateFresh(opts system.MigrateRefreshOptions) (string, error) {
	if a.sys == nil {
		return "", fmt.Errorf("no project opened")
	}
	return a.sys.MigrateFresh(opts)
}

func (a *App) CacheClear(opts system.CacheOptions) (string, error) {
	if a.sys == nil {
		return "", fmt.Errorf("no project opened")
	}
	return a.sys.CacheClear(opts)
}

func (a *App) ConfigCache() (string, error) {
	if a.sys == nil {
		return "", fmt.Errorf("no project opened")
	}
	return a.sys.ConfigCache()
}

func (a *App) RouteCache() (string, error) {
	if a.sys == nil {
		return "", fmt.Errorf("no project opened")
	}
	return a.sys.RouteCache()
}

func (a *App) ViewCache() (string, error) {
	if a.sys == nil {
		return "", fmt.Errorf("no project opened")
	}
	return a.sys.ViewCache()
}

func (a *App) ClearCompiled() (string, error) {
	if a.sys == nil {
		return "", fmt.Errorf("no project opened")
	}
	return a.sys.ClearCompiled()
}

func (a *App) Serve(opts system.ServeOptions) error {
	if a.sys == nil {
		return fmt.Errorf("no project opened")
	}
	return a.sys.Serve(opts)
}

func (a *App) QueueWork(connection string, queue string) error {
	if a.sys == nil {
		return fmt.Errorf("no project opened")
	}
	return a.sys.QueueWork(connection, queue)
}

func (a *App) ScheduleRun() (string, error) {
	if a.sys == nil {
		return "", fmt.Errorf("no project opened")
	}
	return a.sys.ScheduleRun()
}

func (a *App) Tinker() error {
	if a.sys == nil {
		return fmt.Errorf("no project opened")
	}
	return a.sys.Tinker()
}

func (a *App) DBSeed(class string) (string, error) {
	if a.sys == nil {
		return "", fmt.Errorf("no project opened")
	}
	return a.sys.DBSeed(class)
}

func (a *App) MigrateSeed(opts system.MigrateOptions) (string, error) {
	if a.sys == nil {
		return "", fmt.Errorf("no project opened")
	}
	return a.sys.MigrateSeed(opts)
}

func (a *App) StorageLink() (string, error) {
	if a.sys == nil {
		return "", fmt.Errorf("no project opened")
	}
	return a.sys.StorageLink()
}

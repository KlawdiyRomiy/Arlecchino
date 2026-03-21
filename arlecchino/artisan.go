package main

import (
	"fmt"

	"arlecchino/internal/plugins/laravel"
)

// Artisan Commands - Laravel code generation via artisan

// getLaravelExec returns Laravel exec from plugin, or nil if not available
func (a *App) getLaravelExec() *laravel.SimpleExec {
	if a.plugins == nil {
		return nil
	}
	p := a.plugins.Get("laravel")
	if p == nil {
		return nil
	}
	lp, ok := p.(*laravel.Plugin)
	if !ok || lp == nil {
		return nil
	}
	return lp.Exec()
}

func (a *App) RunMigrate() error {
	exec := a.getLaravelExec()
	if exec == nil {
		return fmt.Errorf("no Laravel project opened")
	}
	return exec.RunMigrate()
}

func (a *App) CreateModel(name string, opts laravel.ModelOptions) error {
	exec := a.getLaravelExec()
	if exec == nil {
		return fmt.Errorf("no Laravel project opened")
	}
	return exec.CreateModel(name, opts)
}

func (a *App) CreateController(name string, opts laravel.ControllerOptions) error {
	exec := a.getLaravelExec()
	if exec == nil {
		return fmt.Errorf("no Laravel project opened")
	}
	return exec.CreateController(name, opts)
}

func (a *App) CreateMail(name string, opts laravel.MailOptions) error {
	exec := a.getLaravelExec()
	if exec == nil {
		return fmt.Errorf("no Laravel project opened")
	}
	return exec.CreateMail(name, opts)
}

func (a *App) CreateNotification(name string, opts laravel.NotificationOptions) error {
	exec := a.getLaravelExec()
	if exec == nil {
		return fmt.Errorf("no Laravel project opened")
	}
	return exec.CreateNotifications(name, opts)
}

func (a *App) CreateComponent(name string, opts laravel.ComponentOptions) error {
	exec := a.getLaravelExec()
	if exec == nil {
		return fmt.Errorf("no Laravel project opened")
	}
	return exec.CreateComponent(name, opts)
}

func (a *App) CreateLivewire(name string, opts laravel.LivewireComponentOptions) error {
	exec := a.getLaravelExec()
	if exec == nil {
		return fmt.Errorf("no Laravel project opened")
	}
	return exec.CreateLivewire(name, opts)
}

func (a *App) CreateEnum(name string, opts laravel.EnumClassOptions) error {
	exec := a.getLaravelExec()
	if exec == nil {
		return fmt.Errorf("no Laravel project opened")
	}
	return exec.CreateEnum(name, opts)
}

func (a *App) CreateEvent(name string, opts laravel.EventClassOptions) error {
	exec := a.getLaravelExec()
	if exec == nil {
		return fmt.Errorf("no Laravel project opened")
	}
	return exec.CreateEvent(name, opts)
}

func (a *App) CreateJob(name string, opts laravel.JobOptions) error {
	exec := a.getLaravelExec()
	if exec == nil {
		return fmt.Errorf("no Laravel project opened")
	}
	return exec.CreateJob(name, opts)
}

func (a *App) CreateResource(name string, opts laravel.ResourceClassOptions) error {
	exec := a.getLaravelExec()
	if exec == nil {
		return fmt.Errorf("no Laravel project opened")
	}
	return exec.CreateResource(name, opts)
}

func (a *App) CreateFactory(name string, opts laravel.FactoryClassOptions) error {
	exec := a.getLaravelExec()
	if exec == nil {
		return fmt.Errorf("no Laravel project opened")
	}
	return exec.CreateFactory(name, opts)
}

func (a *App) CreateSeeder(name string, opts laravel.SeederClassOptions) error {
	exec := a.getLaravelExec()
	if exec == nil {
		return fmt.Errorf("no Laravel project opened")
	}
	return exec.CreateSeeder(name, opts)
}

func (a *App) CreatePolicy(name string, opts laravel.PolicyClassOptions) error {
	exec := a.getLaravelExec()
	if exec == nil {
		return fmt.Errorf("no Laravel project opened")
	}
	return exec.CreatePolicy(name, opts)
}

func (a *App) CreateMigration(name string, opts laravel.MigrationOptions) error {
	exec := a.getLaravelExec()
	if exec == nil {
		return fmt.Errorf("no Laravel project opened")
	}
	return exec.CreateMigration(name, opts)
}

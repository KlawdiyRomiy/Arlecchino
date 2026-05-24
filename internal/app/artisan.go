package app

import (
	"arlecchino/internal/plugins"
)

// Artisan Commands - Laravel code generation via artisan

func (a *App) RunMigrate() error {
	exec, err := a.getArtisanExecutor()
	if err != nil {
		return err
	}
	return exec.RunMigrate()
}

func (a *App) CreateModel(name string, opts plugins.ModelOptions) error {
	exec, err := a.getArtisanExecutor()
	if err != nil {
		return err
	}
	return exec.CreateModel(name, opts)
}

func (a *App) CreateController(name string, opts plugins.ControllerOptions) error {
	exec, err := a.getArtisanExecutor()
	if err != nil {
		return err
	}
	return exec.CreateController(name, opts)
}

func (a *App) CreateMail(name string, opts plugins.MailOptions) error {
	exec, err := a.getArtisanExecutor()
	if err != nil {
		return err
	}
	return exec.CreateMail(name, opts)
}

func (a *App) CreateNotification(name string, opts plugins.NotificationOptions) error {
	exec, err := a.getArtisanExecutor()
	if err != nil {
		return err
	}
	return exec.CreateNotifications(name, opts)
}

func (a *App) CreateComponent(name string, opts plugins.ComponentOptions) error {
	exec, err := a.getArtisanExecutor()
	if err != nil {
		return err
	}
	return exec.CreateComponent(name, opts)
}

func (a *App) CreateLivewire(name string, opts plugins.LivewireComponentOptions) error {
	exec, err := a.getArtisanExecutor()
	if err != nil {
		return err
	}
	return exec.CreateLivewire(name, opts)
}

func (a *App) CreateEnum(name string, opts plugins.EnumClassOptions) error {
	exec, err := a.getArtisanExecutor()
	if err != nil {
		return err
	}
	return exec.CreateEnum(name, opts)
}

func (a *App) CreateEvent(name string, opts plugins.EventClassOptions) error {
	exec, err := a.getArtisanExecutor()
	if err != nil {
		return err
	}
	return exec.CreateEvent(name, opts)
}

func (a *App) CreateJob(name string, opts plugins.JobOptions) error {
	exec, err := a.getArtisanExecutor()
	if err != nil {
		return err
	}
	return exec.CreateJob(name, opts)
}

func (a *App) CreateResource(name string, opts plugins.ResourceClassOptions) error {
	exec, err := a.getArtisanExecutor()
	if err != nil {
		return err
	}
	return exec.CreateResource(name, opts)
}

func (a *App) CreateFactory(name string, opts plugins.FactoryClassOptions) error {
	exec, err := a.getArtisanExecutor()
	if err != nil {
		return err
	}
	return exec.CreateFactory(name, opts)
}

func (a *App) CreateSeeder(name string, opts plugins.SeederClassOptions) error {
	exec, err := a.getArtisanExecutor()
	if err != nil {
		return err
	}
	return exec.CreateSeeder(name, opts)
}

func (a *App) CreatePolicy(name string, opts plugins.PolicyClassOptions) error {
	exec, err := a.getArtisanExecutor()
	if err != nil {
		return err
	}
	return exec.CreatePolicy(name, opts)
}

func (a *App) CreateMigration(name string, opts plugins.MigrationOptions) error {
	exec, err := a.getArtisanExecutor()
	if err != nil {
		return err
	}
	return exec.CreateMigration(name, opts)
}

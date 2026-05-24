package app

import (
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func macWindowCycleCollectionBehavior() application.MacWindowCollectionBehavior {
	return application.MacWindowCollectionBehaviorFullScreenPrimary |
		application.MacWindowCollectionBehaviorParticipatesInCycle
}

func mainWindowMacOptions() application.MacWindow {
	return application.MacWindow{
		TitleBar:                application.MacTitleBarHidden,
		InvisibleTitleBarHeight: 0,
		Backdrop:                application.MacBackdropTransparent,
		CollectionBehavior:      macWindowCycleCollectionBehavior(),
	}
}

func mainWebviewWindowOptions() application.WebviewWindowOptions {
	return application.WebviewWindowOptions{
		Name:                  "main",
		Title:                 mainWindowTitle,
		Width:                 1440,
		Height:                900,
		MinWidth:              1024,
		MinHeight:             768,
		Frameless:             runtime.GOOS != "darwin",
		StartState:            application.WindowStateMaximised,
		Hidden:                false,
		URL:                   "/",
		UseApplicationMenu:    true,
		EnableFileDrop:        true,
		BackgroundType:        application.BackgroundTypeTransparent,
		BackgroundColour:      application.NewRGBA(10, 10, 10, 0),
		MinimiseButtonState:   webviewOwnedWindowButtonState(),
		MaximiseButtonState:   webviewOwnedWindowButtonState(),
		CloseButtonState:      webviewOwnedWindowButtonState(),
		FullscreenButtonState: webviewOwnedWindowButtonState(),
		Mac:                   mainWindowMacOptions(),
		Windows: application.WindowsWindow{
			DisableIcon: false,
		},
		Linux: application.LinuxWindow{
			WebviewGpuPolicy: application.WebviewGpuPolicyAlways,
		},
	}
}

func webviewOwnedWindowButtonState() application.ButtonState {
	if runtime.GOOS == "darwin" {
		return application.ButtonHidden
	}
	return application.ButtonEnabled
}

func detachedWindowMacOptions() application.MacWindow {
	return application.MacWindow{
		TitleBar:                application.MacTitleBarDefault,
		InvisibleTitleBarHeight: 0,
		Backdrop:                application.MacBackdropTransparent,
		CollectionBehavior:      macWindowCycleCollectionBehavior(),
	}
}

package main

import "github.com/wailsapp/wails/v3/pkg/application"

func macWindowCycleCollectionBehavior() application.MacWindowCollectionBehavior {
	return application.MacWindowCollectionBehaviorFullScreenPrimary |
		application.MacWindowCollectionBehaviorParticipatesInCycle
}

func mainWindowMacOptions() application.MacWindow {
	return application.MacWindow{
		TitleBar:                application.MacTitleBarHiddenInsetUnified,
		InvisibleTitleBarHeight: 0,
		Backdrop:                application.MacBackdropTransparent,
		CollectionBehavior:      macWindowCycleCollectionBehavior(),
	}
}

func detachedWindowMacOptions() application.MacWindow {
	return application.MacWindow{
		TitleBar:                application.MacTitleBarDefault,
		InvisibleTitleBarHeight: 0,
		Backdrop:                application.MacBackdropTransparent,
		CollectionBehavior:      macWindowCycleCollectionBehavior(),
	}
}

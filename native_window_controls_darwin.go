//go:build darwin

package main

/*
#cgo CFLAGS: -x objective-c -fblocks
#cgo LDFLAGS: -framework Cocoa
#import <Cocoa/Cocoa.h>
#import <dispatch/dispatch.h>

static NSWindow* arlecchinoControlsWindow(void *preferredWindow) {
    if (preferredWindow != nil) {
        return (NSWindow*)preferredWindow;
    }

    NSWindow *window = [NSApp mainWindow];
    if (window == nil) {
        window = [NSApp keyWindow];
    }
    if (window == nil) {
        for (NSWindow *candidate in [NSApp windows]) {
            if ([candidate isVisible]) {
                window = candidate;
                break;
            }
        }
    }
    if (window == nil && [[NSApp windows] count] > 0) {
        window = [[NSApp windows] objectAtIndex:0];
    }
    return window;
}

static bool arlecchinoMoveWindowButton(NSButton *button, CGFloat centerX, CGFloat centerY) {
    if (button == nil || [button superview] == nil) {
        return false;
    }

    NSView *superview = [button superview];
    NSRect bounds = [superview bounds];
    NSRect frame = [button frame];
    frame.origin.x = centerX - (frame.size.width / 2.0);
    frame.origin.y = bounds.size.height - centerY - (frame.size.height / 2.0);

    [button setFrame:frame];
    [button setAutoresizingMask:NSViewMinXMargin | NSViewMinYMargin];
    [button setNeedsDisplay:YES];
    [button updateTrackingAreas];
    [superview updateTrackingAreas];
    NSWindow *window = [button window];
    if (window != nil) {
        [window invalidateCursorRectsForView:button];
        [window invalidateCursorRectsForView:superview];
    }
    return true;
}

static bool arlecchinoPositionNativeWindowControlsOnMainThread(
    void *preferredWindow,
    double closeX, double closeY,
    double minimiseX, double minimiseY,
    double maximiseX, double maximiseY
) {
    NSWindow *window = arlecchinoControlsWindow(preferredWindow);
    if (window == nil) {
        return false;
    }

    NSButton *closeButton = [window standardWindowButton:NSWindowCloseButton];
    NSButton *minimiseButton = [window standardWindowButton:NSWindowMiniaturizeButton];
    NSButton *maximiseButton = [window standardWindowButton:NSWindowZoomButton];

    bool didMoveClose = arlecchinoMoveWindowButton(closeButton, closeX, closeY);
    bool didMoveMinimise = arlecchinoMoveWindowButton(minimiseButton, minimiseX, minimiseY);
    bool didMoveMaximise = arlecchinoMoveWindowButton(maximiseButton, maximiseX, maximiseY);
    return didMoveClose && didMoveMinimise && didMoveMaximise;
}

static bool arlecchinoPositionNativeWindowControls(
    void *preferredWindow,
    double closeX, double closeY,
    double minimiseX, double minimiseY,
    double maximiseX, double maximiseY
) {
    __block bool didPosition = false;
    void (^position)(void) = ^{
        didPosition = arlecchinoPositionNativeWindowControlsOnMainThread(
            preferredWindow,
            closeX, closeY,
            minimiseX, minimiseY,
            maximiseX, maximiseY
        );
    };

    if ([NSThread isMainThread]) {
        position();
    } else {
        dispatch_sync(dispatch_get_main_queue(), position);
    }
    return didPosition;
}
*/
import "C"

import (
	"unsafe"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func (a *App) SetNativeWindowControlsVisible(visible bool) bool {
	if a == nil || a.mainWindow == nil {
		return false
	}

	state := application.ButtonHidden
	if visible {
		state = application.ButtonEnabled
	}

	a.mainWindow.SetCloseButtonState(state)
	a.mainWindow.SetMinimiseButtonState(state)
	a.mainWindow.SetMaximiseButtonState(state)
	a.RefreshNativeWindowControls()
	return true
}

func (a *App) PositionNativeWindowControls(closeX, closeY, minimiseX, minimiseY, maximiseX, maximiseY float64) bool {
	if a == nil {
		return false
	}

	controls := [6]float64{closeX, closeY, minimiseX, minimiseY, maximiseX, maximiseY}

	a.nativeControlsMu.Lock()
	a.nativeControlsSet = true
	a.nativeControls = controls
	a.nativeControlsMu.Unlock()

	return a.positionNativeWindowControls(controls)
}

func (a *App) RefreshNativeWindowControls() bool {
	if a == nil {
		return false
	}

	a.nativeControlsMu.Lock()
	controlsSet := a.nativeControlsSet
	controls := a.nativeControls
	a.nativeControlsMu.Unlock()

	if !controlsSet {
		return false
	}

	return a.positionNativeWindowControls(controls)
}

func (a *App) positionNativeWindowControls(controls [6]float64) bool {
	var nativeWindow unsafe.Pointer
	if a != nil && a.mainWindow != nil {
		nativeWindow = a.mainWindow.NativeWindow()
	}

	return bool(C.arlecchinoPositionNativeWindowControls(
		nativeWindow,
		C.double(controls[0]),
		C.double(controls[1]),
		C.double(controls[2]),
		C.double(controls[3]),
		C.double(controls[4]),
		C.double(controls[5]),
	))
}

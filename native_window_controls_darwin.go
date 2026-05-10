//go:build darwin

package main

/*
#cgo CFLAGS: -x objective-c -fblocks
#cgo LDFLAGS: -framework Cocoa
#import <Cocoa/Cocoa.h>
#import <dispatch/dispatch.h>
#import <objc/runtime.h>

static char arlecchinoOriginalButtonsSuperviewFrameKey;

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

static CGFloat arlecchinoButtonCenterX(NSButton *button) {
    NSRect frame = [button frame];
    return frame.origin.x + (frame.size.width / 2.0);
}

static CGFloat arlecchinoButtonCenterY(NSButton *button) {
    NSRect frame = [button frame];
    return frame.origin.y + (frame.size.height / 2.0);
}

static bool arlecchinoWindowIsFullscreen(NSWindow *window) {
    return window != nil && ([window styleMask] & NSWindowStyleMaskFullScreen) == NSWindowStyleMaskFullScreen;
}

static NSView* arlecchinoWindowButtonsSuperview(
    NSButton *closeButton,
    NSButton *minimiseButton,
    NSButton *maximiseButton
) {
    if (
        closeButton == nil ||
        minimiseButton == nil ||
        maximiseButton == nil ||
        [closeButton superview] == nil ||
        [closeButton superview] != [minimiseButton superview] ||
        [closeButton superview] != [maximiseButton superview]
    ) {
        return nil;
    }

    return [closeButton superview];
}

static void arlecchinoRefreshWindowButtonsSuperview(NSView *buttonSuperview) {
    if (buttonSuperview == nil) {
        return;
    }

    NSView *parentView = [buttonSuperview superview];
    [buttonSuperview setNeedsDisplay:YES];
    [buttonSuperview updateTrackingAreas];
    if (parentView != nil) {
        [parentView updateTrackingAreas];
    }

    NSWindow *window = [buttonSuperview window];
    if (window != nil) {
        [window invalidateCursorRectsForView:buttonSuperview];
        if (parentView != nil) {
            [window invalidateCursorRectsForView:parentView];
        }
    }
}

static void arlecchinoRememberWindowButtonsSuperviewFrame(NSView *buttonSuperview) {
    if (buttonSuperview == nil || objc_getAssociatedObject(buttonSuperview, &arlecchinoOriginalButtonsSuperviewFrameKey) != nil) {
        return;
    }

    objc_setAssociatedObject(
        buttonSuperview,
        &arlecchinoOriginalButtonsSuperviewFrameKey,
        [NSValue valueWithRect:[buttonSuperview frame]],
        OBJC_ASSOCIATION_RETAIN_NONATOMIC
    );
}

static bool arlecchinoRestoreWindowButtonsSuperview(
    NSButton *closeButton,
    NSButton *minimiseButton,
    NSButton *maximiseButton
) {
    NSView *buttonSuperview = arlecchinoWindowButtonsSuperview(closeButton, minimiseButton, maximiseButton);
    if (buttonSuperview == nil) {
        return false;
    }

    NSValue *originalFrame = objc_getAssociatedObject(buttonSuperview, &arlecchinoOriginalButtonsSuperviewFrameKey);
    if (originalFrame != nil) {
        [buttonSuperview setFrame:[originalFrame rectValue]];
    }
    arlecchinoRefreshWindowButtonsSuperview(buttonSuperview);
    return true;
}

static bool arlecchinoMoveWindowButtonsSuperview(
    NSButton *closeButton,
    NSButton *minimiseButton,
    NSButton *maximiseButton,
    CGFloat closeX,
    CGFloat closeY,
    CGFloat minimiseY,
    CGFloat maximiseY
) {
    NSView *buttonSuperview = arlecchinoWindowButtonsSuperview(closeButton, minimiseButton, maximiseButton);
    if (buttonSuperview == nil) {
        return false;
    }

    NSView *parentView = [buttonSuperview superview];
    if (parentView == nil) {
        return false;
    }

    arlecchinoRememberWindowButtonsSuperviewFrame(buttonSuperview);

    NSRect parentBounds = [parentView bounds];
    NSRect superviewFrame = [buttonSuperview frame];
    CGFloat desiredCenterY = (closeY + minimiseY + maximiseY) / 3.0;
    CGFloat currentCenterY =
        (arlecchinoButtonCenterY(closeButton) +
         arlecchinoButtonCenterY(minimiseButton) +
         arlecchinoButtonCenterY(maximiseButton)) / 3.0;
    CGFloat nextSuperviewY = parentBounds.size.height - desiredCenterY - currentCenterY;
    CGFloat nextSuperviewX = closeX - arlecchinoButtonCenterX(closeButton);

    superviewFrame.origin.x = nextSuperviewX;
    superviewFrame.origin.y = nextSuperviewY;
    [buttonSuperview setFrame:superviewFrame];
    arlecchinoRefreshWindowButtonsSuperview(buttonSuperview);
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

    if (arlecchinoWindowIsFullscreen(window)) {
        return arlecchinoRestoreWindowButtonsSuperview(closeButton, minimiseButton, maximiseButton);
    }

    return arlecchinoMoveWindowButtonsSuperview(
        closeButton,
        minimiseButton,
        maximiseButton,
        closeX,
        closeY,
        minimiseY,
        maximiseY
    );
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
	"context"
	"unsafe"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func (a *App) SetNativeWindowControlsVisible(ctx context.Context, visible bool) bool {
	window := a.nativeWindowControlsTarget(ctx)
	if window == nil {
		return false
	}

	state := application.ButtonHidden
	if visible {
		state = application.ButtonEnabled
	}

	a.updateNativeWindowControlsState(window, func(controlsState *nativeWindowControlsState) {
		controlsState.visibleSet = true
		controlsState.visible = visible
	})

	window.SetCloseButtonState(state)
	window.SetMinimiseButtonState(state)
	window.SetMaximiseButtonState(state)
	a.refreshNativeWindowControlsForWindow(window)
	return true
}

func (a *App) PositionNativeWindowControls(ctx context.Context, closeX, closeY, minimiseX, minimiseY, maximiseX, maximiseY float64) bool {
	window := a.nativeWindowControlsTarget(ctx)
	if window == nil {
		return false
	}

	controls := [6]float64{closeX, closeY, minimiseX, minimiseY, maximiseX, maximiseY}
	a.updateNativeWindowControlsState(window, func(controlsState *nativeWindowControlsState) {
		controlsState.controlsSet = true
		controlsState.controls = controls
	})

	return a.positionNativeWindowControls(window, controls)
}

func (a *App) RefreshNativeWindowControls(ctx context.Context) bool {
	return a.refreshNativeWindowControlsForWindow(a.nativeWindowControlsTarget(ctx))
}

func (a *App) refreshNativeWindowControlsForWindow(window application.Window) bool {
	state, ok := a.nativeWindowControlsState(window)
	if !ok || !state.controlsSet {
		return false
	}
	return a.positionNativeWindowControls(window, state.controls)
}

func (a *App) positionNativeWindowControls(window application.Window, controls [6]float64) bool {
	var nativeWindow unsafe.Pointer
	if window != nil {
		nativeWindow = window.NativeWindow()
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

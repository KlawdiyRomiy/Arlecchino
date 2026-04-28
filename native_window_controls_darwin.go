//go:build darwin

package main

/*
#cgo CFLAGS: -x objective-c -fblocks
#cgo LDFLAGS: -framework Cocoa
#import <Cocoa/Cocoa.h>
#import <dispatch/dispatch.h>

static NSWindow* arlecchinoControlsMainWindow(void) {
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

static void arlecchinoMoveWindowButton(NSButton *button, CGFloat centerX, CGFloat centerY) {
    if (button == nil || [button superview] == nil) {
        return;
    }

    NSView *superview = [button superview];
    NSRect bounds = [superview bounds];
    NSRect frame = [button frame];
    frame.origin.x = centerX - (frame.size.width / 2.0);
    frame.origin.y = bounds.size.height - centerY - (frame.size.height / 2.0);

    [button setHidden:NO];
    [button setEnabled:YES];
    [button setFrameOrigin:frame.origin];
    [button setAutoresizingMask:NSViewMinXMargin | NSViewMinYMargin];
}

static void arlecchinoPositionNativeWindowControlsOnMainThread(
    double closeX, double closeY,
    double minimiseX, double minimiseY,
    double maximiseX, double maximiseY
) {
    NSWindow *window = arlecchinoControlsMainWindow();
    if (window == nil) {
        return;
    }

    NSButton *closeButton = [window standardWindowButton:NSWindowCloseButton];
    NSButton *minimiseButton = [window standardWindowButton:NSWindowMiniaturizeButton];
    NSButton *maximiseButton = [window standardWindowButton:NSWindowZoomButton];

    arlecchinoMoveWindowButton(closeButton, closeX, closeY);
    arlecchinoMoveWindowButton(minimiseButton, minimiseX, minimiseY);
    arlecchinoMoveWindowButton(maximiseButton, maximiseX, maximiseY);
}

static void arlecchinoPositionNativeWindowControls(
    double closeX, double closeY,
    double minimiseX, double minimiseY,
    double maximiseX, double maximiseY
) {
    dispatch_async(dispatch_get_main_queue(), ^{
        arlecchinoPositionNativeWindowControlsOnMainThread(
            closeX, closeY,
            minimiseX, minimiseY,
            maximiseX, maximiseY
        );
    });
}
*/
import "C"

func (a *App) PositionNativeWindowControls(closeX, closeY, minimiseX, minimiseY, maximiseX, maximiseY float64) {
	if a == nil {
		return
	}

	a.nativeControlsMu.Lock()
	a.nativeControlsSet = true
	a.nativeControls = [6]float64{closeX, closeY, minimiseX, minimiseY, maximiseX, maximiseY}
	a.nativeControlsMu.Unlock()

	C.arlecchinoPositionNativeWindowControls(
		C.double(closeX),
		C.double(closeY),
		C.double(minimiseX),
		C.double(minimiseY),
		C.double(maximiseX),
		C.double(maximiseY),
	)
}

func (a *App) RefreshNativeWindowControls() {
	if a == nil {
		return
	}

	a.nativeControlsMu.Lock()
	controlsSet := a.nativeControlsSet
	controls := a.nativeControls
	a.nativeControlsMu.Unlock()

	if !controlsSet {
		return
	}

	C.arlecchinoPositionNativeWindowControls(
		C.double(controls[0]),
		C.double(controls[1]),
		C.double(controls[2]),
		C.double(controls[3]),
		C.double(controls[4]),
		C.double(controls[5]),
	)
}

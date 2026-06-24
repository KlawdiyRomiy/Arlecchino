//go:build darwin

package app

/*
#cgo CFLAGS: -x objective-c -fblocks
#cgo LDFLAGS: -framework Cocoa
#include <stdbool.h>
#import <Cocoa/Cocoa.h>
#import <dispatch/dispatch.h>
#import <objc/runtime.h>

static NSView* arlecchinoWebviewDragPassthroughHitTest(id self, SEL _cmd, NSPoint point) {
    return nil;
}

static bool arlecchinoInstallWebviewDragPassthrough(void) {
    static bool installed = false;
    if (installed) {
        return true;
    }

    Class dragClass = NSClassFromString(@"WebviewDrag");
    if (dragClass == Nil) {
        return false;
    }

    class_replaceMethod(
        dragClass,
        @selector(hitTest:),
        (IMP)arlecchinoWebviewDragPassthroughHitTest,
        "@@:{CGPoint=dd}"
    );
    installed = true;
    return true;
}

static NSWindow* arlecchinoCursorPassthroughWindow(void *preferredWindow) {
    if (preferredWindow != nil) {
        return (NSWindow*)preferredWindow;
    }

    NSWindow *window = [NSApp keyWindow];
    if (window == nil) {
        window = [NSApp mainWindow];
    }
    return window;
}

static void arlecchinoRefreshCursorRects(NSView *view, NSWindow *window) {
    if (view == nil || window == nil) {
        return;
    }

    [view updateTrackingAreas];
    [window invalidateCursorRectsForView:view];
    for (NSView *subview in [view subviews]) {
        arlecchinoRefreshCursorRects(subview, window);
    }
}

static void arlecchinoInstallNativeWebviewCursorPassthrough(void *preferredWindow) {
    dispatch_async(dispatch_get_main_queue(), ^{
        arlecchinoInstallWebviewDragPassthrough();

        NSWindow *window = arlecchinoCursorPassthroughWindow(preferredWindow);
        if (window == nil) {
            return;
        }

        arlecchinoRefreshCursorRects([window contentView], window);
    });
}
*/
import "C"

import (
	"unsafe"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func installNativeWebviewCursorPassthrough(window application.Window) {
	var nativeWindow unsafe.Pointer
	if window != nil {
		nativeWindow = window.NativeWindow()
	}
	C.arlecchinoInstallNativeWebviewCursorPassthrough(nativeWindow)
}

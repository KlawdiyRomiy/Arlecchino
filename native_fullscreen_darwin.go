//go:build darwin

package main

/*
#cgo CFLAGS: -x objective-c -fblocks
#cgo LDFLAGS: -framework Cocoa
#import <Cocoa/Cocoa.h>
#import <dispatch/dispatch.h>

static NSWindow* arlecchinoMainWindow(void) {
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

static bool arlecchinoIsNativeFullscreen(void) {
    __block bool result = false;
    void (^check)(void) = ^{
        NSWindow *window = arlecchinoMainWindow();
        result = window != nil && (([window styleMask] & NSWindowStyleMaskFullScreen) == NSWindowStyleMaskFullScreen);
    };

    if ([NSThread isMainThread]) {
        check();
    } else {
        dispatch_sync(dispatch_get_main_queue(), check);
    }
    return result;
}

static void arlecchinoPrepareNativeFullscreen(NSWindow *window) {
    NSWindowCollectionBehavior behavior = [window collectionBehavior];
    behavior |= NSWindowCollectionBehaviorFullScreenPrimary;
    behavior &= ~NSWindowCollectionBehaviorFullScreenAuxiliary;
    [window setCollectionBehavior:behavior];
}

static void arlecchinoToggleNativeFullscreen(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        NSWindow *window = arlecchinoMainWindow();
        if (window == nil) {
            return;
        }

        arlecchinoPrepareNativeFullscreen(window);
        [window toggleFullScreen:nil];
    });
}
*/
import "C"

func (a *App) ToggleNativeFullscreen() {
	C.arlecchinoToggleNativeFullscreen()
}

func (a *App) IsNativeFullscreen() bool {
	return bool(C.arlecchinoIsNativeFullscreen())
}

//go:build darwin

package main

/*
#cgo CFLAGS: -x objective-c -fblocks
#cgo LDFLAGS: -framework Cocoa
#import <Cocoa/Cocoa.h>
#import <dispatch/dispatch.h>
#include <stdbool.h>
#include <stdlib.h>

static NSImage* arlecchinoCopyApplicationIconSource(void) {
    NSImage *source = [NSImage imageNamed:@"appicon"];
    if (source == nil) {
        source = [NSImage imageNamed:NSImageNameApplicationIcon];
    }
    if (source == nil) {
        source = [NSApp applicationIconImage];
    }
    return source == nil ? nil : [source copy];
}

static NSImage* arlecchinoRenderApplicationIconForAppearance(NSString *appearanceName) {
    NSAppearance *appearance = [NSAppearance appearanceNamed:appearanceName];
    if (appearance == nil) {
        return nil;
    }

    NSImage *source = arlecchinoCopyApplicationIconSource();
    if (source == nil) {
        return nil;
    }

    NSSize size = [source size];
    if (size.width <= 0 || size.height <= 0) {
        size = NSMakeSize(1024, 1024);
    }

    NSImage *rendered = [[NSImage alloc] initWithSize:size];
    void (^drawIcon)(void) = ^{
        [source drawInRect:NSMakeRect(0, 0, size.width, size.height)
                  fromRect:NSZeroRect
                 operation:NSCompositingOperationSourceOver
                  fraction:1.0
            respectFlipped:NO
                     hints:nil];
    };

    [rendered lockFocus];
    [NSGraphicsContext saveGraphicsState];
    if ([appearance respondsToSelector:@selector(performAsCurrentDrawingAppearance:)]) {
        [appearance performAsCurrentDrawingAppearance:drawIcon];
    } else {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
        NSAppearance *previousAppearance = [NSAppearance currentAppearance];
        [NSAppearance setCurrentAppearance:appearance];
        drawIcon();
        [NSAppearance setCurrentAppearance:previousAppearance];
#pragma clang diagnostic pop
    }
    [NSGraphicsContext restoreGraphicsState];
    [rendered unlockFocus];
    [source release];
    return [rendered autorelease];
}

static bool arlecchinoSetApplicationIconAppearance(const char *appearanceCString) {
    NSString *appearanceValue = [[NSString alloc] initWithUTF8String:appearanceCString];
    if (appearanceValue == nil) {
        return false;
    }

    __block bool result = false;
    void (^apply)(void) = ^{
        if ([appearanceValue isEqualToString:@"system"]) {
            [NSApp setApplicationIconImage:nil];
            result = true;
            return;
        }

        NSString *appearanceName = nil;
        if ([appearanceValue isEqualToString:@"light"]) {
            appearanceName = @"NSAppearanceNameAqua";
        } else if ([appearanceValue isEqualToString:@"dark"]) {
            appearanceName = @"NSAppearanceNameDarkAqua";
        } else {
            return;
        }

        NSImage *icon = arlecchinoRenderApplicationIconForAppearance(appearanceName);
        if (icon == nil) {
            return;
        }

        [NSApp setApplicationIconImage:icon];
        result = true;
    };

    if ([NSThread isMainThread]) {
        apply();
    } else {
        dispatch_sync(dispatch_get_main_queue(), apply);
    }

    [appearanceValue release];
    return result;
}
*/
import "C"

import (
	"strings"
	"unsafe"
)

func (a *App) SetApplicationIconAppearance(appearance string) bool {
	normalized := strings.ToLower(strings.TrimSpace(appearance))
	switch normalized {
	case "system", "light", "dark":
	default:
		return false
	}

	cAppearance := C.CString(normalized)
	defer C.free(unsafe.Pointer(cAppearance))
	return bool(C.arlecchinoSetApplicationIconAppearance(cAppearance))
}

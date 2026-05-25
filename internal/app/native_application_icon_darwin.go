//go:build darwin

package app

/*
#cgo CFLAGS: -x objective-c -fblocks
#cgo LDFLAGS: -framework Cocoa
#import <Cocoa/Cocoa.h>
#import <dispatch/dispatch.h>
#include <stdbool.h>
#include <stdlib.h>

static void arlecchinoNormalizeApplicationIconSize(NSImage *icon) {
    NSInteger pixelWidth = 0;
    NSInteger pixelHeight = 0;
    for (NSImageRep *representation in [icon representations]) {
        pixelWidth = MAX(pixelWidth, [representation pixelsWide]);
        pixelHeight = MAX(pixelHeight, [representation pixelsHigh]);
    }
    if (pixelWidth > 0 && pixelHeight > 0) {
        [icon setSize:NSMakeSize(pixelWidth, pixelHeight)];
        return;
    }
    [icon setSize:NSMakeSize(1024, 1024)];
}

static NSImage* arlecchinoCopyApplicationIconResource(NSString *appearanceValue) {
    NSString *resourceName = nil;
    if ([appearanceValue isEqualToString:@"light"]) {
        resourceName = @"appicon-light";
    } else if ([appearanceValue isEqualToString:@"dark"]) {
        resourceName = @"appicon-dark";
    } else {
        return nil;
    }

    NSImage *source = nil;
    NSString *path = [[NSBundle mainBundle] pathForResource:resourceName ofType:@"png"];
    if (path != nil) {
        source = [[[NSImage alloc] initWithContentsOfFile:path] autorelease];
    }
    if (source == nil) {
        source = [[NSBundle mainBundle] imageForResource:resourceName];
    }
    if (source == nil) {
        return nil;
    }

    NSImage *icon = [source copy];
    [icon setTemplate:NO];
    arlecchinoNormalizeApplicationIconSize(icon);
    return icon;
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

        if (![appearanceValue isEqualToString:@"light"] && ![appearanceValue isEqualToString:@"dark"]) {
            return;
        }

        NSImage *icon = arlecchinoCopyApplicationIconResource(appearanceValue);
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

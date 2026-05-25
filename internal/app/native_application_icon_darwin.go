//go:build darwin

package app

/*
#cgo CFLAGS: -x objective-c -fblocks
#cgo LDFLAGS: -framework Cocoa
#import <Cocoa/Cocoa.h>
#import <dispatch/dispatch.h>
#include <stdbool.h>
#include <stdlib.h>

static NSSize arlecchinoApplicationIconTargetSize(void) {
    NSArray *resourceNames = @[@"appicon", @"iconfile"];
    NSBundle *bundle = [NSBundle mainBundle];
    for (NSString *resourceName in resourceNames) {
        NSImage *resourceIcon = [bundle imageForResource:resourceName];
        if (resourceIcon != nil && [resourceIcon size].width > 0 && [resourceIcon size].height > 0) {
            return [resourceIcon size];
        }
    }

    NSImage *applicationIcon = [NSImage imageNamed:NSImageNameApplicationIcon];
    if (applicationIcon != nil && [applicationIcon size].width > 0 && [applicationIcon size].height > 0) {
        return [applicationIcon size];
    }

    return NSMakeSize(128, 128);
}

static void arlecchinoNormalizeApplicationIconSize(NSImage *icon) {
    [icon setSize:arlecchinoApplicationIconTargetSize()];
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

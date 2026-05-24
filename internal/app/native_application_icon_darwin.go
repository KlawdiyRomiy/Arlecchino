//go:build darwin

package app

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

static NSImage* arlecchinoCopyApplicationIconResource(NSString *appearanceValue) {
    NSString *resourceName = nil;
    if ([appearanceValue isEqualToString:@"light"]) {
        resourceName = @"appicon-light";
    } else if ([appearanceValue isEqualToString:@"dark"]) {
        resourceName = @"appicon-dark";
    } else {
        return nil;
    }

    NSImage *source = [[NSBundle mainBundle] imageForResource:resourceName];
    if (source == nil) {
        NSString *path = [[NSBundle mainBundle] pathForResource:resourceName ofType:@"png"];
        if (path != nil) {
            source = [[[NSImage alloc] initWithContentsOfFile:path] autorelease];
        }
    }
    if (source == nil) {
        return nil;
    }

    NSImage *icon = [source copy];
    [icon setTemplate:NO];
    return icon;
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

static NSImage* arlecchinoTintApplicationIconMask(NSImage *mask, NSSize size, NSColor *color) {
    NSImage *tinted = [[NSImage alloc] initWithSize:size];
    NSRect canvas = NSMakeRect(0, 0, size.width, size.height);

    [tinted lockFocus];
    [[NSGraphicsContext currentContext] setImageInterpolation:NSImageInterpolationHigh];
    [color setFill];
    NSRectFill(canvas);
    [mask drawInRect:canvas
            fromRect:NSZeroRect
           operation:NSCompositingOperationDestinationIn
            fraction:1.0
      respectFlipped:NO
               hints:nil];
    [tinted unlockFocus];
    return tinted;
}

static NSBezierPath* arlecchinoApplicationIconShape(NSSize size) {
    CGFloat insetX = size.width * 0.06640625;
    CGFloat insetY = size.height * 0.07421875;
    NSRect iconRect = NSInsetRect(NSMakeRect(0, 0, size.width, size.height), insetX, insetY);
    CGFloat cornerRadius = iconRect.size.width * 0.23873874;
    return [NSBezierPath bezierPathWithRoundedRect:iconRect xRadius:cornerRadius yRadius:cornerRadius];
}

static void arlecchinoDrawApplicationIconBackground(NSBezierPath *shape, NSString *appearanceValue) {
    if ([appearanceValue isEqualToString:@"dark"]) {
        NSColor *topColor = [NSColor colorWithCalibratedWhite:0.192 alpha:1.0];
        NSColor *bottomColor = [NSColor colorWithCalibratedWhite:0.078 alpha:1.0];
        NSGradient *gradient = [[NSGradient alloc] initWithStartingColor:topColor endingColor:bottomColor];
        [gradient drawInBezierPath:shape angle:-90.0];
        [gradient release];
        return;
    }

    [[NSColor colorWithCalibratedWhite:1.0 alpha:1.0] setFill];
    [shape fill];
}

static NSImage* arlecchinoRenderApplicationIconFromMask(NSString *appearanceValue) {
    NSImage *mask = [NSImage imageNamed:@"appicon_Assets/arle_logo_mask"];
    if (mask == nil) {
        return nil;
    }

    NSSize size = [mask size];
    if (size.width <= 0 || size.height <= 0) {
        size = NSMakeSize(1024, 1024);
    }

    NSColor *logoColor = [appearanceValue isEqualToString:@"dark"]
        ? [NSColor colorWithCalibratedWhite:1.0 alpha:1.0]
        : [NSColor colorWithCalibratedWhite:0.0 alpha:1.0];
    NSImage *logo = arlecchinoTintApplicationIconMask(mask, size, logoColor);
    NSImage *rendered = [[NSImage alloc] initWithSize:size];
    NSRect canvas = NSMakeRect(0, 0, size.width, size.height);

    [rendered lockFocus];
    [[NSGraphicsContext currentContext] setImageInterpolation:NSImageInterpolationHigh];
    arlecchinoDrawApplicationIconBackground(arlecchinoApplicationIconShape(size), appearanceValue);
    [logo drawInRect:canvas
            fromRect:NSZeroRect
           operation:NSCompositingOperationSourceOver
            fraction:1.0
      respectFlipped:NO
               hints:nil];
    [rendered unlockFocus];
    [rendered setTemplate:NO];
    [logo release];
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

        NSImage *icon = arlecchinoCopyApplicationIconResource(appearanceValue);
        if (icon == nil && [appearanceValue isEqualToString:@"light"]) {
            icon = arlecchinoRenderApplicationIconForAppearance(appearanceName);
        }
        if (icon == nil) {
            icon = arlecchinoRenderApplicationIconFromMask(appearanceValue);
        }
        if (icon == nil) {
            icon = arlecchinoRenderApplicationIconForAppearance(appearanceName);
        }
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
